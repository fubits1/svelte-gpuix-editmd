import { chmodSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { basename, dirname, join, resolve } from 'node:path'
import type { AgentEditReport } from '../core/agentEdits.ts'

/**
 * agent Reports between processes (ADR-0008): every open editor listens on its own unix socket in
 * one folder, and `editmd-gpuix --report-edit` writes the Report to each of them. This replaces
 * editmd's DistributedNotificationCenter, which Node cannot reach. The same sockets carry a rename
 * from one window to the others, as editmd's `AgentEdits.rename` reaches every window of its one process
 */

/** macOS's `sun_path` holds 104 bytes, the terminating NUL included */
const SOCKET_PATH_LIMIT = 104

/** the user named the Agent with this id `name` in one window; editmd's `AgentEdits.rename(id:to:)` */
export type AgentRename = { id: string; name: string }

/** a rename on the wire: tagged, since a Report (from older senders too) carries no `kind` */
type RenameMessage = { kind: 'rename' } & AgentRename

/** a window that just opened asks the others for the names they know, to be sent to `from` */
type HelloMessage = { kind: 'hello'; from: string }

/** a window about to open `path` asks the others whether one has it; that one comes forward and answers `yes` */
type FocusMessage = { kind: 'focus'; path: string }

/** what a window answers a focus message with: whether its document is `path`, and how it comes forward */
export type FocusHandler = { owns: (path: string) => boolean; focus: () => void }

/** closes the listener; `socket` is its path, which a rename from this window leaves out */
export type ReportListener = (() => Promise<void>) & { readonly socket: string }

let listeners = 0

/** a rename message's fields, or null for anything else (a Report) */
function renameIn(message: Partial<RenameMessage>): AgentRename | null {
	if (message.kind !== 'rename') return null
	const { id, name } = message
	return typeof id === 'string' && typeof name === 'string' ? { id, name } : null
}

/**
 * listens for Reports, renames from other windows when `onRename` is given, and greetings from new windows,
 * which get back every name `knownNames` holds, until the returned close
 * function runs. the socket's name is kept short (process id and a count, base 36) because the whole path
 * must fit macOS's 104 bytes, and the folder sits in the user's home; a folder too deep for any name is
 * refused with that reason
 */
export async function listenForReports(
	directory: string,
	onReport: (report: AgentEditReport) => void,
	onRename: (rename: AgentRename) => void = () => {},
	knownNames: () => readonly AgentRename[] = () => [],
	focus: FocusHandler = { owns: () => false, focus: () => {} }
): Promise<ReportListener> {
	const path = join(directory, `${process.pid.toString(36)}-${(listeners++).toString(36)}.sock`)
	if (Buffer.byteLength(path) >= SOCKET_PATH_LIMIT) {
		throw new Error(
			`agent reports cannot reach this window: the socket path ${path} is longer than the 104 bytes macOS allows`
		)
	}
	// the user's alone: only their own processes report edits or renames to a window
	mkdirSync(directory, { recursive: true, mode: 0o700 })
	// a socket under this name is left over from an earlier process with the same id
	rmSync(path, { force: true })

	// half open, so a focus message is answered on the connection it came on
	const server = createServer({ allowHalfOpen: true }, (connection) => {
		let payload = ''
		let answer = ''
		connection.setEncoding('utf8')
		connection.on('data', (chunk) => (payload += chunk))
		connection.on('end', () => {
			try {
				const message = JSON.parse(payload) as Partial<RenameMessage> &
					Partial<HelloMessage> &
					Partial<FocusMessage> &
					Partial<AgentEditReport>
				const rename = renameIn(message)
				if (rename) onRename(rename)
				else if (message.kind === 'hello' && typeof message.from === 'string') {
					// only a window's socket in this folder is answered: `from` comes from any process of the user's
					if (isSocketIn(directory, message.from)) void answerHello(message.from, knownNames())
				} else if (message.kind === 'focus' && typeof message.path === 'string') {
					if (focus.owns(message.path)) {
						focus.focus()
						answer = 'yes'
					}
				}
				// a message of a kind this window does not know is neither
				else if (message.kind === undefined) onReport(message as AgentEditReport)
			} catch {
				// a malformed message is dropped
			}
			connection.end(answer)
		})
	})

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(path, resolve)
	})
	try {
		chmodSync(path, 0o600)
	} catch {
		// the folder went while the window started (its 0700 is the guard that counts); the listener stays as it is
	}

	const close = () =>
		new Promise<void>((resolve) => {
			server.close(() => {
				rmSync(path, { force: true })
				resolve()
			})
		})
	return Object.assign(close, { socket: path })
}

/** sends `report` to every editor listening in `directory`, removing sockets nobody listens on any more */
export async function sendReport(directory: string, report: AgentEditReport): Promise<void> {
	await sendToAll(directory, JSON.stringify(report))
}

/**
 * tells every other window listening in `directory` that the user renamed an Agent, leaving out the sender's own
 * socket `except`, so each applies it to its legend and to the Agent's later changes
 */
export async function sendRename(
	directory: string,
	rename: AgentRename,
	except: string | null = null
): Promise<void> {
	const message: RenameMessage = { kind: 'rename', ...rename }
	await sendToAll(directory, JSON.stringify(message), except)
}

/**
 * a window that just opened asks every other window in `directory` for the names the user gave Agents, which
 * come back to its own socket `own` as renames: editmd keeps them for the app's lifetime (AgentEdits.swift:18-19)
 */
export async function greetPeers(directory: string, own: string): Promise<void> {
	const message: HelloMessage = { kind: 'hello', from: own }
	await sendToAll(directory, JSON.stringify(message), own)
}

/**
 * asks every window listening in `directory` but `except` whether its document is `path`; the one that has it comes
 * forward, as editmd brings a document's window forward instead of opening it twice. true when one did
 */
export async function focusWindowFor(
	directory: string,
	path: string,
	except: string | null = null
): Promise<boolean> {
	let names: string[]
	try {
		names = readdirSync(directory).filter((name) => name.endsWith('.sock'))
	} catch {
		return false
	}
	const message: FocusMessage = { kind: 'focus', path }
	const answers = await Promise.all(
		names
			.map((name) => join(directory, name))
			.filter((socket) => socket !== except)
			.map((socket) => ask(socket, JSON.stringify(message)))
	)
	return answers.includes('yes')
}

/** writes `payload` to the socket at `path` and reads its answer; '' when there is none or the window does not take it */
function ask(path: string, payload: string): Promise<string> {
	return new Promise<string>((done) => {
		let answer = ''
		const socket = connect(path, () => socket.end(payload))
		socket.setEncoding('utf8')
		const deadline = setTimeout(() => socket.destroy(), SEND_DEADLINE_MS)
		socket.on('data', (chunk) => (answer += chunk))
		socket.on('close', () => {
			clearTimeout(deadline)
			done(answer)
		})
		socket.on('error', () => done(''))
	})
}

/** a window's socket name as `listenForReports` makes it: process id and a count, base 36 */
const SOCKET_NAME = /^[0-9a-z]+-[0-9a-z]+\.sock$/

/** `path` names a window's socket directly inside `directory` */
function isSocketIn(directory: string, path: string): boolean {
	const resolved = resolve(path)
	return dirname(resolved) === resolve(directory) && SOCKET_NAME.test(basename(resolved))
}

/**
 * the names this window knows, one rename message each, in order, to the window that said hello. an answer that
 * fails removes nothing: the address came in a message, not from the folder's listing
 */
async function answerHello(to: string, names: readonly AgentRename[]): Promise<void> {
	for (const rename of names) {
		const message: RenameMessage = { kind: 'rename', ...rename }
		await sendTo(to, JSON.stringify(message), false)
	}
}

/** writes `payload` to every socket in `directory` but `except`, removing sockets nobody listens on any more */
async function sendToAll(directory: string, payload: string, except: string | null = null) {
	let names: string[]
	try {
		names = readdirSync(directory).filter((name) => name.endsWith('.sock'))
	} catch {
		return
	}

	await Promise.all(
		names
			.map((name) => join(directory, name))
			.filter((path) => path !== except)
			.map((path) => sendTo(path, payload))
	)
}

/** how long one window is given to take a message before the send to it is dropped */
const SEND_DEADLINE_MS = 1000

/** the connect errors that mean nobody listens there: a crashed editor's socket, or a file that is no socket */
const DEAD_SOCKET = new Set(['ECONNREFUSED', 'ENOTSOCK'])

/**
 * the process that made the socket at `path` is still running: macOS refuses a connect to a live window whose backlog
 * is full with the same ECONNREFUSED as one to a crashed window's socket, and the name holds the process id
 * (`listenForReports`). a name that holds none has no owner to ask
 */
function ownerAlive(path: string): boolean {
	const owner = /^([0-9a-z]+)-[0-9a-z]+\.sock$/.exec(basename(path))?.[1]
	if (owner === undefined) return false
	try {
		process.kill(Number.parseInt(owner, 36), 0)
		return true
	} catch (error) {
		// EPERM: a process of another user's holds the id, which this window's socket was not
		return (error as NodeJS.ErrnoException).code === 'EPERM'
	}
}

/**
 * writes `payload` to the socket at `path`, removing it when nobody listens on it any more and `removeDead`; any
 * other error (a full backlog, a permission) leaves it, since a live window would otherwise stop hearing reports
 * and renames for good
 */
function sendTo(path: string, payload: string, removeDead = true): Promise<void> {
	return new Promise<void>((done) => {
		const socket = connect(path, () => socket.end(payload))
		// a window that never reads (frozen, or stopped in a debugger) must not hold the agent's hook
		const deadline = setTimeout(() => socket.destroy(), SEND_DEADLINE_MS)
		socket.on('close', () => {
			clearTimeout(deadline)
			done()
		})
		socket.on('error', (error: NodeJS.ErrnoException) => {
			try {
				if (removeDead && DEAD_SOCKET.has(error.code ?? '') && !ownerAlive(path)) {
					rmSync(path, { force: true })
				}
			} catch {
				// a folder named like a socket stays; a failed send never ends the process
			}
			done()
		})
	})
}
