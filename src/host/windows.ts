import { spawn } from 'node:child_process'

export type Spawn = (command: string, args: string[]) => void

/** how this process was started; a compiled binary has no entry script, so `entry` is null there */
export type Self = { execPath: string; execArgv: string[]; entry: string | null }

/**
 * detached, so closing this window never takes the new one with it. a window that cannot be started (the binary moved
 * by an update, too many open files, a NUL in a path) is said on stderr, never thrown: this window may hold an
 * untitled document's edits
 */
export const spawnDetached: Spawn = (command, args) => {
	const report = (error: Error) =>
		process.stderr.write(`editmd-gpuix: a new window could not start: ${error.message}\n`)
	try {
		const child = spawn(command, args, { detached: true, stdio: 'ignore' })
		child.on('error', report)
		child.unref()
	} catch (error) {
		report(error instanceof Error ? error : new Error(String(error)))
	}
}

/** where Bun's compiled binary keeps its embedded files, the entry among them */
const EMBEDDED = '/$bunfs/'

/**
 * how a process started, from its `process` fields: a compiled binary's argv[1] is its embedded entry, which the
 * binary runs by itself, so it is no entry to pass on
 */
export function selfOf(started: { execPath: string; execArgv: string[]; argv: string[] }): Self {
	const entry = started.argv[1] ?? null
	return {
		execPath: started.execPath,
		execArgv: started.execArgv,
		entry: entry === null || entry.startsWith(EMBEDDED) ? null : entry
	}
}

const thisProcess = (): Self => selfOf(process)

/** one window per process (ADR-0008): New and Open start another editor, optionally on `path` */
export function openWindow(
	path: string | null,
	run: Spawn = spawnDetached,
	self: Self = thisProcess()
): void {
	run(self.execPath, [
		...self.execArgv,
		...(self.entry ? [self.entry] : []),
		...(path ? [path] : [])
	])
}
