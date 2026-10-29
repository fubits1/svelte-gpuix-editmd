import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { connect, createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { afterAll, describe, expect, test, vi } from 'vitest'
import type { AgentEditReport } from '../core/agentEdits.ts'
import { focusWindowFor, greetPeers, listenForReports, sendRename, sendReport } from './agentIpc.ts'

// unix socket paths are limited to ~104 bytes on macOS, so keep the folder short
const directory = mkdtempSync(join(tmpdir(), 'eg-ipc-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

const report: AgentEditReport = {
	author: { id: 'abc', name: 'Claude · notes' },
	phase: 'before',
	paths: ['/Users/me/notes/plan.md']
}

describe('agent report IPC', () => {
	test('a socket name is short (process id and a count, base 36), leaving the folder room under macOS’s 104-byte limit', async () => {
		const folder = mkdtempSync(join(directory, 'n-'))
		const close = await listenForReports(folder, () => {})

		const [name] = readdirSync(folder)
		expect(name).toMatch(new RegExp(`^${process.pid.toString(36)}-[0-9a-z]+\\.sock$`))
		expect(name!.length).toBeLessThanOrEqual(12)
		await close()
	})

	// only the user's own processes may report edits or renames to a window
	test('the sockets folder it makes, and each socket, are the user’s alone', async () => {
		const folder = join(mkdtempSync(join(directory, 'm-')), 'sockets')
		const close = await listenForReports(folder, () => {})

		expect([statSync(folder).mode & 0o777, statSync(close.socket).mode & 0o777]).toEqual([
			0o700, 0o600
		])
		await close()
	})

	test('a folder too deep for a socket is refused with the reason, not an opaque EINVAL', async () => {
		const deep = join(directory, 'd'.repeat(100))

		await expect(listenForReports(deep, () => {})).rejects.toThrow(
			/longer than the 104 bytes macOS allows/
		)
	})

	// opening a file another window already has made a second window on it, where editmd brings the
	// document's window forward
	test('a window that has the file comes forward and says so; none has it, and the opener goes ahead', async () => {
		const folder = mkdtempSync(join(directory, 'f-'))
		const focused: string[] = []
		const owner = await listenForReports(folder, () => {}, undefined, undefined, {
			owns: (path) => path === '/notes/plan.md',
			focus: () => focused.push('owner')
		})
		const other = await listenForReports(folder, () => {}, undefined, undefined, {
			owns: () => false,
			focus: () => focused.push('other')
		})

		const found = await focusWindowFor(folder, '/notes/plan.md')
		const missing = await focusWindowFor(folder, '/notes/other.md')
		expect([found, missing, focused]).toEqual([true, false, ['owner']])
		await owner()
		await other()
	})

	test('every listening editor receives a report sent to the folder', async () => {
		const first = vi.fn()
		const second = vi.fn()
		const closeFirst = await listenForReports(directory, first)
		const closeSecond = await listenForReports(directory, second)

		await sendReport(directory, report)

		await vi.waitFor(() => {
			expect(first).toHaveBeenCalledWith(report)
			expect(second).toHaveBeenCalledWith(report)
		})
		await closeFirst()
		await closeSecond()
	})

	// editmd's `AgentEdits.rename` (AgentEdits.swift:39-45) renames the Agent in every window
	test('a rename reaches every other listening window, not the sender’s own, and is not taken for a Report', async () => {
		const folder = mkdtempSync(join(directory, 'r-'))
		const reports = vi.fn()
		const ownRenames = vi.fn()
		const otherRenames = vi.fn()
		const own = await listenForReports(folder, reports, ownRenames)
		const other = await listenForReports(folder, reports, otherRenames)

		await sendRename(folder, { id: 'abc', name: 'Planner' }, own.socket)

		await vi.waitFor(() =>
			expect(otherRenames).toHaveBeenCalledWith({ id: 'abc', name: 'Planner' })
		)
		expect(ownRenames).not.toHaveBeenCalled()
		expect(reports).not.toHaveBeenCalled()
		await own()
		await other()
	})

	/**
	 * editmd keeps the names for the app's lifetime (AgentEdits.swift:18-19, 35), so a window opened after a
	 * rename uses the name too; here each window is a process, so a new one greets the others and each answers
	 * with the names it knows
	 */
	test('a window that greets the others gets back every name they know, and only it does', async () => {
		const folder = mkdtempSync(join(directory, 'g-'))
		const reports = vi.fn()
		const earlierRenames = vi.fn()
		const newRenames = vi.fn()
		const earlier = await listenForReports(folder, reports, earlierRenames, () => [
			{ id: 'abc', name: 'Planner' },
			{ id: 'def', name: 'Reviewer' }
		])
		const later = await listenForReports(folder, reports, newRenames)

		await greetPeers(folder, later.socket)

		await vi.waitFor(() => expect(newRenames).toHaveBeenCalledTimes(2))
		expect(newRenames.mock.calls).toEqual([
			[{ id: 'abc', name: 'Planner' }],
			[{ id: 'def', name: 'Reviewer' }]
		])
		expect([earlierRenames.mock.calls, reports.mock.calls]).toEqual([[], []])
		await earlier()
		await later()
	})

	/**
	 * a hello names where to answer, and an answer that fails removes a dead socket: a `from` outside the sockets
	 * folder, or not a socket name, must get no answer, or any process of the user's could make a window delete a file
	 */
	test('a hello that names a path outside the sockets folder, or no socket, gets no answer and deletes nothing', async () => {
		const folder = mkdtempSync(join(directory, 'h-'))
		const outside = mkdtempSync(join(directory, 'o-'))
		const victims = [
			join(outside, 'notes.md'),
			join(outside, 'x.sock'),
			join(folder, 'notes.md'),
			join(folder, '..', 'y.sock')
		]
		for (const victim of victims) writeFileSync(victim, 'mine')
		const directoryVictim = mkdtempSync(join(outside, 'd-'))
		const close = await listenForReports(
			folder,
			() => {},
			() => {},
			() => [{ id: 'abc', name: 'Planner' }]
		)

		for (const from of [...victims, directoryVictim]) {
			await new Promise<void>((resolve) => {
				const socket = connect(close.socket, () =>
					socket.end(JSON.stringify({ kind: 'hello', from }))
				)
				socket.on('close', () => resolve())
			})
		}
		await new Promise((resolve) => setTimeout(resolve, 200))

		expect([...victims, directoryVictim].map((victim) => existsSync(victim))).toEqual([
			true,
			true,
			true,
			true,
			true
		])
		await close()
	})

	test('a Report still reaches a window that listens for renames, and is not taken for a rename', async () => {
		const folder = mkdtempSync(join(directory, 'p-'))
		const reports = vi.fn()
		const renames = vi.fn()
		const close = await listenForReports(folder, reports, renames)

		await sendReport(folder, report)

		await vi.waitFor(() => expect(reports).toHaveBeenCalledWith(report))
		expect(renames).not.toHaveBeenCalled()
		await close()
	})

	// only a socket nobody listens on is stale: any other error (a full backlog, a permission) leaves a live
	// window's socket alone, or that window would stop hearing reports and renames for good
	test('a send that fails for another reason than a dead socket leaves the socket alone', async () => {
		const folder = mkdtempSync(join(directory, 'live-'))
		const close = await listenForReports(folder, () => {})
		const [name] = readdirSync(folder)
		const socket = join(folder, name!)
		chmodSync(socket, 0o000)
		try {
			await sendReport(folder, report)
			expect(existsSync(socket)).toBe(true)
		} finally {
			chmodSync(socket, 0o755)
			await close()
		}
	})

	// editmd's hook posts a notification and is done (AgentEdits.swift:77-96); a window that accepts and never reads
	// must not hold the agent's hook
	test('a send to a window that never reads gives up within about a second', async () => {
		const folder = mkdtempSync(join(directory, 'stuck-'))
		const held: Socket[] = []
		const server = createServer((connection) => {
			held.push(connection)
			connection.pause()
		})
		await new Promise<void>((done) => server.listen(join(folder, '1-0.sock'), done))
		const started = Date.now()
		const big = { ...report, paths: [`/x/${'a'.repeat(4_000_000)}.md`] }
		try {
			await sendReport(folder, big)
			expect(Date.now() - started).toBeLessThan(2500)
		} finally {
			for (const connection of held) connection.destroy()
			await new Promise((done) => server.close(done))
		}
	}, 10_000)

	// macOS refuses a connect when a live window's backlog is full (ECONNREFUSED), the same error as for a
	// crashed one; the socket's name holds its process id, so only one whose process is gone is removed
	test('a refused send removes a socket only when the process named in it is gone', async () => {
		const folder = mkdtempSync(join(directory, 'owner-'))
		const dead = spawnSync(process.execPath, ['-e', '0']).pid
		const live = join(folder, `${process.pid.toString(36)}-z.sock`)
		const gone = join(folder, `${dead.toString(36)}-z.sock`)
		writeFileSync(live, '')
		writeFileSync(gone, '')

		await sendReport(folder, report)

		expect([existsSync(live), existsSync(gone)]).toEqual([true, false])
	})

	test('a socket left behind by a crashed editor is removed instead of failing the send', async () => {
		const stale = join(directory, 'stale.sock')
		writeFileSync(stale, '')

		await sendReport(directory, report)

		expect(existsSync(stale)).toBe(false)
	})
})
