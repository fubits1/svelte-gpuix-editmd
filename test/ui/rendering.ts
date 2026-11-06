/**
 * the headless UI suite's rendering checks: how Blocks, lists, tasks, tables, images, diagrams and footnotes paint,
 * the page's layout and the pixels it paints, against editmd's
 */
import './harness.ts'
import {
	badgeDirectory,
	type Box,
	captureWindow,
	clickIfPresent,
	continuationRow,
	continuationText,
	countRunsAlong,
	createPng,
	directory,
	fileImageDirectory,
	findFirstRowNear,
	findQuery,
	firstItemText,
	getCentre,
	getDevicePixel,
	getDiagramSrc,
	getField,
	getGapLines,
	getInkColour,
	getLongestRunColour,
	getMonoLook,
	getPalette,
	getProp,
	getText,
	getTipOffset,
	initContinuationRows,
	initFileImageDirectory,
	initParityFolder,
	isNear,
	isolated,
	linkOptions,
	loadFindState,
	loadNumberedLinesInSource,
	loadTipAfterHover,
	lookDirectory,
	menuDirectory,
	menuOptions,
	menuRuns,
	mergeByEta,
	mixColour,
	namingDirectory,
	openFixture,
	openMenu,
	parityDirectory,
	parityOptions,
	readFixture,
	remote,
	remount,
	sandboxDirectory,
	sandboxOptions,
	saveDirectory,
	settleAfter,
	snapToWanted,
	toHalfPixels,
	waitForFieldIdle,
	waitUntil
} from './harness.ts'
import { check } from './check.ts'
import {
	bounds,
	click_at,
	click_test_id,
	find,
	find_all,
	find_test_id,
	key_up,
	mouse_move,
	painted,
	painted_highlights,
	press,
	pump,
	settle,
	type,
	type TreeNode,
	wheel
} from 'gpuix-svelte/test'
import { window_size } from 'gpuix-svelte'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { diagramOf } from '../../src/app/diagrams.ts'
import { findController } from '../../src/app/find.svelte.ts'
import { heldLinkThemeFor, paletteFor, textThemeFor } from '../../src/app/palette.ts'
import { ThemeController, themeController } from '../../src/app/theme.svelte.ts'
import { TABLE } from '../../src/core/blockCommands.ts'
import { type Appearance, systemAppearance } from '../../src/host/appearance.ts'
import { LegendPreference } from '../../src/host/legendPreference.ts'
import { fetchImageHead } from '../../src/host/imageFetch.ts'
import type { Pixels } from '../../src/host/png.ts'
import { documentController } from '../../src/ui/DocumentView/controller.svelte.ts'
import { monoLinesSource } from '../../src/app/monoLines.ts'

/** the space painted between each Block and the one after it, from their bounds */
function getBlockGaps(): number[] {
	const boxes = documentController.blocks.map((_block, index) =>
		bounds(find_test_id(`block-${index}`) ?? 0)
	)
	return boxes.slice(1).map((box, index) => {
		const above = boxes[index]
		return box && above ? box.y - above.y - above.height : Number.NaN
	})
}

/** a cell of the table whose Block's test key is `key`, by row and column */
const getCell = (row: number, column: number, key = '0') =>
	find_test_id(`table-cell-${key}-${row}-${column}`)
// a cell holds a box sized to its text, which holds first the box its <markdown> reports its layout through
const getCellMarkdown = (row: number, column: number, key = '0') =>
	getCell(row, column, key)?.children?.[0]?.children?.[0]?.children?.[0]
const getCellSource = (row: number, column: number, key = '0') =>
	getCellMarkdown(row, column, key)?.customProps?.source

/** the most pixels within 4 of `colour` along any one device row inside `box` (logical px) */
function countMostInARow(
	capture: { shot: Pixels; scale: number },
	box: Box,
	colour: string
): number {
	const { scale } = capture
	let most = 0
	for (let y = Math.ceil(box.y * scale); y < Math.floor((box.y + box.height) * scale); y++) {
		let count = 0
		for (let x = Math.ceil(box.x * scale); x < Math.floor((box.x + box.width) * scale); x++)
			if (isNear(getDevicePixel(capture, x, y), colour, 4)) count++

		most = Math.max(most, count)
	}
	return most
}

/** what the link underline paints over the page: the accent at 60% (editmd's: 35%) over the background */
const getLinkUnderlineInk = () =>
	mixColour(getPalette().accent ?? '', getPalette().background ?? '', 0.6)

export async function testBlocks(): Promise<void> {
	press('escape')

	rmSync(directory, { recursive: true, force: true })

	documentController.load(
		'See the [docs] and [the log][log].\n\n[docs]: https://example.com/docs\n[log]: https://example.com/log\n',
		isolated
	)
	settle()
	const references = painted()
	check(
		'reference links resolve against definitions in other blocks',
		references.includes('See the docs and the log.')
	)
	// editmd shows a definition as its source line, so it stays visible and clickable
	check(
		'definition blocks paint their source line',
		references.includes('[docs]: https://example.com/docs')
	)

	documentController.load('- [ ] todo **soon**\n- [x] done\n  - [ ] nested\n', isolated)
	settle()
	/**
	 * where a task row puts its box and text against the list's left edge, in centres (GPUI's `bounds` gives a bordered
	 * box inside its border): `ul { padding-left: 1.75em }` puts the text 28px in per level, and the box
	 * (`left: -1.55em; top: 0.3em`, 1em square) 24.8px before it, its centre 11.2px in; vertically 13.5px below the row's
	 * top, the 4.8px of `top` plus the 0.7px GPUI sets its text lower in the line than WebKit (r-tasks shots: box centre
	 * 0.25px above the text's ink centre in editmd)
	 */
	function getTaskGeometry(mark: number, contentStart: number): number[] {
		const list = bounds(find_test_id('task-list-0') ?? 0)
		const box = bounds(find_test_id(`task-${mark}`) ?? 0)
		const row = bounds(find_test_id(`task-row-${contentStart}`) ?? 0)
		const text = bounds(find_test_id(`task-text-${contentStart}`) ?? 0)
		if (!list || !box || !row || !text) return []

		const round = (value: number) => Math.round(value * 10) / 10
		return [
			round(box.x + box.width / 2 - list.x),
			round(text.x - list.x),
			round(box.y + box.height / 2 - row.y)
		]
	}
	check(
		'a task’s box centre sits 11.2px into the list and its text 28px, a nested one 28px further, the box centre 13.5px below the row top',
		// GPUI lays out on the half-pixel grid, so 11.2 paints at 11
		[
			snapToWanted(getTaskGeometry(3, 6), [11.2, 28, 13.5]),
			snapToWanted(getTaskGeometry(36, 39), [39.2, 56, 13.5])
		],
		[
			[11.2, 28, 13.5],
			[39.2, 56, 13.5]
		]
	)
	check('task lists paint no literal brackets', painted().includes('[ ]'), false)
	check('task text keeps its inline formatting', painted().includes('todo soon'))

	click_test_id('task-3')
	check(
		'clicking a checkbox ticks the task in the source',
		documentController.text,
		'- [x] todo **soon**\n- [x] done\n  - [ ] nested\n'
	)
	check('ticking does not open the block for editing', documentController.activeIndex, null)
	click_test_id('task-3')
	check(
		'clicking a ticked checkbox unticks the task in the source',
		documentController.text,
		'- [ ] todo **soon**\n- [x] done\n  - [ ] nested\n'
	)
	// editmd ticks a task on a click anywhere in the gutter left of its text (editor.ts:414-416), not only on the box
	const taskBox = bounds(find_test_id('task-3') ?? 0)
	if (taskBox) click_at(taskBox.x - 3, taskBox.y + taskBox.height / 2)

	check(
		`a click in the gutter left of the checkbox, not on it, ticks the task in the source (at x ${taskBox ? taskBox.x - 3 : 'none'})`,
		[documentController.text, documentController.activeIndex],
		['- [x] todo **soon**\n- [x] done\n  - [ ] nested\n', null]
	)
	click_test_id('task-3')

	/**
	 * a plain list as editmd's browser lays it out (style.css:230-240, r-lists shots): text 28px in per level, a muted
	 * marker centred 14.5px before the text and 14px below the row's top, a filled disc at the top level and a hollow
	 * circle below it, rows 26.4px tall and 3.2px apart; numbers count on from the first as an `ol` does, right-aligned
	 * one space (4.4px) before the text, whatever the source wrote after the first
	 */
	documentController.load(
		'* star **bullet**\n* another\n  * nested\n  * nested two\n\n3. one\n3. two\n',
		isolated
	)
	settle()
	/** a plain list row's geometry against its list: text x, marker centre x from the text, marker centre y, row top */
	function getListRow(list: number, contentStart: number) {
		const listBox = bounds(find_test_id(`list-${list}`) ?? 0)
		const text = bounds(find_test_id(`list-text-${contentStart}`) ?? 0)
		const marker = bounds(find_test_id(`list-marker-${contentStart}`) ?? 0)
		const row = bounds(find_test_id(`list-row-${contentStart}`) ?? 0)
		if (!listBox || !text || !marker || !row) return null

		const round = (value: number) => Math.round(value * 10) / 10
		return {
			text: round(text.x - listBox.x),
			markerX: round(marker.x + marker.width / 2 - text.x),
			markerY: round(marker.y + marker.height / 2 - row.y),
			top: round(row.y - listBox.y)
		}
	}
	// where each item's text starts in the source
	const bulletStarts = [2, 20, 32, 43]
	const bulletRows = bulletStarts.map((start) => getListRow(0, start))
	const discStyle = find_test_id('list-marker-2')?.style
	const circleStyle = find_test_id('list-marker-32')?.style
	const numberRows = [58, 65].map((start) => getListRow(1, start))
	const numberMarker = bounds(find_test_id('list-marker-58') ?? 0)
	const numberText = bounds(find_test_id('list-text-58') ?? 0)
	check(
		'a plain list paints rows of muted markers beside native text: discs then hollow circles, 28px a level, 29.6px apart, numbers as an ol counts them',
		[
			bulletRows.map((row) => row && [row.text, row.markerX, row.markerY]),
			snapToWanted(
				bulletRows.map((row) => row?.top ?? Number.NaN),
				[0, 29.6, 59.2, 88.8]
			),
			[discStyle?.backgroundColor, discStyle?.borderWidth ?? 0],
			[circleStyle?.backgroundColor ?? null, circleStyle?.borderWidth, circleStyle?.borderColor],
			[getText('list-marker-58'), getText('list-marker-65')],
			numberRows.map((row) => row?.text),
			numberMarker && numberText
				? snapToWanted([numberMarker.x + numberMarker.width - numberText.x], [-4.4])[0]
				: null,
			painted().includes('star bullet')
		],
		[
			[
				[28, -14.5, 14],
				[28, -14.5, 14],
				[56, -14.5, 14],
				[56, -14.5, 14]
			],
			[0, 29.6, 59.2, 88.8],
			[themeController.palette.muted, 0],
			[null, 1, themeController.palette.muted],
			['3.', '4.'],
			[28, 28],
			-4.4,
			true
		]
	)

	documentController.load('---\ntitle: A\ntags: [x]\n---\n\nBody.\n', isolated)
	settle()
	check(
		'front matter shows verbatim in its own box, fences included',
		// painted by native <markdown> as one code span per line (`monoLinesSource`)
		getProp('frontmatter-0', 'source'),
		monoLinesSource('---\ntitle: A\ntags: [x]\n---')
	)
}

export async function testDiagramsImagesFootnotes(): Promise<void> {
	documentController.load('', isolated)
	rmSync(namingDirectory, { recursive: true, force: true })

	documentController.load(
		'```mermaid\nflowchart LR\n  A --> B\n```\n\n```mermaid\nflowchart LR\n  A -->\n```\n',
		isolated
	)
	settle()
	check('a mermaid fence paints as a diagram image', find_test_id('mermaid-0')?.type, 'img')
	check(
		'a broken diagram shows its error instead of an image',
		find_test_id('mermaid-error-1')?.type,
		'markdown'
	)

	const firstFenceSrc = getProp('mermaid-0', 'src')
	const brokenDiagram = diagramOf('flowchart LR\n  A -->', themeController.mermaidPalette)
	check(
		'the error paints diagramOf’s message for that source, in the palette’s danger colour',
		[
			brokenDiagram.kind,
			brokenDiagram.kind === 'error' && brokenDiagram.message.length > 0,
			getProp('mermaid-error-1', 'source'),
			getMonoLook('mermaid-error-1')[0]
		],
		[
			'error',
			true,
			brokenDiagram.kind === 'error' ? monoLinesSource(brokenDiagram.message) : null,
			themeController.palette.danger
		]
	)
	documentController.load('```mermaid\nflowchart LR\n  C --> D\n```\n', isolated)
	settle()
	check(
		'a diagram’s image src is its own source drawn as SVG, so another fence paints another src',
		[
			firstFenceSrc,
			getProp('mermaid-0', 'src'),
			typeof firstFenceSrc === 'string' && firstFenceSrc !== getProp('mermaid-0', 'src')
		],
		[getDiagramSrc('flowchart LR\n  A --> B'), getDiagramSrc('flowchart LR\n  C --> D'), true]
	)

	/**
	 * editmd redraws a diagram whose source changed 300ms after the change, its first draw only at once (diagrams.ts:141-143):
	 * an outside write to a drawn diagram keeps the old drawing at first, and shows the new one after the pause
	 */
	const mermaidDirectory = mkdtempSync(join(tmpdir(), 'eg-mermaid-'))
	const mermaidPath = join(mermaidDirectory, 'diagram.md')
	writeFileSync(mermaidPath, '# Diagram\n\n```mermaid\nflowchart LR\n  A --> B\n```\n')
	documentController.open(mermaidPath, {
		...isolated,
		socketsDirectory: join(mermaidDirectory, 's'),
		legendPreference: new LegendPreference(join(mermaidDirectory, 'legend.json'))
	})
	settle()
	const drawnBefore = getProp('mermaid-1', 'src')
	writeFileSync(mermaidPath, '# Diagram\n\n```mermaid\nflowchart LR\n  A --> C\n```\n')
	await waitUntil(
		() => documentController.text.includes('A --> C'),
		'the outside change to the diagram'
	)
	settle()
	const drawnAtOnce = getProp('mermaid-1', 'src')
	await settleAfter(450)
	check(
		'an outside change to a drawn diagram keeps the old drawing at first and shows the new one 300ms later',
		[
			drawnBefore === getDiagramSrc('flowchart LR\n  A --> B'),
			drawnAtOnce === drawnBefore,
			getProp('mermaid-1', 'src')
		],
		[true, true, getDiagramSrc('flowchart LR\n  A --> C')]
	)
	documentController.load('', isolated)
	rmSync(mermaidDirectory, { recursive: true, force: true })

	// images: local ones paint as <img> resolved against the document's folder; remote ones are blocked until allowed
	const imageDirectory = mkdtempSync(join(tmpdir(), 'eg-images-'))
	const imagePath = join(imageDirectory, 'with-images.md')
	writeFileSync(join(imageDirectory, 'pic.png'), createPng(300, 200))
	writeFileSync(join(imageDirectory, 'wide.png'), createPng(1600, 800))
	writeFileSync(imagePath, `![local](pic.png) ![wide](wide.png)\n\n![tracker](${remote}/p.png)\n`)
	documentController.open(imagePath, { ...isolated, socketsDirectory: join(imageDirectory, 's') })
	settle()
	check('a local image paints as an image', find_test_id('image-0-0')?.type, 'img')
	// the view takes its column's width from the column's layout event, which the paint reports with no clock advance
	pump()
	const naturalBounds = bounds(find_test_id('image-0-0') ?? 0)
	// the 800px test window holds editmd's whole 736px column, which less its 40px padding either side is 656px wide
	const wideBounds = bounds(find_test_id('image-0-1') ?? 0)
	check(
		'a local image paints at its natural size',
		`${naturalBounds?.width}x${naturalBounds?.height}`,
		'300x200'
	)
	// editmd's page zoom grows images with the text: 1.1 times the natural size at Cmd-=
	press('cmd-=')
	pump()
	const zoomedImageBounds = bounds(find_test_id('image-0-0') ?? 0)
	// the zoomed page's column, the image paragraph's row, and the wide image fitted to it
	const zoomedColumn = bounds(find_test_id('block-0')?.children?.[0] ?? 0)
	const zoomedWide = bounds(find_test_id('image-0-1') ?? 0)
	press('cmd-0')
	pump()
	check(
		'Cmd-= grows a local image by 1.1, as editmd’s page zoom does',
		`${zoomedImageBounds?.width}x${zoomedImageBounds?.height}`,
		'330x220'
	)
	check(
		`a wide image follows its column’s width when the zoom changes it, with no clock advance (column ${zoomedColumn?.width}, image ${zoomedWide?.width}x${zoomedWide?.height})`,
		zoomedColumn && zoomedWide
			? [zoomedWide.width === zoomedColumn.width, zoomedWide.width / zoomedWide.height]
			: null,
		[true, 2]
	)
	check(
		'a wider image scales down to the column, keeping its aspect ratio',
		`${wideBounds?.width}x${wideBounds?.height}`,
		'656x328'
	)

	click_test_id('image-0-0')
	check(
		'clicking an image opens its paragraph’s source in a text field',
		find_test_id('block-editor')?.type,
		'textarea'
	)
	check('the image paragraph is the Active block', documentController.activeIndex, 0)
	press('escape')
	check(
		'its source resolves against the document folder',
		getProp('image-0-0', 'src'),
		join(imageDirectory, 'pic.png')
	)
	check(
		'a remote image is blocked: its alt text shows instead',
		find_test_id('image-blocked-1-0')?.children?.[0]?.text,
		'tracker'
	)

	documentController.allowRemoteImages()
	settle()
	check(
		'after Load Remote Images the remote image paints',
		getProp('image-1-0', 'src'),
		`${remote}/p.png`
	)
	check(
		'an image of unknown size keeps the fixed box',
		bounds(find_test_id('image-1-0') ?? 0)?.height,
		240
	)
	rmSync(imageDirectory, { recursive: true, force: true })

	/**
	 * footnotes: native <markdown> paints `[^1]` literally, so each reference paints its label in Unicode superscript
	 * characters with no link, as editmd's bare `sup` (preset-gfm footnote/reference.ts:33-45)
	 */
	documentController.load(
		'Text[^1] here.\n\n- [ ] task[^2]\n\n[^1]: First note.\n[^2]: Second.\n',
		isolated
	)
	settle()
	const footnoteLines = painted().split('\n')
	check(
		'a footnote reference paints as its label in superscript',
		footnoteLines.filter((line) => line.startsWith('Text')),
		['Text¹ here.']
	)
	check(
		'a footnote reference in a task item paints as its label in superscript',
		footnoteLines.filter((line) => line.startsWith('task')),
		['task²']
	)
	check(
		'no footnote reference paints literally outside the definitions',
		footnoteLines.filter(
			(line) => line.includes('[^') && !line.startsWith('[^1]:') && !line.startsWith('[^2]:')
		),
		[]
	)

	// a footnote definition is a labelled block, as editmd's `dl[data-type="footnote_definition"]`
	check(
		'each footnote definition paints its bare label',
		[2, 3].map((index) => find_test_id(`footnote-label-${index}`)?.children?.[0]?.text),
		['1', '2']
	)
	check(
		'a footnote definition paints its content as markdown',
		footnoteLines.filter((line) => line.includes('note.') || line.includes('Second.')),
		['First note.', 'Second.']
	)
	check(
		'no footnote reference or definition paints literally',
		footnoteLines.filter((line) => line.includes('[^')),
		[]
	)
	click_test_id('footnote-2')
	check(
		'clicking a footnote definition opens its source for editing',
		[documentController.activeIndex, find_test_id('block-editor')?.type],
		[2, 'textarea']
	)

	// native <markdown> and <textarea> ignore CSS variables, so editmd's text theme goes in through `theme`
	const textTheme = textThemeFor(systemAppearance())
	check(
		'the block editor paints in editmd’s text theme',
		getProp('block-editor', 'theme'),
		textTheme
	)
	press('escape')
	// a Block without links strikes in its text colour, which native draws in `textMuted` (`heldLinkThemeFor`)
	check(
		'a block’s native markdown paints in editmd’s text theme, a Block without links striking in its text colour',
		find((node) => node.type === 'markdown')?.customProps?.theme,
		heldLinkThemeFor(textTheme)
	)
}

export async function testBlockedAndFileImages(): Promise<void> {
	press('escape')
	rmSync(saveDirectory, { recursive: true, force: true })

	/**
	 * editmd titles a blocked remote image with its src (remote.ts:68 `title = src`), and once Load Remote Images allows
	 * a `file:` image it loads from its path, since GPUI's <img> takes paths, not `file:` URLs
	 */
	initFileImageDirectory()
	const fileImagePath = join(fileImageDirectory, 'pic.png')
	writeFileSync(fileImagePath, createPng(30, 20))
	documentController.load(
		`![tracker](${remote}/p.png)\n\n![shot](${pathToFileURL(fileImagePath).href})\n`,
		isolated
	)
	settle()
	const blockedImageTip = await loadTipAfterHover(
		'remote-image-0-0',
		'remote-image-tooltip-0-0-tip'
	)
	check(
		'a blocked remote image’s tip shows at the pointer, below-right of it as a native tip',
		getTipOffset(getCentre('remote-image-0-0'), 'remote-image-tooltip-0-0-tip'),
		[0, 0]
	)
	documentController.allowRemoteImages()
	settle()
	check(
		'a blocked remote image shows its src as its tooltip, and an allowed file: image loads from its path',
		[blockedImageTip, getProp('image-1-0', 'src')],
		[`${remote}/p.png`, fileImagePath]
	)
}

export async function testEmptyDocumentHint(): Promise<void> {
	press('escape')
	rmSync(badgeDirectory, { recursive: true, force: true })

	// an empty Document shows editmd's hint where its first line would be (parity row r-empty-doc), in the faint colour
	documentController.load('', linkOptions)
	settle()
	const hintShown = painted().includes('Start writing…')
	const hintTheme = getProp('empty-hint-text', 'theme')
	const hintInFaint =
		typeof hintTheme === 'object' &&
		hintTheme !== null &&
		!Array.isArray(hintTheme) &&
		hintTheme.text === hintTheme.textFaint
	documentController.load('Some text.\n', linkOptions)
	settle()
	check(
		'an empty Document paints “Start writing…” in the faint colour, and one with text does not',
		[hintShown, hintInFaint, painted().includes('Start writing…')],
		[true, true, false]
	)
	documentController.load('', linkOptions)
	settle()
	clickIfPresent('empty-hint')
	type('H')
	type('i')
	press('escape')
	check(
		'clicking the hint and typing `Hi` makes the Document’s text `Hi` with editmd’s final newline, and the hint is gone',
		[documentController.text, painted().includes('Start writing…'), find_test_id('empty-hint')],
		['Hi\n', false, null]
	)

	/**
	 * editmd's hint is a CSS ::before, which find never matches: Cmd-F `Start` on an empty Document finds nothing,
	 * and the hint paints where a paragraph of the same words paints as the first Block
	 */
	documentController.load('Start writing…\n', linkOptions)
	settle()
	const firstParagraphBox = bounds(find_test_id('block-0') ?? 0)
	documentController.load('', linkOptions)
	settle()
	const hintBox = bounds(find_test_id('empty-hint') ?? 0)
	press('cmd-f')
	for (const key of ['S', 't', 'a', 'r', 't']) type(key)
	await settleAfter(350)
	check(
		'Cmd-F `Start` on an empty Document matches nothing, the hint painting where a first paragraph would',
		[findController.total, painted_highlights().length, hintBox, hintBox !== null],
		[0, 0, firstParagraphBox, true]
	)
	for (let index = 0; index < 5; index++) type('backspace')
	press('escape')
}

export async function testImagesAndUnsizedZoom(): Promise<void> {
	documentController.load(`![tracker](${remote}/p.png)\n`, menuOptions)
	settle()
	const blockedBeforeLoad = getText('image-blocked-0-0')
	documentController.run('loadRemoteImages')
	settle()
	check(
		'Load Remote Images through `run` paints a blocked remote image',
		[blockedBeforeLoad, getProp('image-0-0', 'src')],
		['tracker', `${remote}/p.png`]
	)

	// a paragraph mixing text and images, as editmd paints them inline: each text run as markdown, each image as one
	writeFileSync(join(menuDirectory, 'pic.png'), createPng(300, 200))
	openFixture(menuDirectory, 'mixed.md', 'See ![a](pic.png) here.\n', menuOptions)
	settle()
	const mixedLines = painted().split('\n')
	check(
		'a paragraph mixing text and an image paints `See`, the image from the document’s folder, and `here.`',
		[
			mixedLines.includes('See'),
			mixedLines.includes('here.'),
			find_test_id('image-0-0')?.type,
			getProp('image-0-0', 'src')
		],
		[true, true, 'img', join(menuDirectory, 'pic.png')]
	)
	if (find_test_id('image-0-0')) click_test_id('image-0-0')

	check(
		'clicking the image in a mixed paragraph opens the whole paragraph for editing',
		[documentController.activeIndex, getProp('block-editor', 'value')],
		[0, 'See ![a](pic.png) here.']
	)
	press('escape')

	documentController.load(`Look ![tracker](${remote}/p.png) there.\n`, menuOptions)
	settle()
	const mixedBlocked = getText('image-blocked-0-0')
	documentController.run('loadRemoteImages')
	settle()
	check(
		'a remote image in a mixed paragraph shows its alt text until Load Remote Images paints it',
		[mixedBlocked, getProp('image-0-0', 'src')],
		['tracker', `${remote}/p.png`]
	)

	/**
	 * A local image whose file is gone paints as WebKit, editmd's renderer, paints a broken image: small, with its alt
	 * text, not GPUI's "img: load failed" atop the 240px fallback box. a file that is there but of unknown size (none of
	 * the PNG, GIF, JPEG, WebP, BMP, TIFF, ICO and SVG headers `imageSize` reads) keeps the box.
	 */
	writeFileSync(join(menuDirectory, 'junk.png'), 'not an image')
	const missingPath = join(menuDirectory, 'missing.md')
	writeFileSync(missingPath, '![gone](gone.png)\n\n![junk](junk.png)\n')
	documentController.open(missingPath, menuOptions)
	settle()
	check(
		'a missing local image paints its alt text, small, with no image',
		[
			getText('image-missing-0-0'),
			find_test_id('image-0-0'),
			(bounds(find_test_id('image-missing-0-0') ?? 0)?.height ?? 240) < 120
		],
		['gone', null, true]
	)
	check(
		'an existing local image of unknown size keeps the fixed box',
		[find_test_id('image-1-0')?.type, bounds(find_test_id('image-1-0') ?? 0)?.height],
		['img', 240]
	)

	/**
	 * Text with no size of its own paints at GPUI's 16px whatever the zoom, so these take size tokens.
	 * A numbered item's marker is text; a bullet is a drawn disc, sized by tokens.
	 */
	documentController.load(`1. a\n2. [ ] b\n\n![tracker](${remote}/p.png)\n`, menuOptions)
	settle()

	/** the font size of the first item's number and of the blocked image's alt text */
	function getUnsizedTextSizes() {
		return [
			find_test_id('list-marker-3')?.style?.fontSize,
			find_test_id('image-blocked-1-0')?.style?.fontSize
		]
	}
	const actualSizeText = getUnsizedTextSizes()
	press('cmd-=')
	settle()
	check(
		'Cmd-= scales a list marker and a blocked image’s alt text by 1.1, from GPUI’s 16px and editmd’s 0.9em',
		[actualSizeText, getUnsizedTextSizes()],
		[
			[16, 14.4],
			[17.6, 15.84]
		]
	)
}

export async function testMermaidPreview(): Promise<void> {
	/**
	 * a mermaid Block keeps its diagram under the field while it is edited, as editmd's diagrams.ts: re-rendered from
	 * the field's text once typing pauses for 300ms, or its error when the text cannot be drawn
	 */
	documentController.load('```mermaid\nflowchart LR\n  A --> B\n```\n', menuOptions)
	settle()
	// what the closed Block paints, so the preview can be held to the same src
	const closedDiagram = getProp('mermaid-0', 'src')
	click_test_id('block-0')
	settle()
	const openedDiagram = getProp('mermaid-0', 'src')
	const previewFieldBox = bounds(find_test_id('block-editor') ?? 0)
	const previewImageBox = bounds(find_test_id('mermaid-0') ?? 0)
	check(
		'an open mermaid Block shows its field and, below it, at once, the diagram the closed Block painted for the same source',
		[
			find_test_id('block-editor')?.type,
			find_test_id('mermaid-0')?.type,
			closedDiagram,
			openedDiagram,
			previewFieldBox !== null &&
				previewImageBox !== null &&
				previewImageBox.y >= previewFieldBox.y + previewFieldBox.height
		],
		[
			'textarea',
			'img',
			getDiagramSrc('flowchart LR\n  A --> B'),
			getDiagramSrc('flowchart LR\n  A --> B'),
			true
		]
	)
	// the box around the preview's image, editmd's `.code-block.mermaid.editing > .diagram`
	const previewBox = find_test_id('mermaid-box-0')
	check(
		'the live preview is bordered in the palette’s --border colour',
		[previewBox?.style?.borderColor, themeController.palette.border.length > 0],
		[themeController.palette.border, true]
	)
	// the field holds the diagram's code alone, its caret at the end of the last line: a new node on a line of its own
	for (const key of ['enter', 'space', 'space', 'b', 'space', '-', '-', '-', 'space']) type(key)
	settle()
	// a pause shorter than 300ms, then the last key: the wait for a pause starts again from it
	await settleAfter(150)
	type('c')
	settle()
	const diagramRightAfterTyping = getProp('mermaid-0', 'src')
	await settleAfter(150)
	const diagramSoonAfterLastKey = getProp('mermaid-0', 'src')
	await settleAfter(300)
	check(
		'typing a new node re-renders the diagram once typing pauses for 300ms: still the opened diagram 150ms after the last key, after a 150ms pause before it, then the new source’s diagram 450ms after it',
		[
			documentController.text,
			diagramRightAfterTyping,
			diagramSoonAfterLastKey,
			getProp('mermaid-0', 'src')
		],
		[
			'```mermaid\nflowchart LR\n  A --> B\n  b --- c\n```\n',
			getDiagramSrc('flowchart LR\n  A --> B'),
			getDiagramSrc('flowchart LR\n  A --> B'),
			getDiagramSrc('flowchart LR\n  A --> B\n  b --- c')
		]
	)
	for (const key of ['space', '-', '-', '-']) type(key)
	await settleAfter(400)
	const undrawable = diagramOf(
		'flowchart LR\n  A --> B\n  b --- c ---',
		themeController.mermaidPalette
	)
	check(
		'text that cannot be drawn shows diagramOf’s message for it in the diagram’s place, the field staying',
		[
			undrawable.kind,
			getProp('mermaid-error-0', 'source'),
			find_test_id('mermaid-0'),
			find_test_id('block-editor')?.type
		],
		[
			'error',
			undrawable.kind === 'error' ? monoLinesSource(undrawable.message) : null,
			null,
			'textarea'
		]
	)
	press('escape')

	// a fence with nothing in it is editmd's "Empty diagram", closed and while it is edited
	documentController.load('```mermaid\n```\n', menuOptions)
	settle()
	const emptyClosed = [getProp('mermaid-empty-0', 'source'), find_test_id('mermaid-0')]
	click_test_id('block-0')
	settle()
	check(
		'a blank mermaid fence paints editmd’s Empty diagram, closed and in the open Block’s preview',
		[emptyClosed, getProp('mermaid-empty-0', 'source'), find_test_id('block-editor')?.type],
		[['`Empty diagram`', null], '`Empty diagram`', 'textarea']
	)
}

export async function testPageLayout(): Promise<void> {
	rmSync(menuDirectory, { recursive: true, force: true })

	// rendering parity: each row's fixture (test/fixtures/parity) painted as editmd paints it
	initParityFolder()

	// row r-definitions: a link with no text shows its source, as editmd's `a.empty-link::before`
	documentController.load(readFixture('r-definitions'), parityOptions)
	settle()
	check(
		'an empty link `[](url)` paints its own source after the text before it',
		painted()
			.split('\n')
			.filter((line) => line.startsWith('A reference')),
		['A reference link and an empty link [](https://example.com/empty).']
	)

	/**
	 * row r-page: editmd's `#editor { max-width: 46rem; margin: 0 auto; padding: 3rem 2.5rem 40vh }`, a column at
	 * most 736px wide, centred, its Blocks 48px from its top and 40px from its sides, and 40% of the window's height
	 * empty below the last Block. per window width: the first Block's x and width, its y below the page's top, and,
	 * scrolled to the end, the space between the last Block and the window's bottom edge
	 */
	function measurePageLayout(width: number) {
		const first = bounds(find_test_id('block-0') ?? 0)
		const page = bounds(find_test_id('page-scroller') ?? 0)
		wheel({ x: width / 2, y: 300 }, 0, -100_000)
		settle()
		const last = bounds(find_test_id(`block-${documentController.blocks.length - 1}`) ?? 0)
		if (!first || !last || !page) return null

		return {
			width,
			x: first.x,
			blockWidth: first.width,
			top: first.y - page.y,
			below: Math.round((page.y + page.height - last.y - last.height) * 10) / 10
		}
	}
	const pageLayouts: ReturnType<typeof measurePageLayout>[] = []
	for (const width of [1000, 600]) {
		await remount({ width })
		documentController.load(readFixture('render'), parityOptions)
		settle()
		pageLayouts.push(measurePageLayout(width))
	}
	check(
		'the page is a centred column at most 736px wide with 48px above and 40px beside its Blocks, and 40% of the window height below them',
		pageLayouts,
		[
			// 40% of the 538px window is 215.2px, which GPUI's half-pixel grid paints at 215
			{
				width: 1000,
				x: (1000 - 736) / 2 + 40,
				blockWidth: 736 - 80,
				top: 48,
				below: toHalfPixels(538 * 0.4)
			},
			{ width: 600, x: 40, blockWidth: 600 - 80, top: 48, below: toHalfPixels(538 * 0.4) }
		]
	)
	await remount()

	/**
	 * rows r-headings and r-hr: editmd's block margins collapse as CSS margins do, the larger of a Block's bottom and
	 * the next one's top. body Blocks `margin: 0 0 1em`, headings `1.6em 0 0.6em` in their own em (h1 33.6px, h2
	 * 24.8, h3 20, h4 16.8, h5 15.2, h6 14.4), a rule `2em 0`
	 */
	documentController.load(readFixture('r-headings'), parityOptions)
	settle()
	const headingGaps = getBlockGaps()
	const headingWanted = [20.16, 39.68, 14.88, 32, 26.88, 24.32, 23.04, 8.64]
	documentController.load(readFixture('r-hr'), parityOptions)
	settle()
	const ruleGaps = getBlockGaps()
	check(
		'the space between Blocks is editmd’s collapsed margins: under h1 20.16, above h2 39.68, under h2 14.88, above h3-h6 32/26.88/24.32/23.04, under h6 8.64, 32 either side of a rule',
		[snapToWanted(headingGaps, headingWanted), snapToWanted(ruleGaps, [32, 32])],
		[headingWanted, [32, 32]]
	)

	/**
	 * row r-headings: editmd rules off h1 and h2 (`padding-bottom: 0.25em` and `0.2em` in their own em, then
	 * `border-bottom: 1px solid var(--border)`), and no other heading. per heading: its rule's colour, width and the
	 * padding above it, and the Block's height, the 42px and 31px heading lines plus padding and rule
	 */
	documentController.load(readFixture('r-headings'), parityOptions)
	settle()
	const headingRules = [0, 2, 4].map((index) => {
		const style = find_test_id(`heading-rule-${index}`)?.style
		return style
			? [style.borderColor, style.borderBottomWidth, style.paddingBottom]
			: bounds(find_test_id(`block-${index}`) ?? 0)?.height
	})
	const ruledHeights = [0, 2].map(
		(index) => bounds(find_test_id(`block-${index}`) ?? 0)?.height ?? 0
	)
	check(
		'h1 and h2 paint editmd’s bottom rule in the border colour under 0.25em and 0.2em of padding; h3 paints none',
		[headingRules, snapToWanted(ruledHeights, [42 + 8.4 + 1, 31 + 4.96 + 1])],
		[
			[[themeController.palette.border, 1, 8.4], [themeController.palette.border, 1, 4.96], 25],
			[42 + 8.4 + 1, 31 + 4.96 + 1]
		]
	)

	/**
	 * row r-headings: native <markdown> sizes h4, h5 and h6 as one tier, so h5 (0.95em) and h6 (0.9em, muted) get a
	 * theme of their own whose fourth tier is their size, line-height 1.25, and h6's text the muted colour
	 */
	const getTier = (index: number) => {
		const blockTheme = find_test_id(`block-${index}`)?.children?.[0]?.customProps?.theme
		const metrics = getField(blockTheme, 'metrics')
		const sizes = getField(metrics, 'mdHeadingSizes')
		const lineHeights = getField(metrics, 'mdHeadingLineHeights')
		return [
			Array.isArray(sizes) ? sizes[3] : null,
			Array.isArray(lineHeights) ? lineHeights[3] : null,
			getField(blockTheme, 'text')
		]
	}
	check(
		'h4 paints at 16.8px, h5 at 15.2px and h6 at 14.4px in the muted colour, each with line-height 1.25',
		[5, 6, 7].map(getTier),
		[
			[16.8, 21, themeController.palette.text],
			[15.2, 19, themeController.palette.text],
			[14.4, 18, themeController.palette.muted]
		]
	)

	/**
	 * row r-tasks: a ticked item's text is muted and struck through (editmd `li[data-checked="true"] > p`); the
	 * painted source wraps it in `~~` and its theme's text is the muted colour, the Document keeping its text
	 */
	documentController.load(readFixture('r-tasks'), parityOptions)
	settle()
	const taskTexts = find_all((node) => node.type === 'markdown').map((node) => [
		node.customProps?.source,
		getField(node.customProps?.theme, 'text')
	])
	check(
		'a ticked task paints `~~done~~` in the muted colour, the open ones as written in the text colour, and the Document is unchanged',
		[taskTexts, documentController.text],
		[
			[
				['todo', themeController.palette.text],
				['~~done~~', themeController.palette.muted],
				['another todo', themeController.palette.text]
			],
			readFixture('r-tasks')
		]
	)

	/**
	 * row r-quote: editmd's `blockquote { padding: 0 1em; color: var(--muted); border-left: 0.25em solid
	 * var(--border) }`, no fill: a 4px rail in the border colour, 16px either side of the text, the quote's markdown
	 * without its `>` markers in a muted theme
	 */
	documentController.load(readFixture('r-quote'), parityOptions)
	settle()
	const quoteStyle = find_test_id('quote-0')?.style
	const quoteText = find_test_id('markdown-0.0')?.customProps
	check(
		'a quote paints a 4px rail in the border colour, 16px padding and no fill, its text unquoted in the muted colour',
		[
			quoteStyle?.borderColor,
			quoteStyle?.borderLeftWidth,
			quoteStyle?.paddingLeft,
			quoteStyle?.paddingRight,
			quoteStyle?.backgroundColor ?? null,
			quoteText?.source,
			getField(quoteText?.theme, 'text')
		],
		[
			themeController.palette.border,
			4,
			16,
			16,
			null,
			'A quote\nover two lines',
			themeController.palette.muted
		]
	)

	/**
	 * row r-code: editmd's `pre` has no border and no header bar, its language a lowercase 11px label in the faint
	 * colour (style.css:193-220): the card paints the code between the fences through a native <code>, which has no
	 * header bar, and the label beside it (its place and the card are measured in `testPixels`)
	 */
	documentController.load(readFixture('r-code'), parityOptions)
	settle()
	check(
		'a code block paints the code between its fences, and `js` in faint 11px',
		[
			getProp('code-0', 'code'),
			getText('code-label-0'),
			find_test_id('code-label-0')?.style?.color,
			find_test_id('code-label-0')?.style?.fontSize
		],
		[
			'const x = 1 < 2;\nfunction add(a, b) {\n  return a + b;\n}',
			'js',
			themeController.palette.faint,
			11
		]
	)

	// row r-image: editmd rounds an image's corners, `img { border-radius: 4px }`; the row's picture is 300 × 200
	writeFileSync(join(parityDirectory, 'pic.png'), createPng(300, 200))
	openFixture(parityDirectory, 'r-image.md', readFixture('r-image'), {
		...parityOptions,
		socketsDirectory: join(parityDirectory, 's')
	})
	settle()
	check(
		'an image paints with editmd’s 4px corner radius',
		[find_test_id('image-0-0')?.type, find_test_id('image-0-0')?.style?.borderRadius],
		['img', 4]
	)
	// narrower than the 656px column, editmd's `img { max-width: 100% }` leaves it at its natural size
	const parityImageBox = bounds(find_test_id('image-0-0') ?? 0)
	check(
		'r-image paints its 300 × 200 picture at its natural size',
		parityImageBox ? [parityImageBox.width, parityImageBox.height] : null,
		[300, 200]
	)

	/**
	 * row r-image-remote: editmd's blocked image (`.remote-image`, style.css:295-314) is a small box: a picture icon
	 * and the alt text at 0.9em in the muted colour, a 1px dashed border in the border colour, radius 4px, padding
	 * 0.05em 0.45em and a 0.35em gap, in its 0.9em
	 */
	documentController.load(readFixture('r-image-remote'), parityOptions)
	settle()
	const remoteBox = find_test_id('remote-image-0-0')
	const remoteIcon = remoteBox?.children?.[0]
	const remoteAlt = find_test_id('image-blocked-0-0')
	check(
		'a blocked image paints editmd’s box: icon, muted 14.4px alt text, 1px dashed border, radius 4, padding 0.72/6.48, gap 5.04',
		[
			remoteBox?.style?.borderColor,
			remoteBox?.style?.borderStyle,
			remoteBox?.style?.borderWidth ?? remoteBox?.style?.borderTopWidth,
			remoteBox?.style?.borderRadius ?? remoteBox?.style?.borderTopLeftRadius,
			remoteBox?.style?.paddingTop,
			remoteBox?.style?.paddingLeft,
			remoteBox?.style?.gap ?? remoteBox?.style?.columnGap,
			remoteIcon?.type,
			typeof remoteIcon?.customProps?.source === 'string' &&
				remoteIcon.customProps.source.includes('M2.5 12.5 6.5 8.5 9 11 11 9 13.5 12.5Z') &&
				remoteIcon.customProps.source.includes(themeController.palette.muted ?? '-'),
			remoteAlt?.children?.[0]?.text,
			remoteAlt?.style?.color,
			remoteAlt?.style?.fontSize
		],
		[
			themeController.palette.border,
			'dashed',
			1,
			4,
			0.72,
			6.48,
			5.04,
			'svg',
			true,
			'remote pixel',
			themeController.palette.muted,
			14.4
		]
	)

	/**
	 * rows r-image-linked and r-image-remote: editmd paints a paragraph's images inline, in its text line. per row:
	 * whether the text after the image starts right of it, whether the two share a line (their row ranges overlap),
	 * and the text's left edge less the image's right edge (a gap, no wrap). then a run too long for one line: it
	 * still wraps inside the column, two lines and no wider than the column
	 */
	writeFileSync(join(parityDirectory, 'badge.png'), createPng(90, 20))
	openFixture(parityDirectory, 'r-image-linked.md', readFixture('r-image-linked'), {
		...parityOptions,
		socketsDirectory: join(parityDirectory, 's')
	})
	pump()

	/**
	 * how the image `imageId` and the text run after it sit: [right of it, on its line, the gap between them], the
	 * gap within half a pixel of `gap` shown as `gap`
	 */
	function getInlineLayout(imageId: string, textId: string, gap: number) {
		const image = bounds(find_test_id(imageId) ?? 0)
		const run = bounds(find_test_id(textId) ?? 0)
		if (!image || !run) return null

		return [
			run.x >= image.x + image.width,
			run.y < image.y + image.height && image.y < run.y + run.height,
			...snapToWanted([run.x - image.x - image.width], [gap])
		]
	}
	// the inline gap, editmd's one space
	const linkedLayout = getInlineLayout('image-0-0', 'text-run-0-1', 4.4)
	documentController.load(readFixture('r-image-remote'), parityOptions)
	settle()
	/**
	 * measured from the alt text, since GPUI reports a padded box's origin moved in by its padding: then the box's
	 * 6.48px padding, its 1px border and the inline gap
	 */
	const remoteLayout = getInlineLayout('image-blocked-0-0', 'text-run-0-1', 6.48 + 1 + 4.4)
	const longRun = Array.from({ length: 24 }, () => 'words that run on').join(' ')
	documentController.load(`![remote](${remote}/p.png) ${longRun}.\n`, parityOptions)
	settle()
	const longBox = bounds(find_test_id('text-run-0-1') ?? 0)
	// a run its layout event reports taller than one line turns the paragraph into a column, with no clock advance
	pump()
	const longStacked = bounds(find_test_id('text-run-0-1') ?? 0)
	const longImage = bounds(find_test_id('image-blocked-0-0') ?? 0)
	check(
		'a paragraph’s image and the text after it share one line, the text just right of the image; a long run wraps inside the 656px column, then goes under the image at full width',
		[
			linkedLayout,
			remoteLayout,
			longBox !== null && longBox.width <= 656,
			longBox !== null && longBox.height >= 2 * 26.4,
			longStacked && longImage
				? [longStacked.x, longStacked.width, longStacked.y > longImage.y + longImage.height]
				: null
		],
		[[true, true, 4.4], [true, true, 6.48 + 1 + 4.4], true, true, [72, 656, true]]
	)

	/**
	 * row r-table: editmd's table (style.css:316-342) is sized to its content and scrolls when wider than the column,
	 * 0.94em text, cells `padding: 0.4em 0.85em` with 1px borders, the header bold on the surface fill; alignment from
	 * the delimiter row. measured in editmd's window: columns 63.5 and 90.5px, rows 38px
	 */
	documentController.load(readFixture('r-table'), parityOptions)
	settle()
	// the grid inside the scroll box, which a scroll box's own bounds do not show
	const tableBox = bounds(find_test_id('table-0')?.children?.[0] ?? 0)
	const headerCell = getCell(0, 0)?.style
	const bodyCell = getCell(1, 1)?.style
	check(
		'a table paints a grid of native cells sized to their content: bordered, padded 0.4em 0.85em at 0.94em, the header bold on the surface, the right column right-aligned',
		[
			[getCellSource(0, 0), getCellSource(0, 1), getCellSource(1, 0), getCellSource(2, 1)],
			[headerCell?.backgroundColor, bodyCell?.backgroundColor ?? null],
			[bodyCell?.borderColor, bodyCell?.borderRightWidth, bodyCell?.borderBottomWidth],
			[bodyCell?.paddingTop, bodyCell?.paddingLeft],
			getField(getField(getCellMarkdown(1, 0)?.customProps?.theme, 'metrics'), 'mdTextSize'),
			[getCell(1, 0)?.style?.alignItems, bodyCell?.alignItems],
			tableBox !== null && tableBox.width < 200
		],
		[
			['**Plant**', '**Moisture**', 'Basil', '63%'],
			[themeController.palette.surface, null],
			[themeController.palette.border, 1, 1],
			[6.016, 12.784],
			15.04,
			['flex-start', 'flex-end'],
			true
		]
	)

	// row r-html: editmd shows raw HTML as its source, mono and muted (`span[data-type="html"]`, style.css:344-349)
	documentController.load(readFixture('r-html'), parityOptions)
	settle()
	const htmlLine = find_test_id('source-line-1')
	check(
		'a block of HTML paints its source line in mono (native <markdown> inline code in its `fontMono`, SF Mono) and the muted colour',
		[
			documentController.blocks[1]?.kind,
			htmlLine?.customProps?.source,
			getField(htmlLine?.customProps?.theme, 'fontMono'),
			getMonoLook('source-line-1')[0]
		],
		[
			'html',
			monoLinesSource('<div align="center">block html</div>'),
			'.AppleSystemUIFontMonospaced',
			themeController.palette.muted
		]
	)
	const htmlLineSize = getMonoLook('source-line-1')[1]
	documentController.load(readFixture('r-definitions'), parityOptions)
	settle()
	const definitionLineSize = getMonoLook('source-line-1')[1]
	/**
	 * `a.empty-link::before { content: "[](" attr(href) ")"; font: 0.86em var(--font-mono) }` (style.css:363-366): mono in
	 * the link's accent with no fill; native paints it as inline code, so its Block's theme drops the code wash and
	 * colours code in the accent, unless the Block holds inline code of its own, which keeps editmd's pill
	 */
	const emptyLinkTheme = find_test_id('block-0')?.children?.[0]?.customProps?.theme
	documentController.load(
		'An empty link [](https://example.com/e) and `real code`.\n',
		parityOptions
	)
	settle()
	const mixedTheme = find_test_id('block-0')?.children?.[0]?.customProps?.theme
	check(
		'a Block with an empty link paints its source in the accent with no fill; one with inline code too keeps the code pill',
		[
			getField(emptyLinkTheme, 'codeWash'),
			getField(emptyLinkTheme, 'codeText'),
			getField(mixedTheme, 'codeWash')
		],
		['#00000000', themeController.palette.accent, themeController.palette.surface]
	)
	/**
	 * `span[data-type="html"] { font: 0.86em var(--font-mono); color: var(--muted) }` (style.css:346-349): an inline tag
	 * paints its source in muted mono with no fill; native paints it as inline code, so its Block's theme drops the code
	 * wash and colours code muted, unless the Block holds inline code of its own, which keeps editmd's pill
	 */
	documentController.load('a <b>x</b> c\n', parityOptions)
	settle()
	const inlineHtmlTheme = find_test_id('block-0')?.children?.[0]?.customProps?.theme
	documentController.load('a <b>x</b> and `code`\n', parityOptions)
	settle()
	const inlineHtmlCodeTheme = find_test_id('block-0')?.children?.[0]?.customProps?.theme
	check(
		'a Block with an inline HTML tag paints it in the muted colour with no fill; one with inline code too keeps the code pill',
		[
			getField(inlineHtmlTheme, 'codeText'),
			getField(inlineHtmlTheme, 'codeWash'),
			getField(inlineHtmlCodeTheme, 'codeText'),
			getField(inlineHtmlCodeTheme, 'codeWash')
		],
		[
			themeController.palette.muted,
			'#00000000',
			themeController.textTheme.codeText,
			themeController.textTheme.codeWash
		]
	)
	documentController.load(readFixture('r-definitions'), parityOptions)
	settle()
	press('cmd-=')
	settle()
	const zoomedDefinitionSize = getMonoLook('source-line-1')[1]
	press('cmd-0')
	settle()
	check(
		'HTML and definition lines paint at editmd’s `font: 0.86em var(--font-mono)` of the 16px body, 13.76px, zoomed with the page',
		[htmlLineSize, definitionLineSize, zoomedDefinitionSize],
		[13.76, 13.76, 15.136]
	)

	/**
	 * rows r-mermaid, r-mermaid-error and r-mermaid-empty: editmd's `.diagram` (style.css:411-455) is a box with no
	 * fill, `padding: 1rem; border-radius: 8px`, its diagram centred, bordered by `inset 0 0 0 1px var(--border)` as
	 * editmd shows it under its source; an error centred in the danger colour, mono 12.5px; "Empty diagram"
	 * centred in the faint colour. per row: the painted part's centre less the Block's (0 is centred)
	 */
	const getCentreOffset = (testId: string, index: number) => {
		const part = bounds(find_test_id(testId) ?? 0)
		const blockBox = bounds(find_test_id(`block-${index}`) ?? 0)
		return part && blockBox
			? part.x + part.width / 2 - (blockBox.x + blockBox.width / 2)
			: Number.NaN
	}
	documentController.load(readFixture('r-mermaid'), parityOptions)
	settle()
	const diagramBox = find_test_id('mermaid-box-0')?.style
	const diagramLook = [
		// editmd borders a diagram only under the pointer or while its Block is open (style.css:433-439)
		diagramBox?.borderColor,
		diagramBox?.hover?.borderColor,
		diagramBox?.borderWidth ?? diagramBox?.borderTopWidth,
		diagramBox?.borderRadius ?? diagramBox?.borderTopLeftRadius,
		// a `padding` shorthand arrives as itself, longhands as `paddingTop` and the rest
		diagramBox?.paddingTop ?? diagramBox?.padding,
		diagramBox?.backgroundColor ?? null,
		...snapToWanted([getCentreOffset('mermaid-0', 0)], [0])
	]
	documentController.load(readFixture('r-mermaid-error'), parityOptions)
	settle()
	const errorText = find_test_id('mermaid-error-0')
	const [errorColour, errorSize, errorLineHeight] = getMonoLook('mermaid-error-0')
	const errorLook = [
		errorColour,
		getField(errorText?.customProps?.theme, 'fontMono'),
		errorSize,
		// `font: 12.5px/1.5 var(--font-mono)`
		errorLineHeight,
		// `.diagram` centres its child (style.css:421-431)
		...snapToWanted([getCentreOffset('mermaid-error-0', 0)], [0])
	]
	documentController.load(readFixture('r-mermaid-empty'), parityOptions)
	settle()
	// sized to its words, so a centre at the Block's centre is the text's own and not a full-width box's
	const emptyWidth = bounds(find_test_id('mermaid-empty-0') ?? 0)?.width ?? 656
	const emptyLook = [
		getProp('mermaid-empty-0', 'source'),
		getMonoLook('mermaid-empty-0')[0],
		getMonoLook('mermaid-empty-0')[2],
		...snapToWanted([getCentreOffset('mermaid-empty-0', 0)], [0]),
		emptyWidth < 656 / 2
	]
	check(
		'a diagram paints centred in an 8px rounded box with 16px padding and no fill, its 1px border shown on hover; an error centred in danger SF Mono 12.5px/1.5; “Empty diagram” centred, faint, 1.5 high',
		[diagramLook, errorLook, emptyLook],
		[
			['#00000000', themeController.palette.border, 1, 8, 16, null, 0],
			[themeController.palette.danger, '.AppleSystemUIFontMonospaced', 12.5, 18.75, 0],
			['`Empty diagram`', themeController.palette.faint, 18.75, 0, true]
		]
	)

	/**
	 * editmd's open diagram keeps its border (`.code-block.mermaid.editing > .diagram`); mermaid sizes its SVG to its
	 * natural width, and `.diagram svg { max-width: 100%; height: auto }` shrinks a wider one into the box, keeping its
	 * shape. pele writes its 16px label size only in the root's style, which gpui's svg decoder ignores, so the root
	 * carries it as an attribute
	 */
	documentController.load(readFixture('r-mermaid'), parityOptions)
	settle()
	click_test_id('block-0')
	settle()
	const openDiagramBorder = find_test_id('mermaid-box-0')?.style?.borderColor
	press('escape')
	const diagramSvg = Buffer.from(
		String(getProp('mermaid-0', 'src')).replace('data:image/svg+xml;base64,', ''),
		'base64'
	).toString('utf8')
	const wideSource = `flowchart LR\n  ${Array.from({ length: 12 }, (_value, n) => `node${n}`).join(' --> ')}`
	const wideDiagram = diagramOf(wideSource, themeController.mermaidPalette)
	documentController.load(`\`\`\`mermaid\n${wideSource}\n\`\`\`\n`, parityOptions)
	// the box's layout event gives its width with no clock advance
	pump()
	const wideImage = find_test_id('mermaid-0')?.style
	const wideRatio =
		wideDiagram.kind === 'diagram' && typeof wideImage?.width === 'number'
			? Math.round((wideImage.width / Number(wideImage.height)) * 100) / 100
			: null
	check(
		'an open diagram keeps its border, its labels paint at pele’s 16px, and one wider than the box shrinks to fit it, keeping its shape',
		[
			openDiagramBorder,
			/<svg\b[^>]*\sfont-size="16"/.test(diagramSvg),
			wideDiagram.kind === 'diagram' && wideDiagram.width > 622,
			wideImage?.width,
			wideRatio
		],
		[
			themeController.palette.border,
			true,
			true,
			622,
			wideDiagram.kind === 'diagram'
				? Math.round((wideDiagram.width / wideDiagram.height) * 100) / 100
				: null
		]
	)

	/**
	 * row r-footnotes: editmd's footnote definition (style.css:376-390) is a `dl` under a rule, `padding-top: 0.5em`
	 * of its 0.9em (7.2px), the bold `dt` label above the `dd` content: the label's left edge is the content's, and
	 * the content starts below the label
	 */
	documentController.load(readFixture('r-footnotes'), parityOptions)
	settle()
	const noteLabel = bounds(find_test_id('footnote-label-1') ?? 0)
	const noteContent = bounds(find_test_id('footnote-1') ?? 0)
	const noteBox = find_test_id('footnote-box-1')?.style
	check(
		'a footnote definition paints its label above its content, both from the left edge, under a rule with 7.2px of padding',
		[
			noteLabel && noteContent ? noteLabel.x === noteContent.x : null,
			noteLabel && noteContent ? noteContent.y >= noteLabel.y + noteLabel.height : null,
			noteBox?.borderColor,
			noteBox?.borderTopWidth,
			noteBox?.paddingTop
		],
		[true, true, themeController.palette.border, 1, 7.2]
	)

	/** a node's font as its own style sets it: family, size and line height, null where it sets none */
	function getFont(node: TreeNode | null) {
		const style = node?.style
		return [style?.fontFamily ?? null, style?.fontSize ?? null, style?.lineHeight ?? null]
	}

	// Source mode's field: editmd's `.source { font: 14px/1.6 var(--font-mono) }` (style.css:88-103)
	documentController.load(readFixture('r-headings'), parityOptions)
	settle()
	press('cmd-/')
	const sourceFont = getFont(find_test_id('source-editor'))
	press('cmd-/')
	check(
		'Source mode’s field paints in editmd’s `.source` font: mono at 14px, line height 1.6 (22.4px)',
		sourceFont,
		['Menlo', 14, 22.4]
	)

	/**
	 * an open code or mermaid Block: editmd edits it inside its `pre` card (style.css:193-220), the surface fill,
	 * radius 8px, padding 0.9rem 1.1rem, 13.5px/1.55 mono; a paragraph's field keeps its own look, no card and no font
	 */
	function openField(testId: string) {
		click_test_id(testId)
		const card = find_test_id('block-editor-card')?.style
		const look = card
			? [
					card.backgroundColor,
					card.borderRadius ?? card.borderTopLeftRadius,
					card.paddingTop,
					card.paddingBottom,
					card.paddingLeft,
					card.paddingRight
				]
			: null
		const field = [look, ...getFont(find_test_id('block-editor'))]
		press('escape')
		return field
	}
	documentController.load(readFixture('r-code'), parityOptions)
	settle()
	const openCodeField = openField('block-0')
	documentController.load(readFixture('r-mermaid'), parityOptions)
	settle()
	const openMermaidField = openField('block-0')
	documentController.load('A paragraph.\n', parityOptions)
	settle()
	const openParagraphField = openField('block-0')
	const preCard = [themeController.palette.surface, 8, 14.4, 14.4, 17.6, 17.6]
	check(
		'an open code or mermaid Block’s field paints in editmd’s `pre` card, mono 13.5px/20.925px; a paragraph’s field stays as it was',
		[openCodeField, openMermaidField, openParagraphField],
		[
			[preCard, 'Menlo', 13.5, 20.925],
			[preCard, 'Menlo', 13.5, 20.925],
			[null, null, null, null]
		]
	)

	/** a style's length in px, 0 where it sets none */
	function getLength(value: NonNullable<TreeNode['style']>[string]): number {
		return typeof value === 'number' ? value : 0
	}

	/**
	 * editmd edits front matter inside its box (frontmatter.ts:20-23, a contenteditable `pre.frontmatter`), so the open
	 * field keeps the box's look, its text muted, with `.frontmatter:focus`'s 2px ring in the selection colour; an open
	 * code or mermaid Block keeps its `pre[data-language]::before` label, which editmd's open `pre` still shows
	 */
	function measureOpenLook(testId: string) {
		click_test_id(testId)
		const card = find_test_id('block-editor-card')?.style
		const look = [
			// the ring is an outline outside the box, so the text sits where editmd's does, 12px and 16px in
			card
				? [
						card.backgroundColor,
						card.borderRadius ?? card.borderTopLeftRadius,
						getLength(card.paddingTop) + getLength(card.borderTopWidth ?? card.borderWidth),
						getLength(card.paddingLeft) + getLength(card.borderLeftWidth ?? card.borderWidth),
						card.outlineWidth ?? null,
						card.outlineColor ?? null
					]
				: null,
			...getFont(find_test_id('block-editor')),
			getField(getProp('block-editor', 'theme'), 'text'),
			getText('block-editor-label') ?? null
		]
		press('escape')
		return look
	}
	documentController.load(readFixture('r-frontmatter'), parityOptions)
	settle()
	const openFrontmatter = measureOpenLook('block-0')
	documentController.load(readFixture('r-code'), parityOptions)
	settle()
	const openCodeLabel = measureOpenLook('block-0').at(-1)
	documentController.load(readFixture('r-mermaid'), parityOptions)
	settle()
	const openMermaidLabel = measureOpenLook('block-0').at(-1)
	check(
		'open front matter keeps its box (surface, 12px 16px, radius 8, a 2px selection outline) and 12.5px/1.55 muted mono; open code and mermaid keep their language label',
		[openFrontmatter, openCodeLabel, openMermaidLabel],
		[
			[
				[themeController.palette.surface, 8, 12, 16, 2, themeController.palette.selection],
				'Menlo',
				12.5,
				19.375,
				themeController.palette.muted,
				null
			],
			'js',
			'mermaid'
		]
	)

	/**
	 * row r-frontmatter: editmd's `.frontmatter { padding: 0.75rem 1rem; font: 12.5px/1.55 var(--font-mono);
	 * color: var(--muted); background: var(--surface); border-radius: 8px }` (style.css:71-82)
	 */
	documentController.load(readFixture('r-frontmatter'), parityOptions)
	settle()
	const frontmatterBox = find_test_id('frontmatter-box-0')?.style
	check(
		'front matter paints in editmd’s box: surface fill, 8px radius, padding 12/16px, muted mono 12.5px/19.375px',
		[
			frontmatterBox?.backgroundColor,
			frontmatterBox?.borderRadius ?? frontmatterBox?.borderTopLeftRadius,
			frontmatterBox?.paddingTop,
			frontmatterBox?.paddingBottom,
			frontmatterBox?.paddingLeft,
			frontmatterBox?.paddingRight,
			getMonoLook('frontmatter-0')[0],
			// native <markdown> paints inline code in its theme's `fontMono`, SF Mono as editmd's `ui-monospace`
			getField(find_test_id('frontmatter-0')?.customProps?.theme, 'fontMono'),
			getMonoLook('frontmatter-0')[1],
			getMonoLook('frontmatter-0')[2]
		],
		[
			themeController.palette.surface,
			8,
			12,
			12,
			16,
			16,
			themeController.palette.muted,
			'.AppleSystemUIFontMonospaced',
			12.5,
			19.375
		]
	)

	// row r-tasks: editmd's `li + li { margin-top: 0.2em }` (style.css:230-238), 3.2px between a task list's rows
	documentController.load(readFixture('r-tasks'), parityOptions)
	settle()
	const taskRows = find_all((node) => node.testId?.startsWith('task-row-') === true).map((node) =>
		bounds(node)
	)
	const taskGaps = taskRows.slice(1).map((row, index) => {
		const above = taskRows[index]
		return row && above ? row.y - above.y - above.height : Number.NaN
	})
	check(
		'a task list’s rows sit editmd’s 0.2em (3.2px) apart',
		[find_test_id('task-list-0')?.style?.gap, snapToWanted(taskGaps, [3.2, 3.2])],
		[3.2, [3.2, 3.2]]
	)

	/**
	 * editmd's links show the text cursor, and the pointer only while ⌘ is held (main.ts:48-54, style.css:170-181):
	 * here the Block takes the pointer with the pointer on its link while ⌘ is held, as the pointer's modifiers or the
	 * window's ⌘ key say; a Block with no link keeps the text cursor
	 */
	documentController.load('A [link](https://x.y) here.\n\nPlain text.\n', parityOptions)
	settle()
	const getCursor = (testId: string) => find_test_id(testId)?.style?.cursor
	// on `link`, past the `A ` before it
	const cursorLinkBox = bounds(find_test_id('block-0') ?? 0)
	const onCursorLink = cursorLinkBox
		? { x: cursorLinkBox.x + 24, y: cursorLinkBox.y + cursorLinkBox.height / 2 }
		: { x: 0, y: 0 }
	const cursors = [getCursor('block-0')]
	mouse_move(onCursorLink, { modifiers: 'cmd' })
	settle()
	cursors.push(getCursor('block-0'), getCursor('block-1'))
	mouse_move(onCursorLink)
	settle()
	cursors.push(getCursor('block-0'))
	press('cmd', { held: true })
	settle()
	cursors.push(getCursor('block-0'))
	key_up('cmd')
	settle()
	cursors.push(getCursor('block-0'))
	check(
		'a link shows the text cursor, and the pointer while ⌘ is held over it, from a ⌘ move or the ⌘ key; a Block without a link keeps the text cursor',
		cursors,
		['text', 'pointer', 'text', 'text', 'pointer', 'text']
	)
}

export async function testPixels(): Promise<void> {
	documentController.load('', isolated)
	rmSync(lookDirectory, { recursive: true, force: true })

	/**
	 * a ticked task's strike line in editmd's faint colour over its muted text (`text-decoration-color: var(--faint)`,
	 * style.css:268-272): native <markdown> paints the line in its theme's `textMuted`
	 */
	documentController.load(readFixture('r-tasks'), parityOptions)
	settle()
	const doneText = bounds(find_test_id('task-text-17')?.children?.[0] ?? 0)
	// the strike line runs under the glyphs, so it shows between them: its row holds the most faint pixels
	const strikeFaint = doneText
		? countMostInARow(captureWindow(), doneText, getPalette().faint ?? '')
		: 0

	/**
	 * a link's underline is the accent at 60% (editmd's: 35%) and turns to the link's own colour, the accent, while ⌘ is held, as editmd's
	 * `body.cmd-down a { text-decoration-color: currentColor }` (style.css:170-181); native <markdown> paints a link in the
	 * text colour and its underline in the theme's `textMuted`
	 */
	documentController.load('[a linked phrase](https://example.com/x)\n', parityOptions)
	settle()
	const linkText = bounds(find_test_id('block-0')?.children?.[0] ?? 0)
	const underlineBefore = linkText
		? getLongestRunColour(captureWindow(), linkText, [getPalette().background ?? ''])
		: null
	press('cmd', { held: true })
	settle()
	const underlineHeld = linkText
		? getLongestRunColour(captureWindow(), linkText, [getPalette().background ?? ''])
		: null
	key_up('cmd')
	settle()
	const underlineAfter = linkText
		? getLongestRunColour(captureWindow(), linkText, [getPalette().background ?? ''])
		: null
	check(
		`a ticked task’s strike line paints faint, and a link’s underline turns from the accent at 60% to the accent while ⌘ is held (faint pixels in the strike’s row ${strikeFaint}; underline ${underlineBefore}, ${underlineHeld}, ${underlineAfter})`,
		[
			strikeFaint >= 20,
			isNear(underlineBefore ?? '', getLinkUnderlineInk(), 6),
			isNear(underlineHeld ?? '', getPalette().accent ?? '', 6),
			isNear(underlineAfter ?? '', getLinkUnderlineInk(), 6)
		],
		[true, true, true, true]
	)

	/**
	 * editmd's strike line is its text's own colour (style.css has no `del` rule, so `currentColor`); native <markdown>
	 * draws a strike, as a link's underline, in its theme's `textMuted`, so a Block without links gives `textMuted` its
	 * text colour (a quote's muted text included), and one with a link strikes in its underline's accent at 60%
	 */
	function measureStrikeLine(source: string, node: () => TreeNode | null | undefined) {
		documentController.load(source, parityOptions)
		settle()
		const theme = node()?.customProps?.theme
		return [getField(theme, 'textMuted'), getField(theme, 'text')]
	}
	const getFirstBlockText = () => find_test_id('block-0')?.children?.[0]
	check(
		'a strike paints in its text’s colour in a paragraph, a list and a quote without links; a paragraph with a link strikes in its link underline’s colour',
		[
			measureStrikeLine('a ~~b~~ c\n', getFirstBlockText),
			measureStrikeLine('a ~~b~~ [l](https://x.example)\n', getFirstBlockText),
			measureStrikeLine('- a ~~b~~ c\n', () => find_test_id('list-text-2')?.children?.[0]),
			measureStrikeLine('> a ~~b~~ c\n', () => find_test_id('markdown-0.0'))
		],
		[
			[getPalette().text, getPalette().text],
			[`${getPalette().accent}99`, getPalette().text],
			[getPalette().text, getPalette().text],
			[getPalette().muted, getPalette().muted]
		]
	)

	/**
	 * row r-image-remote: editmd's blocked image box has a 1px dashed border (style.css:295-314), dashes 3px long and 3px
	 * apart, and its picture icon is a mask in the box's muted colour (`background: currentColor`)
	 */
	documentController.load(readFixture('r-image-remote'), parityOptions)
	settle()
	const remoteCapture = captureWindow()
	const remoteIconBox = bounds(find_test_id('remote-image-0-0')?.children?.[0] ?? 0)
	const remoteAltBox = bounds(find_test_id('image-blocked-0-0') ?? 0)
	const remoteIconInk = remoteIconBox
		? getInkColour(remoteCapture, remoteIconBox, [getPalette().background ?? ''])
		: null
	/** the box's top edge: the device row above the alt text holding the most pixels of the border colour */
	let remoteTop = -1
	if (remoteAltBox && remoteIconBox) {
		let most = 0
		for (
			let y = Math.round((remoteAltBox.y - 8) * remoteCapture.scale);
			y <= Math.round(remoteAltBox.y * remoteCapture.scale);
			y++
		) {
			let count = 0
			for (
				let x = Math.round(remoteIconBox.x * remoteCapture.scale);
				x <= Math.round((remoteAltBox.x + remoteAltBox.width) * remoteCapture.scale);
				x++
			)
				if (isNear(getDevicePixel(remoteCapture, x, y), getPalette().border ?? '', 24)) count++
			if (count > most) [most, remoteTop] = [count, y]
		}
	}
	const remoteRuns =
		remoteTop >= 0 && remoteIconBox && remoteAltBox
			? countRunsAlong(
					remoteCapture,
					remoteTop,
					Math.round((remoteIconBox.x + 4) * remoteCapture.scale),
					Math.round((remoteAltBox.x + remoteAltBox.width - 4) * remoteCapture.scale),
					getPalette().border ?? ''
				)
			: 0
	check(
		`a blocked image’s box paints a dashed border, 3px dashes 3px apart, and its icon in the muted colour (icon ${remoteIconInk}; runs along the top ${remoteRuns})`,
		[
			isNear(remoteIconInk ?? '', getPalette().muted ?? '', 12),
			remoteAltBox ? remoteRuns >= Math.floor((remoteAltBox.width + 14.4 - 8) / 6) - 1 : null
		],
		[true, true]
	)

	/**
	 * row r-code: editmd's `pre` (style.css:193-201) is a card filled in the surface colour with no ring, `padding: 0.9rem
	 * 1.1rem`, its lines 13.5px/1.55: four lines make it 2 × 14.4 + 4 × 20.925 = 112.5px tall, the first line 14.4px
	 * and 17.6px in, the `js` label 5.6px from its top and 9.6px from its right
	 */
	documentController.load(readFixture('r-code'), parityOptions)
	settle()
	const codeCapture = captureWindow()
	/**
	 * The card is a padded box (see `remoteLayout`), so its top-left corner is its Block's, which it starts, and its size
	 * its own.
	 */
	const codeBlockBox = bounds(find_test_id('block-0') ?? 0)
	const codeCardSize = bounds(find_test_id('code-card-0') ?? 0)
	const codeCard =
		codeBlockBox && codeCardSize
			? { ...codeBlockBox, width: codeCardSize.width, height: codeCardSize.height }
			: null
	const codeLines = bounds(find_test_id('code-0') ?? 0)
	const codeLabel = bounds(find_test_id('code-label-0') ?? 0)
	const codeEdge = codeCard
		? [0.25, 3].map((dy) =>
				getDevicePixel(
					codeCapture,
					Math.round((codeCard.x + codeCard.width / 2) * codeCapture.scale),
					Math.floor((codeCard.y + dy) * codeCapture.scale)
				)
			)
		: []
	check(
		`a code block paints editmd’s card: the surface fill to its edge with no ring, 112.5px tall for four lines, its text 14.4/17.6px in and its label 5.6/9.6px from the corner (edge, inside: ${codeEdge.join(', ')})`,
		[
			codeEdge.map((colour) => isNear(colour, getPalette().surface ?? '', 3)),
			codeCard ? snapToWanted([codeCard.height], [112.5]) : null,
			codeCard && codeLines
				? snapToWanted([codeLines.y - codeCard.y, codeLines.x - codeCard.x], [14.4, 17.6])
				: null,
			codeCard && codeLabel
				? snapToWanted([codeCard.x + codeCard.width - codeLabel.x - codeLabel.width], [9.6])
				: null
		],
		[[true, true], [112.5], [14.4, 17.6], [9.6]]
	)

	/**
	 * where the `js` label's ink starts below the card's top: 8px in editmd (device rows 96 and 112 in its window
	 * at 2x), the 0.35rem of `top` plus where WebKit sets 11px text in its line
	 */
	const labelInkTop = (() => {
		if (!codeCard || !codeLabel) return null

		const { scale } = codeCapture
		const surface = getPalette().surface ?? ''
		for (let y = Math.round(codeCard.y * scale); y < Math.round((codeCard.y + 30) * scale); y++)
			for (
				let x = Math.round(codeLabel.x * scale);
				x < Math.round((codeLabel.x + codeLabel.width) * scale);
				x++
			)
				if (!isNear(getDevicePixel(codeCapture, x, y), surface, 12)) return y / scale - codeCard.y

		return null
	})()
	check(
		`a code block’s language label paints its ink 8px below the card’s top, as editmd’s (${labelInkTop})`,
		labelInkTop === null ? null : snapToWanted([labelInkTop], [8]),
		[8]
	)

	/**
	 * a paragraph that also holds an image paints a link with no text as editmd does, in the accent with no fill, as a
	 * Block without an image does
	 */
	documentController.load(
		`![remote](${remote}/p.png) and an empty link [](https://example.com/e).\n`,
		parityOptions
	)
	settle()
	const mixedEmptyTheme = find_test_id('text-run-0-1')?.customProps?.theme
	check(
		'a paragraph holding an image paints its empty link’s source in the accent with no fill',
		[getField(mixedEmptyTheme, 'codeWash'), getField(mixedEmptyTheme, 'codeText')],
		['#00000000', getPalette().accent]
	)

	/** a task list's item paints a link with no text as editmd does, in the accent with no fill, as a paragraph does */
	documentController.load('- [ ] see [](https://x.example)\n', parityOptions)
	settle()
	const taskEmptyTheme = find_test_id('task-text-6')?.children?.[0]?.customProps?.theme
	check(
		'a task list item paints its empty link’s source in the accent with no fill',
		[getField(taskEmptyTheme, 'codeWash'), getField(taskEmptyTheme, 'codeText')],
		['#00000000', getPalette().accent]
	)

	/** a plain list's item paints a link with no text as a task list's item does, in the accent with no fill */
	documentController.load('- see [](https://example.com)\n', parityOptions)
	settle()
	const listEmptyTheme = find_test_id('list-text-2')?.children?.[0]?.customProps?.theme
	check(
		'a plain list item paints its empty link’s source in the accent with no fill',
		[getField(listEmptyTheme, 'codeWash'), getField(listEmptyTheme, 'codeText')],
		['#00000000', getPalette().accent]
	)

	/**
	 * open front matter's text paints muted, as editmd's `.frontmatter { color: var(--muted) }` keeps it while it is
	 * edited (frontmatter.ts:20-23)
	 */
	documentController.load(readFixture('r-frontmatter'), parityOptions)
	settle()
	click_test_id('block-0')
	settle()
	const frontmatterField = bounds(find_test_id('block-editor') ?? 0)
	const frontmatterInk = frontmatterField
		? getInkColour(captureWindow(), frontmatterField, [
				getPalette().surface ?? '',
				getPalette().accent ?? ''
			])
		: null
	press('escape')
	check(
		`open front matter paints its text in the muted colour (${frontmatterInk})`,
		isNear(frontmatterInk ?? '', getPalette().muted ?? '', 12),
		true
	)

	/**
	 * editmd's find bar is an AppKit view on the window's own background (EditorWindowController.swift:246-290), and
	 * its chevrons and Done are buttons, which keep the arrow cursor; the Help menu's search field shows the same
	 * magnifier as the find field
	 */
	documentController.load('Find me.\n', parityOptions)
	settle()
	press('cmd-f')
	settle()
	const findBar = bounds(find_test_id('find-bar') ?? 0)
	const findCapture = captureWindow()
	const findFill = findBar
		? getDevicePixel(
				findCapture,
				// The bar is a padded box (see `remoteLayout`), so its right end is the window's.
				Math.round(798 * findCapture.scale),
				Math.round((findBar.y + 3) * findCapture.scale)
			)
		: null
	const findMagnifierSource = getProp('find-magnifier', 'source')
	const findCursors = ['find-previous', 'find-next', 'find-done'].map(
		(id) => find_test_id(id)?.style?.cursor ?? null
	)
	press('escape')
	openMenu('Help')
	const helpField = bounds(find_test_id('help-search-box') ?? 0)
	const helpMagnifier = bounds(find_test_id('help-search-magnifier') ?? 0)
	const helpText = bounds(find_test_id('help-search') ?? 0)
	const helpMagnifierSource = getProp('help-search-magnifier', 'source')
	press('escape')
	check(
		`the find bar has no fill of its own and its chevrons and Done keep the arrow cursor; Help’s search shows the find field’s magnifier inside its left edge (bar ${findFill})`,
		[
			isNear(findFill ?? '', getPalette().background ?? '', 3),
			findCursors,
			helpField && helpMagnifier && helpText
				? helpMagnifier.x >= helpField.x && helpMagnifier.x + helpMagnifier.width <= helpText.x
				: null,
			helpMagnifierSource
		],
		[true, ['default', 'default', 'default'], true, findMagnifierSource]
	)

	/**
	 * the runs of device rows from `top` to `bottom` (logical px) that hold ink between `left` and `right`, each as its
	 * first row's distance below `top` in logical px: what differs from the page's background
	 */
	function getInkRowsBelow(top: number, bottom: number, left: number, right: number): number[] {
		const capture = captureWindow()
		const { scale } = capture
		const background = getPalette().background ?? ''
		const starts: number[] = []
		let inked = false
		for (let y = Math.round(top * scale); y <= Math.round(bottom * scale); y++) {
			let row = false
			for (let x = Math.round(left * scale); x <= Math.round(right * scale) && !row; x++)
				row = !isNear(getDevicePixel(capture, x, y), background, 6)
			if (row && !inked) starts.push(Math.round((y / scale - top) * 10) / 10)

			inked = row
		}
		return starts
	}

	/** ink rows below the first Block's top, across the column's left 600px, down 200px */
	function getInkBelowFirstBlock(): number[] {
		const first = bounds(find_test_id('block-0') ?? 0)
		return first ? getInkRowsBelow(first.y, first.y + 200, first.x, first.x + 600) : []
	}

	/**
	 * rows r-html, r-definitions and r-footnotes, measured in editmd's window (device px / 2) below the first
	 * Block's top: editmd sets a block of HTML inline in a 16px/1.65 line, so its mono text sits on the body's baseline,
	 * 50.5px down; a definition is a block of its own 0.86em mono in SF Mono's normal line box, 44.5px down; a footnote reference
	 * is a `sup`, which makes its line 2px taller, so the definition's rule, label and note come 44, 59 and 82px down
	 */
	documentController.load(readFixture('r-html'), parityOptions)
	settle()
	const htmlInk = getInkBelowFirstBlock()
	documentController.load(readFixture('r-definitions'), parityOptions)
	settle()
	const definitionInk = getInkBelowFirstBlock()
	documentController.load(readFixture('r-footnotes'), parityOptions)
	settle()
	const footnoteInk = getInkBelowFirstBlock()
	check(
		`HTML and definition lines and a footnote under a reference sit where editmd’s do (ink rows: ${htmlInk.join(' ')} | ${definitionInk.join(' ')} | ${footnoteInk.join(' ')})`,
		[
			snapToWanted(htmlInk.slice(1, 2), [50.5]),
			snapToWanted(definitionInk.slice(1, 2), [44.5]),
			snapToWanted(footnoteInk.slice(1, 4), [44, 59, 82])
		],
		[[50.5], [44.5], [44, 59, 82]]
	)

	/**
	 * a definition's `font: 0.86em var(--font-mono)` shorthand resets its line height to `normal` (style.css:353-357),
	 * SF Mono's line box: hhea ascender 1980 and descender 432 of 2048 units, 16.21px of 13.76px text. the definition is
	 * that tall, and the paragraph after it, which a definition leaves no margin above, starts that far below its top
	 */
	documentController.load('[docs]: https://example.com/docs\n\nNext.\n', parityOptions)
	settle()
	const definitionBlock = bounds(find_test_id('block-0') ?? 0)
	const afterDefinition = bounds(find_test_id('block-1') ?? 0)
	const definitionRows =
		definitionBlock && afterDefinition
			? [definitionBlock.height, afterDefinition.y - definitionBlock.y]
			: []
	check(
		`a definition’s line is SF Mono’s normal line box, 16.2px, and the next Block starts right below it (${definitionRows.join(', ')})`,
		snapToWanted(definitionRows, [16.2, 16.2]),
		[16.2, 16.2]
	)

	/**
	 * row cli-snapshot: editmd's code block is a `div.code-block` holding its `pre` and a diagram box (diagrams.ts:78-87)
	 * that `hidden` cannot hide, since `.diagram { display: flex }` outranks it: after the card come the pre's own `margin:
	 * 0 0 1em` of its 13.5px, 13.5px, the empty box's `padding: 1rem`, 32px, and its 1em margin, 16px, so a table after a
	 * code block starts 61.5px below the card (measured in editmd's --snapshot: 123 device pixels)
	 */
	documentController.load(
		'```js\nconst x = 1\n```\n\n| a | b |\n| - | - |\n| c | d |\n',
		parityOptions
	)
	settle()
	const codeThenTable = bounds(find_test_id('block-0') ?? 0)
	const codeTableCapture = captureWindow()
	const cardColumn = codeThenTable ? Math.round((codeThenTable.x + 12) * codeTableCapture.scale) : 0
	const cardBottom = codeThenTable
		? findFirstRowNear(
				codeTableCapture,
				cardColumn,
				Math.round((codeThenTable.y + 20) * codeTableCapture.scale),
				Math.round((codeThenTable.y + 300) * codeTableCapture.scale),
				getPalette().background ?? '',
				3
			)
		: -1
	const tableTop =
		cardBottom >= 0
			? findFirstRowNear(
					codeTableCapture,
					cardColumn,
					cardBottom,
					cardBottom + Math.round(200 * codeTableCapture.scale),
					getPalette().border ?? '',
					3
				)
			: -1
	check(
		`a table after a code block starts 61.5px below the code card, as editmd’s hidden diagram box keeps its room (card ends at device row ${cardBottom}, table starts at ${tableTop})`,
		snapToWanted([(tableTop - cardBottom) / codeTableCapture.scale], [61.5]),
		[61.5]
	)
}

export async function testCaretAndFrontMatterGap(): Promise<void> {
	// editmd's accent caret is drawn only in the page (style.css:105-120): Source mode and front matter keep the system's
	documentController.load(readFixture('r-frontmatter'), sandboxOptions)
	settle()
	press('cmd-/')
	settle()
	const sourceCaret = getField(getProp('source-editor', 'theme'), 'caret')
	press('cmd-/')
	settle()
	click_test_id('block-0')
	const frontmatterCaret = getField(getProp('block-editor', 'theme'), 'caret')
	press('escape')
	click_test_id('block-1')
	const blockCaret = getField(getProp('block-editor', 'theme'), 'caret')
	press('escape')
	check(
		'Source mode’s field keeps the system caret in the text colour and open front matter in the muted colour; a Block’s field keeps the accent caret',
		[sourceCaret, frontmatterCaret, blockCaret],
		[getPalette().text, getPalette().muted, getPalette().accent]
	)

	// row r-frontmatter: no box without front matter; with it, 2rem below the box
	const frontmatterGap = getBlockGaps()[0]
	documentController.load('# No front matter\n', sandboxOptions)
	settle()
	check(
		'a Document without front matter paints no front matter box; with it, the box keeps 2rem (32px) below it',
		[find_test_id('frontmatter-0'), snapToWanted([frontmatterGap ?? Number.NaN], [32])],
		[null, [32]]
	)
}

export async function testTickInLightAndDark(): Promise<void> {
	documentController.load('', isolated)

	/**
	 * row r-tasks: editmd's ticked box draws its check as an SVG path, `M2.5 6.2 5 8.6 9.6 3.6` in a 12-unit box, stroked
	 * white 1.8 wide with round caps and joins, at 75% of the box (style.css:262-266), in light and in dark
	 */
	const TICK_PATH = 'M2.5 6.2 5 8.6 9.6 3.6'
	async function measureTickLook(appearance: Appearance) {
		await remount({
			theme: new ThemeController({
				initialAppearance: () => appearance,
				readAppearance: () => appearance
			})
		})
		documentController.load('- [x] done\n', sandboxOptions)
		settle()
		const tick = find((node) => node.testId?.startsWith('task-tick-') === true)
		const box = bounds(find((node) => /^task-\d+$/.test(node.testId ?? '')) ?? 0)
		const capture = captureWindow()
		let white = 0
		if (box) {
			for (
				let y = Math.round(box.y * capture.scale);
				y < Math.round((box.y + box.height) * capture.scale);
				y++
			)
				for (
					let x = Math.round(box.x * capture.scale);
					x < Math.round((box.x + box.width) * capture.scale);
					x++
				)
					if (isNear(getDevicePixel(capture, x, y), '#ffffff', 24)) white++
		}
		return [tick?.type, String(tick?.customProps?.source ?? '').includes(TICK_PATH), white > 10]
	}
	const tickLooks = [await measureTickLook('light'), await measureTickLook('dark')]
	await remount()
	check('a ticked task’s box draws editmd’s check path in white, in light and in dark', tickLooks, [
		['svg', true, true],
		['svg', true, true]
	])
}

export async function testMonoAndSourcePadding(): Promise<void> {
	/**
	 * editmd's read-only mono text is SF Mono (`--font-mono: ui-monospace`): the closed front matter, a definition line, a
	 * block of HTML and a diagram's messages. SF Mono's advance is 98.90625/160 of the size (ten `i`s 98.9px at 16px),
	 * Menlo's 96.328/160. each element's advance, from the width Find washes over a run of one letter
	 */
	documentController.load(
		'---\ntitle: iiiiiiiiii\n---\n\n[iiiiiiiiii]: https://example.com\n\n<div>iiiiiiiiii</div>\n\n```mermaid\nnonsense\n```\n\n```mermaid\n```\n',
		sandboxOptions
	)
	settle()
	// a wash names the element that painted its run: the test id's own, or a text node inside it
	const getIdsWithin = (node: TreeNode | null): number[] =>
		node ? [node.id, ...(node.children ?? []).flatMap((child) => getIdsWithin(child))] : []
	/** each painted wash of the query, by the test id of the element it is in, as its width per character */
	async function measureAdvances(query: string, testIds: string[]): Promise<number[]> {
		await findQuery(query)
		const advances = testIds.map((testId) => {
			const ids = getIdsWithin(find_test_id(testId))
			const wash = painted_highlights().find(
				({ elementId, text, start, end }) =>
					ids.includes(elementId) && text.slice(start, end).toLowerCase() === query.toLowerCase()
			)
			const width = wash?.rects.reduce((sum, rect) => sum + rect.width, 0) ?? Number.NaN
			return Math.round((width / query.length) * 1000) / 1000
		})
		press('escape')
		return advances
	}
	const letterAdvances = await measureAdvances('iiiiiiiiii', [
		'frontmatter-0',
		'source-line-1',
		'source-line-2'
	])
	const messageAdvances = await measureAdvances('diagram', ['mermaid-error-3', 'mermaid-empty-4'])
	const toSfMonoAdvance = (size: number) => Math.round(((size * 98.90625) / 160) * 1000) / 1000
	const snapAdvances = (measured: number[], wanted: number[]) =>
		measured.map((advance, index) =>
			Math.abs(advance - (wanted[index] ?? 0)) <= 0.02 ? wanted[index] : advance
		)
	check(
		`closed front matter, definition and HTML lines and diagram messages paint in SF Mono (advances ${JSON.stringify([...letterAdvances, ...messageAdvances])})`,
		snapAdvances(
			[...letterAdvances, ...messageAdvances],
			[
				toSfMonoAdvance(12.5),
				toSfMonoAdvance(13.76),
				toSfMonoAdvance(13.76),
				toSfMonoAdvance(12.5),
				toSfMonoAdvance(12.5)
			]
		),
		[
			toSfMonoAdvance(12.5),
			toSfMonoAdvance(13.76),
			toSfMonoAdvance(13.76),
			toSfMonoAdvance(12.5),
			toSfMonoAdvance(12.5)
		]
	)

	/**
	 * a diagram's message is centred in its box as editmd's `.diagram` centres its child (style.css:421-431): the error
	 * here is narrower than the box, so the space left of it equals the space right of it
	 */
	const messageBox = bounds(find_test_id('mermaid-error-3') ?? 0)
	const messageFrame = bounds(find((_node, parent) => parent?.testId === 'mermaid-box-3') ?? 0)
	const errorMargins =
		messageBox && messageFrame
			? [
					Math.round(messageBox.x - messageFrame.x),
					Math.round(messageFrame.x + messageFrame.width - messageBox.x - messageBox.width)
				]
			: null
	check(
		`a diagram’s error narrower than its box is centred in it (left, right ${JSON.stringify(errorMargins)})`,
		errorMargins
			? [errorMargins[0]! > 0, Math.abs(errorMargins[0]! - errorMargins[1]!) <= 1]
			: null,
		[true, true]
	)

	/**
	 * editmd wraps its read-only mono text: `.frontmatter { white-space: pre-wrap }` (style.css:80), a definition's
	 * `overflow-wrap: anywhere` (style.css:356). a 200-character front matter value and a definition's 200-character URL
	 * wrap inside the column (more than their one line each), and a YAML item keeps its two leading spaces, two SF Mono
	 * advances at 12.5px before its `-`, read from where Find's wash over `- item` starts
	 */
	documentController.load(
		`---\ntitle: ${'v'.repeat(200)}\nlist:\n  - item\n---\n\n[ref]: https://example.com/${'a'.repeat(200)}\n`,
		sandboxOptions
	)
	settle()
	const longFrontmatter = bounds(find_test_id('frontmatter-0') ?? 0)
	const longDefinition = bounds(find_test_id('source-line-1') ?? 0)
	await findQuery('- item')
	const frontmatterIds = getIdsWithin(find_test_id('frontmatter-0'))
	const itemWash = painted_highlights().find(({ elementId }) => frontmatterIds.includes(elementId))
	const itemOffset =
		itemWash?.rects[0] && longFrontmatter
			? Math.round((itemWash.rects[0].x - longFrontmatter.x) * 100) / 100
			: null
	press('escape')
	check(
		`a 200-character front matter value and definition URL wrap inside the column, and a YAML item keeps its two spaces (front matter ${longFrontmatter?.width}×${longFrontmatter?.height}, definition ${longDefinition?.width}×${longDefinition?.height}, item at ${itemOffset})`,
		[
			longFrontmatter
				? longFrontmatter.width <= 656 - 32 && longFrontmatter.height > 5 * 19.375 + 1
				: null,
			longDefinition ? longDefinition.width <= 656 && longDefinition.height > 22.704 + 1 : null,
			itemOffset === null ? null : Math.abs(itemOffset - 2 * toSfMonoAdvance(12.5)) <= 0.5
		],
		[true, true, true]
	)

	/**
	 * editmd's `#editor` keeps `padding-bottom: 40vh` below Source mode's field too (style.css:64-69): scrolled to the end,
	 * 40% of the window shows below the field's last line
	 */
	await loadNumberedLinesInSource('\n')
	wheel({ x: 400, y: 300 }, 0, -100_000)
	settle()
	// the scrolling column's own box moves with its offset, so the page's end is the 538px window's bottom edge
	const sourceEnd = bounds(find_test_id('source-editor') ?? 0)
	const belowSource = sourceEnd
		? Math.round((538 - sourceEnd.y - sourceEnd.height) * 10) / 10
		: null
	press('cmd-/')
	settle()
	check(
		`scrolled to the end, Source mode’s page leaves 40% of the window below its field (${belowSource}px)`,
		belowSource === null ? null : snapToWanted([belowSource], [toHalfPixels(538 * 0.4)]),
		[toHalfPixels(538 * 0.4)]
	)
}

export async function testListContinuation(): Promise<void> {
	/**
	 * what follows an item's nested list is a continuation row of that item (ListItem.continuation): no marker,
	 * its text at its item's content column, after the nested items
	 */
	documentController.load('- a\n  - b\n\n  more text\n- c\n', sandboxOptions)
	settle()
	const continuationLines = painted().split('\n')
	initContinuationRows()
	check(
		`a list item’s text after its nested list paints after the nested item, with no marker, at the item’s text column (lines ${JSON.stringify(continuationLines)}, x ${firstItemText?.x} and ${continuationText?.x})`,
		[
			['b', 'more text', 'c']
				.map((line) => continuationLines.indexOf(line))
				.every((at, index, all) => at >= 0 && (index === 0 || at > all[index - 1]!)),
			firstItemText !== null && continuationText !== null && firstItemText.x === continuationText.x,
			find_test_id(`list-marker-${continuationRow?.contentStart ?? -1}`)
		],
		[true, true, null]
	)
}

export async function testStartWritingHint(): Promise<void> {
	/**
	 * editmd's "Start writing…" shows for a body with no text (style.css:394-399): a Document of blank lines, and one of
	 * front matter only, where it paints below the box (frontmatter.ts:104)
	 */
	documentController.load('\n\n\n', sandboxOptions)
	settle()
	const blankHint = painted().includes('Start writing…')
	press('escape')
	documentController.load('---\ntitle: A\n---\n', sandboxOptions)
	settle()
	const frontmatterOnlyHint = painted().includes('Start writing…')
	const bodyHintBox = bounds(find_test_id('empty-hint') ?? 0)
	const frontmatterOnlyBox = bounds(find_test_id('frontmatter-box-0') ?? 0)
	check(
		'a Document of blank lines shows “Start writing…”, and one of front matter only shows it below its box',
		[
			blankHint,
			frontmatterOnlyHint,
			bodyHintBox !== null &&
				frontmatterOnlyBox !== null &&
				bodyHintBox.y >= frontmatterOnlyBox.y + frontmatterOnlyBox.height
		],
		[true, true, true]
	)
}

export async function testInlineImagesTables(): Promise<void> {
	/**
	 * editmd's inline code inherits its text's colour (style.css:185-191): in a quote, a ticked task, a footnote and an
	 * h6, all muted, the code is muted too
	 */
	documentController.load(
		'> a `code`\n\n- [x] done `code`\n\n###### small `code`\n\nNote[^1].\n\n[^1]: see `code`\n',
		sandboxOptions
	)
	settle()
	const codeColours = [
		getField(getProp('markdown-0.0', 'theme'), 'codeText'),
		getField(
			find(
				(node) =>
					node.type === 'markdown' && node.customProps?.source?.toString().includes('done') === true
			)?.customProps?.theme,
			'codeText'
		),
		getField(find_test_id('block-2')?.children?.[0]?.customProps?.theme, 'codeText'),
		getField(getProp('footnote-4', 'theme'), 'codeText')
	]
	check(
		`inline code in a quote, a ticked task, an h6 and a footnote paints in their muted colour (${JSON.stringify(codeColours)})`,
		codeColours,
		[getPalette().muted, getPalette().muted, getPalette().muted, getPalette().muted]
	)

	// editmd's `li > p { margin: 0 }` (style.css:235): an item's two paragraphs stack with no gap between them
	documentController.load('- one\n\n  two\n', sandboxOptions)
	settle()
	const twoParagraphItem = bounds(
		find_test_id(`list-text-${documentController.blocks[0]?.items?.[0]?.contentStart ?? -1}`) ?? 0
	)
	check(
		`a list item’s two paragraphs stack with no gap, two 26.4px lines (${twoParagraphItem?.height}px)`,
		twoParagraphItem ? snapToWanted([twoParagraphItem.height], [52.8]) : null,
		[52.8]
	)

	/**
	 * a paragraph of only images lays them out as WebKit lays out inline images: side by side, wrapping at the column, a
	 * space apart (the badge row of a README)
	 */
	for (const name of ['a', 'b', 'c'])
		writeFileSync(join(sandboxDirectory, `${name}.png`), createPng(100, 50))
	const badgesPath = join(sandboxDirectory, 'badges.md')
	writeFileSync(badgesPath, '![a](a.png) ![b](b.png) ![c](c.png)\n')
	documentController.open(badgesPath, sandboxOptions)
	pump()
	const badgeBoxes = [0, 1, 2].map((n) => bounds(find_test_id(`image-0-${n}`) ?? 0))
	check(
		`a paragraph of three images paints them side by side on one line (${JSON.stringify(badgeBoxes.map((box) => box && [box.x, box.y]))})`,
		[
			badgeBoxes.every((box) => box !== null && box.y === badgeBoxes[0]?.y),
			badgeBoxes.every(
				(box, n) => n === 0 || (box !== null && box.x >= (badgeBoxes[n - 1]?.x ?? 0) + 100)
			)
		],
		[true, true]
	)

	// Format > Table's empty cells: every row's cells share one top and one height across the columns
	documentController.load(`${TABLE}\n`, sandboxOptions)
	settle()
	const tableRowLooks = [0, 1, 2].map((row) =>
		[0, 1, 2].map((column) => {
			const box = bounds(getCell(row, column) ?? 0)
			return box ? [box.y, box.height] : null
		})
	)
	check(
		`Format > Table’s empty rows line up: each row’s cells share their top and height (${JSON.stringify(tableRowLooks)})`,
		tableRowLooks.map((cells) =>
			cells.every((cell) => JSON.stringify(cell) === JSON.stringify(cells[0]))
		),
		[true, true, true]
	)

	// a tooltip paints in the palette's surface and text colours, as editmd's system tooltip does
	documentController.load(`![tracker](${remote}/p.png)\n`, sandboxOptions)
	settle()
	await loadTipAfterHover('remote-image-0-0', 'remote-image-tooltip-0-0-tip')
	const tipStyle = find_test_id('remote-image-tooltip-0-0-tip')?.style
	check(
		`a tooltip paints in the palette’s surface and text colours (${tipStyle?.backgroundColor}, ${tipStyle?.color})`,
		[tipStyle?.backgroundColor, tipStyle?.color],
		[getPalette().surface, getPalette().text]
	)
	mouse_move({ x: 5, y: 500 })

	/**
	 * a loaded remote image paints at its natural size, read from its bytes as a local image's are, and paints those
	 * same bytes: its <img> names no URL for GPUI to fetch again, so the image is fetched once
	 */
	let remoteFetches = 0
	documentController.load(`![remote](${remote}/natural.png)\n`, {
		...sandboxOptions,
		fetchImage: () => {
			remoteFetches++
			return Promise.resolve(createPng(300, 200))
		}
	})
	settle()
	documentController.allowRemoteImages()
	await waitUntil(
		() => bounds(find_test_id('image-0-0') ?? 0)?.height === 200,
		'the remote image’s natural size'
	)
	settle()
	const loadedRemoteBox = bounds(find_test_id('image-0-0') ?? 0)
	check(
		`a remote image, once loaded, paints at its natural 300 × 200 from the bytes fetched once (${loadedRemoteBox?.width}×${loadedRemoteBox?.height})`,
		[
			loadedRemoteBox ? [loadedRemoteBox.width, loadedRemoteBox.height] : null,
			remoteFetches,
			getProp('image-0-0', 'src') ?? null
		],
		[[300, 200], 1, null]
	)

	/**
	 * reference-style images, which the engine resolves through their definitions: `![pic][p]` paints its picture, not
	 * link text, and an image inside a reference link follows that link on ⌘-click
	 */
	writeFileSync(join(sandboxDirectory, 'ref.png'), createPng(300, 200))
	openFixture(sandboxDirectory, 'reference.md', '![pic][p]\n\n[p]: ref.png\n', sandboxOptions)
	settle()
	await settleAfter(300)
	const referenceBox = bounds(find_test_id('image-0-0') ?? 0)
	const linkedReferencePath = join(sandboxDirectory, 'linked-reference.md')
	writeFileSync(
		linkedReferencePath,
		'[![pic][p]][l] after it.\n\n[p]: ref.png\n[l]: https://example.com/ref\n'
	)
	documentController.open(linkedReferencePath, sandboxOptions)
	settle()
	await settleAfter(300)
	menuRuns.length = 0
	const linkedReferenceBox = bounds(find_test_id('image-0-0') ?? 0)
	if (linkedReferenceBox) {
		click_at(
			linkedReferenceBox.x + linkedReferenceBox.width / 2,
			linkedReferenceBox.y + linkedReferenceBox.height / 2,
			{ modifiers: 'cmd' }
		)
	}
	check(
		`a reference-style image paints its 300 × 200 picture, and one in a reference link follows the link on ⌘-click (${referenceBox?.width}×${referenceBox?.height})`,
		[
			referenceBox ? [referenceBox.width, referenceBox.height] : null,
			menuRuns.filter(([command]) => command === 'open'),
			find_test_id('block-editor')
		],
		[[300, 200], [['open', ['https://example.com/ref']]], null]
	)
	press('escape')

	// r-table: an image in a table cell paints as its picture, as editmd's `td img`, not as link text
	const tableImagePath = join(sandboxDirectory, 'table-image.md')
	writeFileSync(tableImagePath, '| pic | name |\n| - | - |\n| ![pic](ref.png) | text |\n')
	documentController.open(tableImagePath, sandboxOptions)
	settle()
	await settleAfter(300)
	const cellImageBox = bounds(find_test_id('image-0.1.0-0') ?? 0)
	check(
		`an image in a table cell paints its 300 × 200 picture (${cellImageBox?.width}×${cellImageBox?.height})`,
		cellImageBox ? [cellImageBox.width, cellImageBox.height] : null,
		[300, 200]
	)

	// a blocked image's tip is its src as written, as editmd titles it with the attribute (remote.ts:68)
	documentController.load('![tracker](//x.example/p.png)\n', sandboxOptions)
	settle()
	const writtenSrcTip = await loadTipAfterHover('remote-image-0-0', 'remote-image-tooltip-0-0-tip')
	mouse_move({ x: 5, y: 500 })
	check(
		'a blocked image’s tooltip shows its src as written in the markdown, not the URL it resolves to',
		writtenSrcTip,
		'//x.example/p.png'
	)

	/**
	 * a ticked task's strikes: one of its own is taken off and the whole text struck once ("gone kept", no `~~` painted and
	 * no code block), and a lone `~` stays a tilde in the struck text
	 */
	function measureStruckTask(source: string): [boolean, number, number] {
		documentController.load(source, sandboxOptions)
		settle()
		const start = documentController.blocks[0]?.items?.[0]?.contentStart ?? -1
		const text = bounds(find_test_id(`task-text-${start}`)?.children?.[0] ?? 0)
		const faint = text ? countMostInARow(captureWindow(), text, getPalette().faint ?? '') : 0
		return [
			painted().includes(
				source
					.slice(source.indexOf(']') + 2)
					.trim()
					.replaceAll('~~', '')
			),
			faint >= 20 ? 1 : 0,
			find_all((node) => node.type === 'code').length
		]
	}
	const struckOwn = measureStruckTask('- [x] ~~gone~~ kept\n')
	const struckTilde = measureStruckTask('- [x] pay 5~\n')
	check(
		`a ticked task with a strike of its own paints “gone kept” struck once with no code block, and “pay 5~” struck with its tilde (${JSON.stringify([struckOwn, struckTilde])})`,
		[struckOwn, struckTilde],
		[
			[true, 1, 0],
			[true, 1, 0]
		]
	)

	// a tab after `>` is the quote marker's space and then text, not an indented code block
	documentController.load('>\tfoo\n', sandboxOptions)
	settle()
	const tabQuoteSource = getProp('markdown-0.0', 'source')
	const tabQuoteBox = bounds(find_test_id('markdown-0.0') ?? 0)
	const tabQuoteWash = tabQuoteBox
		? countMostInARow(captureWindow(), tabQuoteBox, getPalette().surface ?? '')
		: -1
	check(
		`a quote of “>\\tfoo” paints foo as quote text, with no code block’s fill (${JSON.stringify(tabQuoteSource)}, ${tabQuoteWash} surface pixels in a row)`,
		[typeof tabQuoteSource === 'string' && tabQuoteSource.trim() === 'foo', tabQuoteWash < 20],
		[true, true]
	)

	// a row mixing empty and filled cells keeps them in line, an empty cell one line tall as editmd's empty paragraph
	documentController.load('| a |  |\n| - | - |\n|  | b |\n', sandboxOptions)
	settle()
	const mixedRowLooks = [0, 1].map((row) =>
		[0, 1].map((column) => {
			const box = bounds(getCell(row, column) ?? 0)
			return box ? [box.y, box.height] : null
		})
	)
	/**
	 * GFM splits a row on every pipe that is not escaped, inside a code span too (measured headless: satteri
	 * gives "`x" and "y`"), and `\|` is a pipe in the cell's text, a code span's too
	 */
	documentController.load(
		'| h | i |\n| - | - |\n| `x|y` |\n\n| j |\n| - |\n| `x\\|y` |\n',
		sandboxOptions
	)
	settle()
	const pipeCells = [getCellSource(1, 0), getCellSource(1, 1)]
	/** the sources every <markdown> inside `node` paints, in order */
	const getSources = (node: TreeNode | null | undefined): unknown[] =>
		node
			? [
					...(node.type === 'markdown' ? [node.customProps?.source] : []),
					...(node.children ?? []).flatMap(getSources)
				]
			: []
	const escapedPipe = getSources(find_test_id('table-1'))[1]
	check(
		`a table row mixing empty and filled cells keeps each row’s cells in line, and a pipe in a code span splits its cell unless escaped (${JSON.stringify([mixedRowLooks, pipeCells, escapedPipe])})`,
		[
			mixedRowLooks.map((cells) =>
				cells.every((cell) => JSON.stringify(cell) === JSON.stringify(cells[0]))
			),
			pipeCells,
			escapedPipe
		],
		[[true, true], ['`x', 'y`'], '`x|y`']
	)

	/** each row's cells of the table keyed `0` as [top, height], rounded to the half pixel GPUI snaps to */
	function getCellLooks(rows: number, columns: number): (number[] | null)[][] {
		return Array.from({ length: rows }, (_row, row) =>
			Array.from({ length: columns }, (_column, column) => {
				const box = bounds(getCell(row, column) ?? 0)
				return box ? [Math.round(box.y * 2) / 2, Math.round(box.height * 2) / 2] : null
			})
		)
	}
	const getRowsInLine = (looks: (number[] | null)[][]) =>
		looks.map((cells) => cells.every((cell) => JSON.stringify(cell) === JSON.stringify(cells[0])))

	// r-table: a cell holding long inline code keeps every row's cells in line, as one table row does in WebKit
	documentController.load(
		'| name | value |\n| - | - |\n| `averyveryverylongidentifier_with_code` | plain |\n| two | `x` |\n',
		sandboxOptions
	)
	// each cell's layout event gives its row's height with no clock advance
	pump()
	const codeTableLooks = getCellLooks(3, 2)
	check(
		`a table whose cell holds long inline code keeps each row’s cells in line (${JSON.stringify(codeTableLooks)})`,
		getRowsInLine(codeTableLooks),
		[true, true, true]
	)

	/**
	 * a table's rows take their heights from its cells' layout events once painted, with no clock advance: every cell's
	 * box holds at least its row's tallest text, a table drawn afresh too
	 */
	documentController.load('', sandboxOptions)
	settle()
	documentController.load('| a | `b` |\n| - | - |\n| c | d |\n', sandboxOptions)
	pump()
	check(
		'a table drawn afresh sets every cell’s row height with no clock advance',
		[0, 1].flatMap((row) =>
			[0, 1].map((column) => typeof getCell(row, column)?.children?.[0]?.style?.minHeight)
		),
		['number', 'number', 'number', 'number']
	)
}

export async function testRemoteImagesAndQuoteLinks(): Promise<void> {
	/**
	 * a remote image's size by default reads only the image's first bytes (`fetchImageHead`): a server that
	 * sends the picture and then stalls still sizes it, where reading the whole answer would wait for ever
	 */
	const stallServer = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'image/png' })
		response.write(createPng(300, 200))
		// past the 1MiB the head reads, then nothing more and no end
		response.write(Buffer.alloc(1024 * 1024 + 4096))
	})
	await new Promise<void>((resolve) => stallServer.listen(0, '127.0.0.1', resolve))
	const stallAddress = stallServer.address()
	const stallUrl = `http://127.0.0.1:${typeof stallAddress === 'object' && stallAddress ? stallAddress.port : 0}/stall.png`
	// the window's own reader, where sandboxOptions' never answers: this loopback server is all it reaches
	documentController.load(`![stalled](${stallUrl})\n`, {
		...sandboxOptions,
		fetchImage: fetchImageHead
	})
	settle()
	documentController.allowRemoteImages()
	await waitUntil(
		() => bounds(find_test_id('image-0-0') ?? 0)?.height === 200,
		'the stalled image’s size'
	)
	settle()
	const stalledBox = bounds(find_test_id('image-0-0') ?? 0)
	documentController.load('', sandboxOptions)
	settle()
	stallServer.closeAllConnections()
	stallServer.close()
	check(
		`a remote image whose server stalls after its first bytes still paints at its natural 300 × 200 (${stalledBox?.width}×${stalledBox?.height})`,
		stalledBox ? [stalledBox.width, stalledBox.height] : null,
		[300, 200]
	)

	/** a real one-colour GIF of `width` × `height`: LZW codes of 3 bits, a clear code before every pixel so they stay 3 */
	function createGif(width: number, height: number): Buffer {
		const codes: number[] = []
		for (let pixel = 0; pixel < width * height; pixel++) codes.push(4, 0)
		codes.push(5)
		const packed: number[] = []
		let bits = 0
		let count = 0
		for (const code of codes) {
			bits |= code << count
			count += 3
			while (count >= 8) {
				packed.push(bits & 0xff)
				bits >>= 8
				count -= 8
			}
		}
		if (count > 0) packed.push(bits & 0xff)

		const blocks: number[] = []
		for (let at = 0; at < packed.length; at += 255) {
			const block = packed.slice(at, at + 255)
			blocks.push(block.length, ...block)
		}
		const toLittleEndianBytes = (value: number) => [value & 0xff, value >> 8]
		return Buffer.from([
			...Buffer.from('GIF89a'),
			...toLittleEndianBytes(width),
			...toLittleEndianBytes(height),
			// a global colour table of two entries, black and white
			0x80,
			0,
			0,
			0,
			0,
			0,
			255,
			255,
			255,
			0x2c,
			...toLittleEndianBytes(0),
			...toLittleEndianBytes(0),
			...toLittleEndianBytes(width),
			...toLittleEndianBytes(height),
			0,
			2,
			...blocks,
			0,
			0x3b
		])
	}

	// a `data:` image is sized from its own bytes and paints, as WebKit paints it
	documentController.load(
		`![d](data:image/gif;base64,${createGif(12, 34).toString('base64')})\n`,
		sandboxOptions
	)
	settle()
	await settleAfter(300)
	const dataImageBox = bounds(find_test_id('image-0-0') ?? 0)
	check(
		`a data: GIF of 12 × 34 paints as an image at 12 × 34, not its alt text (${find_test_id('image-0-0')?.type}, ${dataImageBox?.width}×${dataImageBox?.height})`,
		[
			find_test_id('image-0-0')?.type,
			dataImageBox ? [dataImageBox.width, dataImageBox.height] : null
		],
		['img', [12, 34]]
	)

	// two images joined by a hard break stack, with no `\` painted between them
	writeFileSync(join(sandboxDirectory, 'break-a.png'), createPng(100, 50))
	writeFileSync(join(sandboxDirectory, 'break-b.png'), createPng(100, 50))
	const hardBreakPath = join(sandboxDirectory, 'hard-break.md')
	writeFileSync(hardBreakPath, '![a](break-a.png)\\\n![b](break-b.png)\n')
	documentController.open(hardBreakPath, sandboxOptions)
	settle()
	await settleAfter(300)
	const brokenFirst = bounds(find_test_id('image-0-0') ?? 0)
	const brokenSecond = bounds(find_test_id('image-0-1') ?? 0)
	check(
		`two images joined by a hard break stack, with no \\ painted (${JSON.stringify([brokenFirst?.y, brokenSecond?.y])})`,
		[
			painted().split('\n').includes('\\'),
			brokenFirst !== null && brokenSecond !== null && brokenSecond.y >= brokenFirst.y + 50
		],
		[false, true]
	)

	/**
	 * r-link-cursor: a link in a quote keeps editmd's accent underline, as `.markdown-body a` sets it wherever the link
	 * sits: the accent at 60%, the accent while ⌘ is held
	 */
	documentController.load('> [a linked phrase](https://example.com/x)\n', sandboxOptions)
	settle()
	const quoteLinkBox = bounds(find_test_id('markdown-0.0') ?? 0)
	const getQuoteUnderline = () =>
		quoteLinkBox
			? getLongestRunColour(captureWindow(), quoteLinkBox, [getPalette().background ?? ''])
			: null
	const quoteUnderlineBefore = getQuoteUnderline()
	press('cmd', { held: true })
	settle()
	const quoteUnderlineHeld = getQuoteUnderline()
	key_up('cmd')
	settle()
	check(
		`a link’s underline in a quote turns from the accent at 60% to the accent while ⌘ is held, as outside one (${quoteUnderlineBefore}, ${quoteUnderlineHeld})`,
		[
			isNear(quoteUnderlineBefore ?? '', getLinkUnderlineInk(), 6),
			isNear(quoteUnderlineHeld ?? '', getPalette().accent ?? '', 6)
		],
		[true, true]
	)
}

export async function testMermaidPreviewClick(): Promise<void> {
	/**
	 * e-mermaid-edit: the open mermaid Block's preview keeps the pointer, and a click on it puts the caret at the
	 * end of the diagram's source, as editmd's `editSource` (diagrams.ts:86,169-177)
	 */
	documentController.load('```mermaid\nflowchart LR\n  A --> B\n```\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	settle()
	type('cmd-up')
	const previewCursor = find_test_id('mermaid-box-0')?.style?.cursor
	click_test_id('mermaid-box-0')
	settle()
	type('x')
	await waitForFieldIdle()
	press('escape')
	check(
		`a click on the open mermaid Block’s preview, under the pointer cursor, puts the caret at the end of the source (${previewCursor})`,
		[previewCursor, documentController.text],
		['pointer', '```mermaid\nflowchart LR\n  A --> Bx\n```\n']
	)
}

export async function testBrokenRemoteImage(): Promise<void> {
	/**
	 * A remote image that fails once Load Remote Images allows it (a 404) paints its alt text, as a missing local file
	 * does.
	 */
	documentController.load(`![gone picture](${remote}/404.png) after it.\n`, {
		...sandboxOptions,
		fetchImage: () => Promise.reject(new Error(`404 for ${remote}/404.png`))
	})
	settle()
	documentController.allowRemoteImages()
	settle()
	await waitUntil(() => find_test_id('image-missing-0-0') !== null, 'the failed image’s alt text')
	settle()
	/**
	 * WebKit's broken image, as editmd's picture shows it: a box the size of the alt text in a 1px light grey border, its
	 * question-mark icon (16 × 16) centred in it; the alt text sizes the box, painting nothing beside the icon
	 */
	const brokenBox = bounds(find_test_id('image-broken-0-0') ?? 0)
	const brokenIcon = bounds(find_test_id('image-broken-icon-0-0') ?? 0)
	const brokenAlt = bounds(find_test_id('image-missing-0-0') ?? 0)
	check(
		`a remote image that fails to load paints WebKit’s broken-image box and icon over its alt text, not GPUI’s load-failed box (${JSON.stringify([brokenBox, brokenIcon, brokenAlt])})`,
		[
			getText('image-missing-0-0'),
			find_test_id('image-0-0'),
			find_test_id('image-broken-0-0')?.style?.borderColor,
			brokenIcon ? [brokenIcon.width, brokenIcon.height] : null,
			brokenBox && brokenIcon && brokenAlt
				? [
						brokenIcon.x + brokenIcon.width / 2 === brokenBox.x + brokenBox.width / 2,
						brokenBox.width >= brokenAlt.width
					]
				: null,
			find_test_id('image-missing-0-0')?.style?.opacity
		],
		['gone picture', null, '#c0c0c0', [16, 16], [true, true], 0]
	)
}

export async function testDefinitionsAndCodeLabel(): Promise<void> {
	// r-definitions: a definition paints rebuilt from what it defines, as editmd's links.ts:133-136
	documentController.load("[Docs]:   <https://example.com/a b>   'Single'\n", sandboxOptions)
	settle()
	check(
		'a link definition paints as `[Docs]: https://example.com/a b "Single"`, rebuilt from what it defines',
		painted().includes('[Docs]: https://example.com/a b "Single"'),
		true
	)

	/**
	 * Find leaves out a code block's language label, which editmd paints as `pre[data-language]::before` and its find never
	 * matches: the label declares a highlight of its own that matches nothing (measured headless)
	 */
	documentController.load('```js\nlet js = 1\n```\n', sandboxOptions)
	settle()
	press('cmd-f')
	// the field keeps an earlier query, which the typing replaces
	type('cmd-a')
	type('j')
	type('s')
	const labelFind = await loadFindState()
	const labelQuery = findController.query
	const labelWashes = painted_highlights().map((wash) => wash.text.slice(wash.start, wash.end))
	press('escape')
	settle()
	check(
		`Find of “js” over a js code block counts the code’s one match, not its language label (${JSON.stringify(labelFind)}, query ${JSON.stringify(labelQuery)}, washes ${JSON.stringify(labelWashes)})`,
		labelFind,
		[1, 0, 0]
	)
}

export async function testNestedBlocks(): Promise<void> {
	/**
	 * editmd paints a Block inside a quote or a list item as it paints one at the top level: its style.css applies to every
	 * element of `.markdown-body` (style.css:126-226). a nested Block's test ids carry its place, `<index>.<n>`
	 */
	documentController.load('```js\nlet a = 1\n```\n\n- ```js\n  let a = 1\n  ```\n', sandboxOptions)
	settle()
	const topCodeCard = bounds(find_test_id('code-card-0') ?? 0)
	const itemCodeCard = bounds(find_test_id('code-card-1.0.0') ?? 0)
	check(
		`a js fence inside a list item paints a code card as tall as a top-level one holding the same code (${topCodeCard?.height}, ${itemCodeCard?.height})`,
		[
			getProp('code-1.0.0', 'code'),
			itemCodeCard !== null && topCodeCard !== null && itemCodeCard.height === topCodeCard.height
		],
		['let a = 1', true]
	)

	documentController.load('> ## Two\n\n> ###### Six\n', sandboxOptions)
	settle()
	const quotedSixSizes = getField(
		getField(getProp('markdown-1.0', 'theme'), 'metrics'),
		'mdHeadingSizes'
	)
	check(
		'a heading inside a quote paints as a top-level one in the quote’s muted colour: an h2 over its 1px rule, an h6 at 14.4px',
		[
			find_test_id('heading-rule-0.0')?.style?.borderBottomWidth,
			getField(getProp('markdown-0.0', 'theme'), 'text'),
			getField(getProp('markdown-1.0', 'theme'), 'text'),
			Array.isArray(quotedSixSizes) ? quotedSixSizes[3] : null
		],
		[1, getPalette().muted, getPalette().muted, 14.4]
	)

	documentController.load('> > q\n', sandboxOptions)
	settle()
	/** a quote's rail: its width and colour, and its fill, null for none */
	function getRail(testId: string) {
		const style = find_test_id(testId)?.style
		return [style?.borderLeftWidth, style?.borderColor, style?.backgroundColor ?? null]
	}
	check(
		'a quote inside a quote paints a second plain rail inside the first, with no wash, its text without `>`',
		[getRail('quote-0'), getRail('quote-0.0'), getProp('markdown-0.0.0', 'source')],
		[[4, getPalette().border, null], [4, getPalette().border, null], 'q']
	)

	documentController.load('> - [ ] x\n', sandboxOptions)
	settle()
	const quotedTaskMark = documentController.blocks[0]?.children?.[0]?.tasks?.[0]?.mark
	check(
		'a task list inside a quote paints its checkbox, not its brackets as text',
		[quotedTaskMark, find_test_id(`task-${quotedTaskMark}`) !== null, painted().includes('[ ]')],
		[5, true, false]
	)
	click_test_id(`task-${quotedTaskMark}`)
	settle()
	check(
		'a task box inside a quote ticks on click, the quote’s field staying closed',
		[documentController.text, find_test_id('block-editor')],
		['> - [x] x\n', null]
	)

	/**
	 * a code block inside a quote paints its text in the quote's muted colour: editmd's `pre` sets no colour of its own,
	 * so its code inherits `blockquote { color: var(--muted) }` (style.css:193-209, 222-226). for a js fence's code
	 * and a bare fence's, on the card's surface: its most frequent ink, and the most pixels in one row within 4 of the
	 * body text's colour, which a keyword painted in it would show
	 */
	function measureQuotedCodeInk(source: string): [string | null, number] {
		documentController.load(source, sandboxOptions)
		settle()
		const box = bounds(find_test_id('code-0.0') ?? 0)
		if (!box) return [null, -1]

		const capture = captureWindow()
		return [
			getInkColour(capture, box, [getPalette().surface ?? '']),
			countMostInARow(capture, box, getPalette().text ?? '')
		]
	}
	const quotedCodeInks = [
		measureQuotedCodeInk('> ```js\n> let quoted = function () { return "s" }\n> ```\n'),
		measureQuotedCodeInk('> ```\n> plain quoted words\n> ```\n')
	]
	check(
		`a code block inside a quote paints its text in the muted colour, none in the body text’s (${JSON.stringify(quotedCodeInks)})`,
		quotedCodeInks.map(([ink, textPixels]) => [
			isNear(ink ?? '', getPalette().muted ?? '', 12),
			textPixels
		]),
		[
			[true, 0],
			[true, 0]
		]
	)

	/**
	 * a paragraph of images inside a list item or a quote paints its images as one at the top level does, not as link
	 * text: editmd's style.css applies to every `img` of `.markdown-body`
	 */
	writeFileSync(join(sandboxDirectory, 'nested.png'), createPng(60, 40))
	const nestedImagesPath = join(sandboxDirectory, 'nested-images.md')
	writeFileSync(
		nestedImagesPath,
		'- ![a](nested.png)\n- ![b](nested.png) beside text\n\n> ![c](nested.png)\n'
	)
	documentController.open(nestedImagesPath, sandboxOptions)
	settle()
	check(
		'an image paragraph in a list item, one mixing an image and text in another, and one in a quote paint their images',
		['image-0.0.0-0', 'image-0.1.0-0', 'image-1.0-0'].map((id) => find_test_id(id)?.type ?? null),
		['img', 'img', 'img']
	)

	// two tables' cells carry their own Block's key, so the second's never take the first's ids
	documentController.load('| a |\n| - |\n| b |\n\n| c |\n| - |\n| d |\n', sandboxOptions)
	settle()
	check(
		'each table’s cells carry its own key: the first table’s body cell and the second’s',
		[getCellSource(1, 0, '0'), getCellSource(1, 0, '1')],
		['b', 'd']
	)

	documentController.load('> ```mermaid\n> flowchart LR\n>   A --> B\n> ```\n', sandboxOptions)
	settle()
	check(
		'a mermaid diagram inside a quote paints as its diagram',
		getProp('mermaid-0.0', 'src') ?? null,
		getDiagramSrc('flowchart LR\n  A --> B')
	)

	documentController.load('> | a | b |\n> | - | - |\n> | c | d |\n', sandboxOptions)
	settle()
	check(
		'a table inside a quote paints its own cells, without the quote’s `>`',
		[
			getCellSource(0, 0, '0.0'),
			getCellSource(0, 1, '0.0'),
			getCellSource(1, 0, '0.0'),
			getCellSource(1, 1, '0.0')
		],
		['**a**', '**b**', 'c', 'd']
	)
}

export async function testCodeSpansBaselineUnderline(): Promise<void> {
	/**
	 * editmd's inline code `border: 1px solid color-mix(in srgb, var(--border) 60%, transparent); border-radius: 5px`
	 * (style.css:185-191), which native's pill lacks: each painted box with its bounds, border width, colour and radius
	 */
	const getCodeBorders = () =>
		find_all((node) => node.testId?.startsWith('code-border-') === true).map((node) => {
			const box = bounds(node)
			const style = node.style
			return {
				box: box ? [box.x, box.y, box.width, box.height] : [],
				width: style?.borderLeftWidth ?? style?.borderWidth,
				colour: style?.borderColor,
				radius: style?.borderTopLeftRadius ?? style?.borderRadius
			}
		})
	/** the borders' boxes, each length shown as native's pill's where it is within half a pixel of it */
	const getCodeBorderBoxes = (pills: number[][]) =>
		getCodeBorders().map(({ box }, index) => snapToWanted(box, pills[index] ?? []))
	/** waits out the poll that reads the code spans' painted boxes */
	async function settleCodeBorders() {
		settle()
		await settleAfter(250)
	}

	// an Agent's changed run and Find's matches in a Block with a code span keep working beside its border
	await mergeByEta('code-run', 'The `code` fox jumps.\n', 'The `code` fox leaps.\n')
	await settleCodeBorders()
	const codeRunUnderlines = find_all(
		(node) => node.testId?.startsWith('run-underline-') === true
	).length
	check(
		'a Block with a code span that an Agent changed keeps its run’s underline and the code span’s border',
		[codeRunUnderlines, getCodeBorders().length],
		[1, 1]
	)
	documentController.load('a `code` b and code\n', parityOptions)
	await settleCodeBorders()
	const codeFindCounts: number[] = []
	for (const query of ['code', 'a code b']) {
		findController.typeInField(query)
		await settleCodeBorders()
		codeFindCounts.push(findController.matches.length)
	}
	findController.typeInField('')
	await settleCodeBorders()
	check(
		'Find in a Block with a code span counts the code span’s text once: `code` twice, `a code b` once',
		codeFindCounts,
		[2, 1]
	)

	/** a fresh 538px-high window `width` wide in `appearance`, its theme returned so a check can zoom it */
	async function mountCodeBorderWindow(appearance: Appearance, width = 800) {
		const theme = new ThemeController({
			readAppearance: () => appearance,
			pollInterval: 60_000,
			readScrollerStyle: () => 'overlay'
		})
		await remount({ theme, width })
		return theme
	}

	// native's pills as painted headless at 2x, read from the surface colour's pixels
	const plainPill = [82.5, 74, 44, 22.5]
	const lightCodeTheme = await mountCodeBorderWindow('light')
	documentController.load('a `code` b\n', parityOptions)
	await settleCodeBorders()
	const lightPlainBorders = getCodeBorders()
	const lightPlainBoxes = getCodeBorderBoxes([plainPill])
	lightCodeTheme.zoom = 1.5
	await settleCodeBorders()
	const zoomedBorders = getCodeBorders()
	const zoomedBoxes = getCodeBorderBoxes([[75.5, 98, 63.5, 35.5]])
	check(
		`a code span has a 1px border in --code-border on native’s pill, radius 5px, 7.5px at zoom 1.5, where it moves with the zoom (${JSON.stringify([lightPlainBorders, zoomedBorders])})`,
		[
			lightPlainBoxes,
			lightPlainBorders.map(({ width, colour, radius }) => [width, colour, radius]),
			zoomedBoxes,
			zoomedBorders.map(({ radius }) => radius)
		],
		[[plainPill], [[1, paletteFor('light')['code-border'], 5]], [[75.5, 98, 63.5, 35.5]], [7.5]]
	)
	lightCodeTheme.zoom = 1

	const codeSpanPills: [string, string, number[]][] = [
		['heading', '# a `code` b\n', [95.5, 74, 87, 38]],
		['list item', '- a `code` b\n', [110.5, 74, 44, 22.5]],
		['quote', '> a `code` b\n', [102.5, 74, 44, 22.5]],
		['table cell', '| h |\n| - |\n| a `code` b |\n', [96, 119, 41, 21]]
	]
	const codeSpanBoxes: number[][][] = []
	for (const [, source, pill] of codeSpanPills) {
		documentController.load(source, parityOptions)
		await settleCodeBorders()
		codeSpanBoxes.push(getCodeBorderBoxes([pill]))
	}
	check(
		`a code span in a heading, a list item, a quote and a table cell has its border on its pill (${JSON.stringify(codeSpanBoxes)})`,
		codeSpanBoxes,
		codeSpanPills.map(([, , pill]) => [pill])
	)

	documentController.load('[](u) `code` <kbd>x</kbd>\n', parityOptions)
	await settleCodeBorders()
	const besideMonoCount = getCodeBorders().length
	click_test_id('block-0')
	await settleCodeBorders()
	const openFieldCount = getCodeBorders().length
	press('escape')
	await settleCodeBorders()
	check(
		'an empty link and inline HTML, which native also paints as code, take no border, the code span beside them one; an open field shows none',
		[besideMonoCount, openFieldCount, getCodeBorders().length],
		[1, 0, 1]
	)

	// a span wrapped over two rows has a border on each row's pill, and they move when the window's width reflows them
	const wrappedCode = `${'word '.repeat(22)}\`wrapped code span here\` tail\n`
	documentController.load(wrappedCode, parityOptions)
	await settleCodeBorders()
	const wideWrapBoxes = getCodeBorderBoxes([[311, 100.5, 221.5, 22.5]])
	await mountCodeBorderWindow('dark', 600)
	documentController.load(wrappedCode, parityOptions)
	await settleCodeBorders()
	const narrowWrapBoxes = getCodeBorderBoxes([
		[439.5, 100.5, 83, 22.5],
		[40, 127, 140.5, 22.5]
	])
	check(
		`a code span wrapped over two rows has a border on each row’s pill, which follows the reflow of a narrower window, in the dark --code-border (${JSON.stringify([wideWrapBoxes, narrowWrapBoxes])})`,
		[wideWrapBoxes, narrowWrapBoxes, getCodeBorders().map(({ colour }) => colour)],
		[
			[[311, 100.5, 221.5, 22.5]],
			[
				[439.5, 100.5, 83, 22.5],
				[40, 127, 140.5, 22.5]
			],
			[paletteFor('dark')['code-border'], paletteFor('dark')['code-border']]
		]
	)
	const wrapEdges = find_all((node) => node.testId?.startsWith('code-border-') === true).map(
		({ style }) => [
			style?.borderLeftWidth ?? style?.borderWidth,
			style?.borderRightWidth ?? style?.borderWidth,
			style?.borderTopLeftRadius ?? style?.borderRadius,
			style?.borderTopRightRadius ?? style?.borderRadius
		]
	)
	check(
		`a code span wrapped over two rows is open where it breaks, as editmd’s inline border is sliced there: the first row has no right border or right corners, the last no left ones (${JSON.stringify(wrapEdges)})`,
		wrapEdges,
		[
			[1, 0, 5, 0],
			[0, 1, 0, 5]
		]
	)

	// a tip longer than the window wraps at the window's edge, as AppKit gives no wrap width of its own to copy
	await mergeByEta('long-gone', `- a\n- ${'word '.repeat(59)}words\n- c\n`, '- a\n- c\n')
	const longGapId = getGapLines()[0]?.testId ?? 'no-gap'
	const longTipId = `${longGapId.replace('gap-', 'gap-tooltip-')}-tip`
	await loadTipAfterHover(longGapId, longTipId)
	const longTipBox = bounds(find_test_id(longTipId) ?? 0)
	check(
		`a 300-character deletion tip in a 600px window wraps onto more than its two lines and stays inside the window (${JSON.stringify(longTipBox)})`,
		longTipBox
			? [
					longTipBox.height > 2 * 16 + 8,
					longTipBox.x >= 0 && longTipBox.x + longTipBox.width <= window_size.width
				]
			: null,
		[true, true]
	)
	await remount()

	rmSync(sandboxDirectory, { recursive: true, force: true })

	/**
	 * the logical y just below the lowest device row inside `box` (logical px) holding a pixel within 96 of `colour`, null
	 * for none: a capital's ink, which has no descender, ends on its line's baseline
	 */
	function getInkBottom(capture: { shot: Pixels; scale: number }, box: Box, colour: string) {
		const { scale } = capture
		for (let y = Math.floor((box.y + box.height) * scale) - 1; y >= Math.ceil(box.y * scale); y--)
			for (let x = Math.ceil(box.x * scale); x < Math.floor((box.x + box.width) * scale); x++)
				if (isNear(getDevicePixel(capture, x, y), colour, 96)) return (y + 1) / scale

		return null
	}

	/** the logical y of the highest device row inside `box` (logical px) holding a pixel within 96 of `colour`, null for none */
	function getInkTop(capture: { shot: Pixels; scale: number }, box: Box, colour: string) {
		const { scale } = capture
		for (let y = Math.ceil(box.y * scale); y < Math.floor((box.y + box.height) * scale); y++)
			for (let x = Math.ceil(box.x * scale); x < Math.floor((box.x + box.width) * scale); x++)
				if (isNear(getDevicePixel(capture, x, y), colour, 96)) return y / scale

		return null
	}

	/**
	 * A README badge beside text sits centred on the capitals beside it, the user's choice over WebKit's baseline, where
	 * editmd's badge rides high (its bottom on the baseline, `vertical-align` unset in style.css).
	 */
	openFixture(parityDirectory, 'baseline.md', '![badge](badge.png) HHHH HHHH\n', {
		...parityOptions,
		socketsDirectory: join(parityDirectory, 's')
	})
	pump()
	settle()
	const badgeBox = bounds(find_test_id('image-0-0') ?? 0)
	const capitalsBox = bounds(find_test_id('text-run-0-1') ?? 0)
	const capture = captureWindow()
	const ink = getPalette().text ?? ''
	const capitalsTop = capitalsBox ? getInkTop(capture, capitalsBox, ink) : null
	const capitalsBaseline = capitalsBox ? getInkBottom(capture, capitalsBox, ink) : null
	const badgeMiddle = badgeBox ? badgeBox.y + badgeBox.height / 2 : null
	const capitalsMiddle =
		capitalsTop !== null && capitalsBaseline !== null ? (capitalsTop + capitalsBaseline) / 2 : null
	check(
		`a paragraph’s image sits centred on the capitals beside it (image middle ${badgeMiddle}, capitals' middle ${capitalsMiddle}, capitals ${capitalsTop} to ${capitalsBaseline})`,
		badgeMiddle !== null &&
			capitalsMiddle !== null &&
			Math.abs(badgeMiddle - capitalsMiddle) <= 0.75,
		true
	)

	/**
	 * editmd underlines a link in the accent at 35% (`.markdown-body a`, style.css:170-176), the port at 60%, and while ⌘ is held the
	 * pointer turns to a hand over the link alone (`body.cmd-down .markdown-body a { cursor: pointer }`, style.css:178-181)
	 */
	documentController.load(
		'[a linked phrase](https://example.com/x) then plain words\n',
		parityOptions
	)
	settle()
	await settleAfter(250)
	const accentRun = bounds(find_test_id('block-0')?.children?.[0] ?? 0)
	const accentUnderline = accentRun
		? getLongestRunColour(captureWindow(), { ...accentRun, width: 80 }, [
				getPalette().background ?? ''
			])
		: null
	/** the Block's cursor with the pointer `dx` into its text, ⌘ held */
	const measureHandCursorAt = (dx: number) => {
		if (!accentRun) return null

		mouse_move({ x: accentRun.x + dx, y: accentRun.y + accentRun.height / 2 }, { modifiers: 'cmd' })
		settle()
		return find_test_id('block-0')?.style?.cursor
	}
	const handOverLink = measureHandCursorAt(20)
	const handOverPlain = measureHandCursorAt(170)
	// a move inside the page with no modifiers lets ⌘ go, so no later check paints in the held theme
	mouse_move({ x: 400, y: 400 })
	settle()
	check(
		`a link’s underline paints in the accent at 60%, and with ⌘ held the pointer is a hand over the link alone (underline ${accentUnderline}; over the link ${handOverLink}, over plain text ${handOverPlain})`,
		[
			isNear(
				accentUnderline ?? '',
				mixColour(getPalette().accent ?? '', getPalette().background ?? '', 0.6),
				6
			),
			handOverLink,
			handOverPlain
		],
		[true, 'pointer', 'text']
	)
}
