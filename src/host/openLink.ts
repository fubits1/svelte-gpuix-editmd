import { execFile } from 'node:child_process'
import type { LinkAction } from '../core/linkPolicy.ts'

export type Run = (command: string, args: string[]) => void

/**
 * runs `open` without waiting for it; gpuix has no open-URL API. an argument `execFile` refuses (a NUL in a path a link names) does
 * nothing, as a link that names nothing does
 */
export const runDetached: Run = (command, args) => {
	try {
		execFile(command, args, () => {})
	} catch {
		// nothing to open
	}
}

/**
 * carries out a LinkAction: web and mail through `open`, text files in a new editor, everything
 * else only revealed in Finder (`open -R`) so a link never launches an app. `confirm` is the
 * caller's job: it must ask the user first
 */
export function carryOutLink(
	action: LinkAction,
	run: Run,
	openInEditor: (path: string) => void
): void {
	switch (action.kind) {
		case 'openExternally':
			run('open', [action.url])
			break
		case 'reveal':
			run('open', ['-R', action.path])
			break
		case 'openInEditor':
			openInEditor(action.path)
			break
		case 'confirm':
		case 'ignore':
			break
	}
}
