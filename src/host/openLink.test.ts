import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { carryOutLink, runDetached } from './openLink.ts'

describe('carryOutLink', () => {
	test('web and mail links open in their app; text files open in a new editor; other files are only revealed', () => {
		const run = vi.fn()
		const openInEditor = vi.fn()

		carryOutLink({ kind: 'openExternally', url: 'https://example.com' }, run, openInEditor)
		carryOutLink({ kind: 'openExternally', url: 'mailto:kira@example.com' }, run, openInEditor)
		carryOutLink({ kind: 'reveal', path: '/Applications/Tool.app' }, run, openInEditor)
		carryOutLink({ kind: 'openInEditor', path: '/notes/other.md' }, run, openInEditor)
		carryOutLink({ kind: 'ignore' }, run, openInEditor)

		expect(run.mock.calls).toEqual([
			['open', ['https://example.com']],
			['open', ['mailto:kira@example.com']],
			['open', ['-R', '/Applications/Tool.app']]
		])
		expect(openInEditor).toHaveBeenCalledWith('/notes/other.md')
	})

	test('a link asking for confirmation is not opened by this function', () => {
		const run = vi.fn()
		carryOutLink({ kind: 'confirm', url: 'slack://open' }, run, vi.fn())

		expect(run).not.toHaveBeenCalled()
	})
})

describe('runDetached', () => {
	/**
	 * the window's default runner, run on a stand-in for `open` that writes its arguments to a file, so the
	 * test starts a real process without opening anything
	 */
	test('starts the command with its arguments', async () => {
		const folder = mkdtempSync(join(tmpdir(), 'eg-run-'))
		const command = join(folder, 'open')
		const output = join(folder, 'arguments')
		writeFileSync(command, `#!/bin/sh\nprintf '%s|' "$@" > '${output}'\n`, { mode: 0o755 })

		runDetached(command, ['-R', '/Applications/Tool.app'])

		await vi.waitFor(() => expect(readFileSync(output, 'utf8')).toBe('-R|/Applications/Tool.app|'))
		rmSync(folder, { recursive: true, force: true })
	})

	// `file:///tmp/a%00b.md` decodes to a path holding NUL, which execFile refuses by throwing
	test('an argument execFile refuses does nothing and throws nothing', () => {
		expect(() => runDetached('/usr/bin/true', ['-R', '/tmp/a\0b.md'])).not.toThrow()
	})
})
