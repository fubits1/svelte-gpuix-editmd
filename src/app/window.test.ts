import { describe, expect, test } from 'vitest'
import { TITLE_BAR, WINDOW, windowSizeFor } from './window.ts'

// editmd's `initialFrame` (EditorWindowController.swift:95-104): the frame is min(860, w - 80) by min(940, h - 60)
describe('windowSizeFor', () => {
	test('on a screen with room, the content is editmd’s 860×940 frame less the title bar', () => {
		expect(windowSizeFor({ width: 1728, height: 1079 })).toEqual({
			width: 860,
			height: 940 - TITLE_BAR
		})
	})

	test('a small screen caps the frame 80px narrower and 60px shorter than its visible part', () => {
		// a 13" MacBook Air's visible frame below the menu bar
		expect(windowSizeFor({ width: 1470, height: 923 })).toEqual({
			width: 860,
			height: 923 - 60 - TITLE_BAR
		})
		expect(windowSizeFor({ width: 800, height: 600 })).toEqual({
			width: 720,
			height: 540 - TITLE_BAR
		})
	})

	test('with no screen read, the content is the uncapped frame’s, never below the minimum size', () => {
		expect(windowSizeFor(null)).toEqual({ width: 860, height: 940 - TITLE_BAR })
		expect(windowSizeFor({ width: 300, height: 200 })).toEqual({
			width: 420,
			height: 300 - TITLE_BAR
		})
	})

	// editmd sets NSWindow `minSize`, a frame size (EditorWindowController.swift:21); GPUI sets `contentMinSize`
	// (gpui_macos window.rs `setContentMinSize`), so the port's minimum leaves the title bar out
	test('the minimum is editmd’s 420×300 frame, given to gpuix as its content size', () => {
		expect([WINDOW.minWidth, WINDOW.minHeight + TITLE_BAR]).toEqual([420, 300])
	})
})
