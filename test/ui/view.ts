/**
 * the headless UI suite's view sections: the system appearance and zoom, the selection colour and the page's
 * scrollbar thumb
 */
import './harness.ts'
import {
	app,
	captureWindow,
	clickLinkIn,
	getDevicePixel,
	getDiagramSrc,
	getField,
	getInkColour,
	getMonoLook,
	getPalette,
	getProp,
	isNear,
	isolated,
	mixColour,
	parityDirectory,
	parityOptions,
	remoteServer,
	remount,
	sandboxOptions,
	setApp,
	settleAfter,
	toHalfPixels
} from './harness.ts'
import { check } from './check.ts'
import {
	bounds,
	click_test_id,
	drag_select,
	find,
	find_test_id,
	mount_headless,
	press,
	settle,
	type,
	wait,
	wait_for,
	wheel
} from 'gpuix-svelte/test'
import { rmSync } from 'node:fs'
import App from '../../App.svelte'
import { mermaidPaletteFor, paletteFor, textThemeFor } from '../../src/app/palette.ts'
import { ThemeController, themeController } from '../../src/app/theme.svelte.ts'
import type { Appearance } from '../../src/host/appearance.ts'
import { documentController } from '../../src/ui/DocumentView/controller.svelte.ts'

export async function testAppearanceAndZoom(): Promise<void> {
	// the appearance follows the system live: an injected reader stands in for `defaults`, polled every 50ms
	const systemAnswers: Appearance[] = ['light']
	const polledTheme = new ThemeController({
		readAppearance: () => systemAnswers.at(-1) ?? 'light',
		pollInterval: 50,
		// a scroller that always shows, so its thumb paints at rest whatever this Mac's setting
		readScrollerStyle: () => 'legacy'
	})
	await remount({ theme: polledTheme })
	documentController.load(
		'Body[^1]\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n[^1]: Note.\n',
		isolated
	)
	settle()

	/** what each appearance-dependent part paints in: block text, footnote text, window background */
	function getAppearanceLook() {
		const blockTheme = find((node) => node.type === 'markdown')?.customProps?.theme
		return {
			appearance: getField(blockTheme, 'appearance'),
			text: getField(blockTheme, 'text'),
			footnoteText: getField(getProp('footnote-2', 'theme'), 'text'),
			background: find_test_id('window')?.style?.backgroundColor
		}
	}
	/** what `getAppearanceLook` reads once the window paints in `appearance`'s palette */
	const getExpectedLook = (appearance: Appearance) => ({
		appearance,
		text: paletteFor(appearance).text,
		footnoteText: paletteFor(appearance).muted,
		background: paletteFor(appearance).background
	})
	const lightLook = getAppearanceLook()
	const lightDiagram = getProp('mermaid-1', 'src')

	/** the colour gpuix's Scroller paints App's scrollbar thumb in, plain and hovered, as resolved from the palette */
	function getThumbColours() {
		const style = find_test_id('page-scroller-thumb')?.style
		return [style?.backgroundColor, style?.hover?.backgroundColor]
	}
	// the scroller style is read as the theme starts and lands a turn later, the thumb painting with it
	await settleAfter(20)
	const lightThumb = getThumbColours()
	systemAnswers.push('dark')
	await settleAfter(150)
	check(
		'the next poll after the system turns dark repaints blocks, footnotes, diagrams and the window in the dark palette',
		[lightLook, getAppearanceLook(), lightDiagram, getProp('mermaid-1', 'src')],
		[
			getExpectedLook('light'),
			getExpectedLook('dark'),
			// the diagram is its own source drawn in pele's light palette, then in its dark one
			getDiagramSrc('flowchart LR\n  A --> B', mermaidPaletteFor('light')),
			getDiagramSrc('flowchart LR\n  A --> B', mermaidPaletteFor('dark'))
		]
	)
	// editmd shows the system's overlay scroller, a quiet grey in either appearance
	check(
		'the scrollbar thumb paints in the palette’s faint grey, muted when hovered, in light and in dark',
		[lightThumb, getThumbColours()],
		[
			[paletteFor('light').faint, paletteFor('light').muted],
			[paletteFor('dark').faint, paletteFor('dark').muted]
		]
	)

	// the poll reads the system without blocking the main thread: an async reader stands in for `readSystemAppearance`
	const asyncAnswers: Appearance[] = ['light']
	const asyncTheme = new ThemeController({
		initialAppearance: () => 'light',
		readAppearance: () => Promise.resolve(asyncAnswers.at(-1) ?? 'light'),
		pollInterval: 50
	})
	await remount({ theme: asyncTheme })
	settle()
	const asyncLightLook = getAppearanceLook()
	asyncAnswers.push('dark')
	await settleAfter(150)
	check(
		'an async appearance read that answers dark repaints blocks, footnotes and the window in the dark palette',
		[asyncLightLook, getAppearanceLook()],
		[getExpectedLook('light'), getExpectedLook('dark')]
	)

	// a system already dark when the window opens: its first frame is dark, with no poll needed to get there
	const darkLook = getExpectedLook('dark')
	// every read of the injected system, counted: the poll's first is 60s away, so any read before then is not the poll's
	let darkFromStartReads = 0
	const darkFromStartTheme = new ThemeController({
		readAppearance: () => {
			darkFromStartReads++
			return 'dark'
		},
		pollInterval: 60_000
	})
	const readsAtConstruction = darkFromStartReads
	await remount({ theme: darkFromStartTheme })
	const firstFrameLook = getAppearanceLook()
	settle()
	check(
		'a window whose system is dark from the start paints its first frame dark, before any poll',
		[firstFrameLook, getAppearanceLook()],
		[darkLook, darkLook]
	)
	check(
		'the first paint’s appearance is read synchronously, once: one read by the time the constructor returns, none more by the first frame',
		[readsAtConstruction, darkFromStartReads],
		[1, 1]
	)

	/**
	 * a slow `defaults` (300ms) under a 50ms poll: the ticks it overlaps are skipped, so no second read starts while
	 * one is pending
	 */
	let pendingReads = 0
	let mostPendingReads = 0
	let slowReads = 0
	const slowTheme = new ThemeController({
		initialAppearance: () => 'light',
		readAppearance: () => {
			slowReads++
			pendingReads++
			mostPendingReads = Math.max(mostPendingReads, pendingReads)
			return new Promise<Appearance>((resolve) =>
				setTimeout(() => {
					pendingReads--
					resolve('light')
				}, 300)
			)
		},
		pollInterval: 50
	})
	await remount({ theme: slowTheme })
	await wait(800)
	check(
		'a read that takes 300ms under a 50ms poll is the only one pending, the poll reading again once it answers',
		[mostPendingReads, slowReads >= 2],
		[1, true]
	)
	await app.unmount()

	// the default poll: no option given, the first read comes 2s after the window starts its theme, the next 2s later
	const appearanceReadTimes: number[] = []
	const defaultPollTheme = new ThemeController({
		initialAppearance: () => 'light',
		readAppearance: () => {
			appearanceReadTimes.push(performance.now())
			return 'light'
		}
	})
	const mountingAt = performance.now()
	setApp(mount_headless(App, { width: 800, height: 538, props: { theme: defaultPollTheme } }))
	await wait_for(() => appearanceReadTimes.length > 1, {
		label: 'the second default poll',
		timeout: 5000
	}).catch(() => null)
	const firstReadAfter = (appearanceReadTimes[0] ?? Number.POSITIVE_INFINITY) - mountingAt
	const secondReadAfter =
		(appearanceReadTimes[1] ?? Number.POSITIVE_INFINITY) -
		(appearanceReadTimes[0] ?? Number.POSITIVE_INFINITY)
	// whole seconds, so the mount's own few ms do not count
	check(
		'with no pollInterval the appearance is read every 2s: the first read lands 2s after the window starts, the second 2s after the first',
		[Math.round(firstReadAfter / 1000), Math.round(secondReadAfter / 1000)],
		[2, 2]
	)

	/**
	 * AppKit's focus ring follows the Mac's accent colour (`keyboardFocusIndicatorColor`), so the theme asks for it as the
	 * window starts and again when the appearance changes, painting it over the palette's fallback; a read that fails
	 * keeps the fallback of the appearance shown
	 */
	let ringAppearance: Appearance = 'light'
	const ringAnswers: Record<Appearance, string | null> = { light: '#11223344', dark: null }
	const ringTheme = new ThemeController({
		initialAppearance: () => 'light',
		readAppearance: () => ringAppearance,
		readScrollerStyle: () => 'overlay',
		readFocusRing: () => ringAnswers[ringAppearance],
		pollInterval: 50
	})
	await remount({ theme: ringTheme })
	documentController.load('Ring\n', isolated)
	press('cmd-f')
	await wait(250)
	const lightRing = find_test_id('find-field-box')?.style?.outlineColor
	ringAppearance = 'dark'
	await wait(300)
	const darkRing = find_test_id('find-field-box')?.style?.outlineColor
	press('escape')
	check(
		'the find field’s ring is the focus ring AppKit answers, read again when the appearance changes; a failed read keeps the palette’s fallback',
		[lightRing, darkRing],
		['#11223344', paletteFor('dark')['focus-ring']]
	)
	await remount()

	// View > Zoom (Cmd-=, Cmd--, Cmd-0) scales native text and the views' own lengths, as editmd's page zoom
	documentController.load('---\ntitle: A\n---\n\nBody\n', isolated)
	settle()

	/** the body Block's text size in the native theme and the front matter's mono size, as painted */
	function getZoomedSizes() {
		// the front matter's own <markdown> comes first; the body's is the next one
		const blockTheme = find(
			(node) => node.type === 'markdown' && node.testId?.startsWith('frontmatter-') !== true
		)?.customProps?.theme
		return [
			getField(getField(blockTheme, 'metrics'), 'mdTextSize'),
			getMonoLook('frontmatter-0')[1]
		]
	}
	/** the column's left padding and the gap between the first two Blocks, as painted: lengths of the views' own */
	function getZoomedLengths() {
		const first = bounds(find_test_id('block-0') ?? 0)
		const second = bounds(find_test_id('block-1') ?? 0)
		if (!first || !second) return null

		return [first.x, Math.round((second.y - first.y - first.height) * 1000) / 1000]
	}
	const lengthsBefore = getZoomedLengths()
	press('cmd-=')
	settle()
	const zoomedIn = getZoomedSizes()
	check('Cmd-= zooms block text and the front matter box by 1.1', zoomedIn, [17.6, 13.75])
	/**
	 * at actual size the 736px column sits centred in the 800px window, its Blocks 40px inside it; at 1.1 the column
	 * would be 809.6px, so it fills the window and only its zoomed 44px padding is left of the first Block
	 */
	check(
		'Cmd-= zooms the column’s padding and the space under the front matter by 1.1 too, editmd’s 40px and 2rem',
		[lengthsBefore, getZoomedLengths()],
		[
			[(800 - 736) / 2 + 40, 32],
			[toHalfPixels(40 * 1.1), toHalfPixels(32 * 1.1)]
		]
	)
	// an open Block's field is native text too, so it takes the zoomed theme: 17.6px text at 1.1
	click_test_id('block-1')
	check(
		'a Block field opened at Cmd-= takes the zoomed text theme',
		[
			getField(getField(getProp('block-editor', 'theme'), 'metrics'), 'mdTextSize'),
			getProp('block-editor', 'theme')
		],
		[17.6, textThemeFor(themeController.appearance, 1.1)]
	)
	press('escape')
	press('cmd-0')
	settle()
	// from the zoomed sizes, so the check fails while zoom does nothing at all
	check(
		'Cmd-0 restores the actual size',
		[zoomedIn, getZoomedSizes()],
		[
			[17.6, 13.75],
			[16, 12.5]
		]
	)
	press('cmd--')
	settle()
	// 16 / 1.1 and 12.5 / 1.1, rounded to three decimals as the theme and the size tokens are
	check('Cmd-- zooms out one step, dividing by 1.1', getZoomedSizes(), [14.545, 11.364])
	press('cmd-0')
	for (let step = 0; step < 10; step++) press('cmd--')
	settle()
	check('Cmd-- stops at half size', getZoomedSizes(), [8, 6.25])
	press('cmd-0')
	// 1.1 to the 12th is past 3, so 15 steps reach the upper clamp
	for (let step = 0; step < 15; step++) press('cmd-=')
	settle()
	check('Cmd-= stops at three times the size', getZoomedSizes(), [48, 37.5])
	press('cmd-0')

	// editmd's page zoom grows diagrams and nested list indentation with the text
	documentController.load('```mermaid\ngraph TD\n  A-->B\n```\n\n- [ ] a\n  - [ ] b\n', isolated)
	settle()
	/** the diagram's painted width, and how far the nested task's checkbox sits right of the outer one */
	function getZoomedDrawing() {
		const diagram = bounds(find_test_id('mermaid-0') ?? 0)
		// a task's id is its mark's offset in the Document: after the 33-character fence, 36 and 46
		const outer = bounds(find_test_id('task-36') ?? 0)
		const nested = bounds(find_test_id('task-46') ?? 0)
		return [diagram?.width ?? 0, outer && nested ? nested.x - outer.x : 0]
	}
	const [diagramWidthBefore, indentBefore] = getZoomedDrawing()
	press('cmd-=')
	settle()
	const [diagramWidthZoomed, indentZoomed] = getZoomedDrawing()
	press('cmd-0')
	settle()
	check(
		'Cmd-= grows a mermaid diagram and a nested task’s indentation by 1.1',
		[
			diagramWidthBefore > 0 && Math.abs(diagramWidthZoomed / diagramWidthBefore - 1.1) <= 0.01,
			indentBefore,
			indentZoomed
		],
		// `ul { padding-left: 1.75em }`: 28px a level
		[true, 28, toHalfPixels(28 * 1.1)]
	)
}

export async function testSelectionColour(): Promise<void> {
	/**
	 * editmd's selection is `--selection`, the accent at 22% (style.css:12, 60-62), where gpuix washes at its accent's 35%:
	 * the window sets `selection-color` for its whole subtree, which the page's painted text takes and its fields do not.
	 */
	documentController.load('Select every word of this line.\n', sandboxOptions)
	settle()
	const selectionStyle = find_test_id('window')?.style?.selectionColor
	const selectBox = bounds(find_test_id('block-0') ?? 0)
	if (selectBox) {
		drag_select(
			{ x: selectBox.x + 1, y: selectBox.y + selectBox.height / 2 },
			{ x: selectBox.x + selectBox.width - 1, y: selectBox.y + selectBox.height / 2 }
		)
	}
	const paintedWash = selectBox
		? getInkColour(captureWindow(), selectBox, [
				getPalette().background ?? '',
				getPalette().text ?? ''
			])
		: null
	click_test_id('block-0')
	type('cmd-a')
	settle()
	const fieldBox = bounds(find_test_id('block-editor') ?? 0)
	const fieldWash = fieldBox
		? getInkColour(captureWindow(), fieldBox, [
				getPalette().background ?? '',
				getPalette().text ?? ''
			])
		: null
	press('escape')
	const wantedWash = mixColour(getPalette().accent ?? '', getPalette().background ?? '', 0.22)
	// a <textarea> ignores selection-color, inherited or its own, so a field keeps gpuix's own selection wash
	check(
		`the painted text’s selection washes in editmd’s accent at 22%; a field’s keeps gpuix’s own wash, which refuses selection-color (style ${selectionStyle}; painted ${paintedWash}, want ${wantedWash}; field ${fieldWash})`,
		[
			selectionStyle,
			isNear(paintedWash ?? '', wantedWash, 6),
			isNear(fieldWash ?? '', wantedWash, 6)
		],
		[getPalette().selection, true, false]
	)
}

export async function testScrollbarThumb(): Promise<void> {
	const scrolledPage = `${Array.from({ length: 80 }, (_, n) => `Paragraph ${n}.`).join('\n\n')}\n`
	/**
	 * editmd's page scroller is AppKit's overlay style on a Mac that shows scroll bars automatically: no thumb at
	 * rest, shown while the page scrolls and for about a second after, whatever scrolls it; the legacy style shows it
	 * always. per style: what the middle of the thumb's box paints at rest, just after `scroll` (a wheel scroll of
	 * `source`), and 1.5s later
	 */
	async function loadThumbLook(
		style: 'overlay' | 'legacy',
		source = scrolledPage,
		scroll = () => wheel({ x: 400, y: 300 }, 0, -200)
	) {
		const scrollerTheme = new ThemeController({
			readAppearance: () => 'light',
			readScrollerStyle: () => style
		})
		await remount({ theme: scrollerTheme })
		documentController.load(source, parityOptions)
		settle()
		// the Scroller measures its thumb every 250ms
		await settleAfter(400)
		const getThumbLook = () => {
			const thumb = bounds(find_test_id('page-scroller-thumb') ?? 0)
			const capture = captureWindow()
			if (!thumb || thumb.height === 0) return 'no box'

			const colour = getDevicePixel(
				capture,
				Math.round((thumb.x + thumb.width / 2) * capture.scale),
				Math.round((thumb.y + thumb.height / 2) * capture.scale)
			)
			return isNear(colour, paletteFor('light').background, 4) ? 'none' : 'thumb'
		}
		const atRest = getThumbLook()
		scroll()
		settle()
		// a Find match is read from the paint on Find's poll, so its scroll comes a few frames after the query
		await settleAfter(400)
		const scrolled = getThumbLook()
		await settleAfter(1500)
		return [atRest, scrolled, getThumbLook()]
	}
	check(
		'the page’s scrollbar thumb follows the system’s scroller style: overlay shows none at rest, shows while scrolling and is gone 1.5s later; legacy shows it throughout',
		[await loadThumbLook('overlay'), await loadThumbLook('legacy')],
		[
			['none', 'thumb', 'none'],
			['thumb', 'thumb', 'thumb']
		]
	)
	const linkedPage = `[Jump to the end](#the-end)\n\n${scrolledPage}\n# The end\n\nLast zebra.\n`
	check(
		'an overlay scroller’s thumb shows while a followed link or a Find match scrolls the page, as macOS shows it during any scroll, and is gone 1.5s later',
		[
			await loadThumbLook('overlay', linkedPage, () => clickLinkIn('block-0', 'cmd')),
			await loadThumbLook('overlay', linkedPage, () => {
				press('cmd-f')
				for (const key of 'zebra') type(key)
			})
		],
		[
			['none', 'thumb', 'none'],
			['none', 'thumb', 'none']
		]
	)

	rmSync(parityDirectory, { recursive: true, force: true })

	remoteServer.closeAllConnections()
	remoteServer.close()
}
