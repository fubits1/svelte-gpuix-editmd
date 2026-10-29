/**
 * macOS's title bar: gpuix's `height` is the content's, below it (`height: 600` opened a 628px frame),
 * where editmd's 940 is the whole frame's
 */
export const TITLE_BAR = 28

// editmd's window geometry (EditorWindowController.swift): 860×940, at least 420×300
export const WINDOW = {
	appName: 'editmd',
	width: 860,
	height: 940,
	minWidth: 420,
	/**
	 * editmd's 300 is NSWindow `minSize`, the frame (EditorWindowController.swift:21); gpuix hands the minimum to
	 * GPUI's `setContentMinSize`, below the title bar
	 */
	minHeight: 300 - TITLE_BAR
}

/** the part of the main screen a window may cover, below the menu bar and beside the Dock (NSScreen `visibleFrame`) */
export type VisibleScreen = { width: number; height: number }

/**
 * the window's content size, from editmd's `initialFrame` (EditorWindowController.swift:95-104): a frame of
 * min(860, w - 80) by min(940, h - 60) on the screen's visible part, less the title bar, and never under the
 * minimum size; editmd's 860×940 frame when the screen could not be read. gpuix takes no position, so the window
 * opens where GPUI puts it, centred, where editmd puts a quarter of the spare height above it
 */
export function windowSizeFor(screen: VisibleScreen | null): { width: number; height: number } {
	const frameWidth = Math.min(WINDOW.width, (screen?.width ?? Infinity) - 80)
	const frameHeight = Math.min(WINDOW.height, (screen?.height ?? Infinity) - 60)
	return {
		width: Math.max(WINDOW.minWidth, frameWidth),
		height: Math.max(WINDOW.minHeight, frameHeight - TITLE_BAR)
	}
}
