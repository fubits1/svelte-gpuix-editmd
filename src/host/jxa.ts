import { execFile } from 'node:child_process'

/** runs a program and hands back what it printed, as node's `execFile` does */
export type Run = (
	file: string,
	args: readonly string[],
	done: (error: Error | null, stdout: string) => void
) => void

const run: Run = (file, args, done) =>
	execFile(file, args, { encoding: 'utf8' }, (error, stdout) => done(error, stdout))

/**
 * what a JavaScript for Automation `script` prints, '' when it fails: AppKit's answers that gpuix has no API for,
 * asked through osascript (about 40ms, so never on the window's thread)
 */
export function readJxa(script: string, runner: Run = run): Promise<string> {
	return new Promise((resolve) => {
		runner('osascript', ['-l', 'JavaScript', '-e', script], (error, stdout) =>
			resolve(error ? '' : stdout)
		)
	})
}
