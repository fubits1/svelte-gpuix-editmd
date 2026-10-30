/**
 * `editmd --snapshot FILE OUT.png [--dark] [--width N]` (Headless.swift:116-135): FILE rendered as the window shows
 * it, the whole page in one PNG. GPUI's headless renderer is at most 538px tall (`MAX_HEADLESS_HEIGHT`), so the page
 * is pictured one viewport at a time while its column scrolls down, and the pieces are stitched
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { get_native, type GpuiStyle } from 'gpuix-svelte'
import {
	find_test_id,
	MAX_HEADLESS_HEIGHT,
	mount_headless,
	pump,
	screenshot,
	wait
} from 'gpuix-svelte/test'
import { TextFile } from '../core/textFile.ts'
import { decodePng, encodePng, type Pixels, stitch } from '../host/png.ts'
import { documentController } from '../ui/DocumentView/controller.svelte.ts'
import { paletteFor } from './palette.ts'
import HeadlessPage from './HeadlessPage.svelte'
import { ThemeController } from './theme.svelte.ts'

export type SnapshotRequest = { path: string; out: string; dark: boolean; width: number }

/**
 * editmd sizes its offscreen window to the page's `scrollHeight`, measured in a 900px window, so the page ends in that
 * window's 40vh (360px) of bottom padding, and caps it between 300px and 8000px
 */
const MEASURED_WINDOW_HEIGHT = 900
const PAGE_BOTTOM_SHARE = 0.4
const MIN_HEIGHT = 300
const MAX_HEIGHT = 8000

/** how long the page may take to settle (images decoded, columns measured), and how long it must hold still */
const SETTLE_TIMEOUT_MS = 3000
const SETTLE_STILL_MS = 300
const SETTLE_POLL_MS = 50

/** `#rrggbb` as a pixel's red, green and blue */
function rgbOf(hex: string): [number, number, number] {
	const value = Number.parseInt(hex.slice(1), 16)
	return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

/** a picture `width`×`height` in one opaque colour, under the pieces, for rows no viewport reached */
function filled(width: number, height: number, hex: string): Pixels {
	const data = new Uint8Array(width * height * 4)
	const [red, green, blue] = rgbOf(hex)
	for (let at = 0; at < data.length; at += 4) data.set([red, green, blue, 255], at)
	return { width, height, data }
}

/** a length the view sets in px, 0 where it sets none */
const pixelsOf = (value: GpuiStyle[string]): number => (typeof value === 'number' ? value : 0)

/** the page's painted height, settled: images and diagrams take a few frames to size themselves */
async function settledHeight(contentId: number): Promise<number> {
	const native = get_native()
	const heightNow = () => native?.getElementBounds(contentId)?.height ?? 0
	const started = Date.now()
	let height = heightNow()
	let stillSince = Date.now()
	while (Date.now() - started < SETTLE_TIMEOUT_MS) {
		await wait(SETTLE_POLL_MS)
		pump()
		const next = heightNow()
		if (next !== height) {
			height = next
			stillSince = Date.now()
		} else if (Date.now() - stillSince >= SETTLE_STILL_MS) break
	}
	return height
}

/** writes the snapshot of `path` to `out` and returns `out`; throws when FILE cannot be read or OUT written */
export async function snapshot({ path, out, dark, width }: SnapshotRequest): Promise<string> {
	const text = TextFile.fromData(readFileSync(path)).text
	const appearance = dark ? 'dark' : 'light'
	// nothing outside the page: no file watch, no agent socket, no picker; the folder resolves relative images
	documentController.load(text, { onExit: () => {} })
	documentController.folder = dirname(path)
	const theme = new ThemeController({
		readAppearance: () => appearance,
		initialAppearance: () => appearance
	})
	// editmd never makes its offscreen page first responder (Headless.swift:92-100), so an open field paints no caret
	mount_headless(HeadlessPage, {
		width,
		height: MAX_HEADLESS_HEIGHT,
		props: { theme, autofocus: false }
	})

	const page = find_test_id('snapshot-page')
	const content = find_test_id('snapshot-content')
	const document = find_test_id('document')
	const native = get_native()
	if (!page || !content || !document || !native) throw new Error('the page did not render')

	const painted = await settledHeight(content.id)
	// the view ends the page in 40% of the headless viewport; editmd's ends in 40% of its 900px window
	const bottom = pixelsOf(document.style?.paddingBottom)
	const pageHeight = Math.round(
		Math.min(
			Math.max(painted - bottom + PAGE_BOTTOM_SHARE * MEASURED_WINDOW_HEIGHT, MIN_HEIGHT),
			MAX_HEIGHT
		)
	)

	const scratch = mkdtempSync(join(tmpdir(), 'editmd-gpuix-snapshot-'))
	try {
		const pieces: { pixels: Pixels; y: number }[] = []
		let scale = 0
		for (let top = 0; top < pageHeight; top += MAX_HEADLESS_HEIGHT) {
			native.scrollTo(page.id, 0, -top)
			pump()
			// GPUI stops the column at its end, so the last viewport may sit higher than asked
			const shown = -(native.getScrollOffset(page.id)?.[1] ?? 0)
			const pixels = decodePng(readFileSync(screenshot(join(scratch, `${pieces.length}.png`))))
			scale = pixels.width / width
			pieces.push({ pixels, y: Math.round(shown * scale) })
			if (shown < top) break
		}
		const height = Math.round(pageHeight * scale)
		const background = filled(
			pieces[0]?.pixels.width ?? 0,
			height,
			paletteFor(appearance).background
		)
		writeFileSync(out, encodePng(stitch([{ pixels: background, y: 0 }, ...pieces], height)))
	} finally {
		rmSync(scratch, { recursive: true, force: true })
	}
	return out
}
