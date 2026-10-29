import { execFileSync } from 'node:child_process'
import type { VisibleScreen } from '../app/window.ts'

/** runs `file` with `args` and returns what it printed; throws when it fails */
export type RunSync = (file: string, args: readonly string[]) => string

const runOsascript: RunSync = (file, args) =>
	execFileSync(file, args, { encoding: 'utf8', timeout: 2000 })

/** AppKit's main screen's visible frame, below the menu bar and beside the Dock, as editmd's `initialFrame` reads it */
const SCRIPT =
	'ObjC.import("AppKit"); const f = $.NSScreen.mainScreen.visibleFrame; JSON.stringify({ width: f.size.width, height: f.size.height })'

/**
 * the main screen's visible size, which gpuix cannot tell: asked of AppKit through osascript's JavaScript before the
 * window opens (about 0.1s). null when osascript fails or answers anything else, so the window keeps
 * editmd's uncapped size
 */
export function readVisibleScreen(run: RunSync = runOsascript): VisibleScreen | null {
	try {
		const { width, height } = JSON.parse(
			run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', SCRIPT])
		) as Partial<Record<'width' | 'height', number | string>>
		return typeof width === 'number' && typeof height === 'number' ? { width, height } : null
	} catch {
		return null
	}
}
