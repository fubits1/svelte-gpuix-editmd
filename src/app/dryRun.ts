import { appendFileSync } from 'node:fs'
import type { Run } from '../host/openLink.ts'

export type DryRunOptions = {
	run?: Run
	openInEditor?: (path: string) => void
	openWindow?: (path: string | null) => void
}

/**
 * `EDITMD_GPUIX_DRY_RUN=<file>`: every process the app would start (`open` for links and printing,
 * new editor windows) is written to that file as one JSON line instead, so an end-to-end run in a
 * real window never opens the browser, Finder or more windows
 */
export function dryRunOptions(env: Record<string, string | undefined>): DryRunOptions {
	const log = env.EDITMD_GPUIX_DRY_RUN
	if (!log) return {}

	const record = (command: string, args: readonly (string | null)[]) =>
		appendFileSync(log, `${JSON.stringify([command, args])}\n`)
	return {
		run: (command, args) => record(command, args),
		openInEditor: (path) => record('openInEditor', [path]),
		openWindow: (path) => record('openWindow', [path])
	}
}
