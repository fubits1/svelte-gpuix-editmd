/**
 * the headless UI suite's Find sections: the find bar, its field and chevrons, where Find looks and how it washes
 * the current match
 */
import './harness.ts'
import {
	captureWindow,
	clickIfPresent,
	filler,
	findQuery,
	getField,
	getInkColour,
	getPalette,
	getProp,
	isNear,
	isolated,
	loadFindState,
	sandboxOptions,
	settleAfter
} from './harness.ts'
import { check } from './check.ts'
import {
	bounds,
	click_test_id,
	find,
	find_test_id,
	press,
	pump,
	settle,
	type,
	wait
} from 'gpuix-svelte/test'
import { findController } from '../../src/app/find.svelte.ts'
import { themeController } from '../../src/app/theme.svelte.ts'
import type { Pixels } from '../../src/host/png.ts'
import { documentController } from '../../src/ui/DocumentView/controller.svelte.ts'

export async function testFindBar(): Promise<void> {
	press('escape')

	// Find, as editmd's FindBar: a bar above the document; the matches inside every Block's native <markdown> count
	documentController.load(
		`Be **bold**, be brave.\n\n${filler.join('\n\n')}\n\nLast one to be here.\n`,
		isolated
	)
	settle()
	press('cmd-f')
	settle()
	const findBarBox = bounds(find_test_id('find-bar') ?? 0)
	const firstBlockBox = bounds(find_test_id('block-0') ?? 0)
	check(
		'Cmd-F shows the find bar above the document, its field’s placeholder Find',
		[
			find_test_id('find-field')?.type,
			getProp('find-field', 'placeholder'),
			findBarBox !== null &&
				firstBlockBox !== null &&
				findBarBox.y + findBarBox.height <= firstBlockBox.y
		],
		['textarea', 'Find', true]
	)

	/**
	 * editmd's NSSearchField shows the focus ring while it has the keys (editmd's window draws it 3pt round the field, measured
	 * at 2x; EditorWindowController.swift:295-298 makes it first responder), and none once the page takes them
	 */
	// the bar reads the field's focus on a 100ms poll, so each look waits past one
	await wait(250)
	const getFindRing = () => {
		const style = find_test_id('find-field-box')?.style
		return [style?.outlineWidth ?? 0, style?.outlineColor ?? null]
	}
	const focusedFindRing = getFindRing()
	click_test_id('block-0')
	await wait(250)
	const blurredFindRing = getFindRing()
	press('escape')
	press('cmd-f')
	await settleAfter(100)
	check(
		'the focused find field shows AppKit’s 3px focus ring round its box, and none once a Block takes the keys',
		[focusedFindRing, blurredFindRing],
		[
			[3, themeController.focusRing ?? themeController.palette['focus-ring']],
			[0, null]
		]
	)

	type('b')
	type('e')
	check(
		'typing `be` finds its 3 matches across the Blocks, the first active',
		await loadFindState(),
		[3, 0, 0]
	)
	press('enter')
	check('Enter makes the second match active', await loadFindState(), [3, 1, 1])
	press('shift-enter')
	check('Shift-Enter makes the first match active again', await loadFindState(), [3, 0, 0])

	press('enter')
	press('enter')
	const lastMatchState = await loadFindState()
	const lastBlockBox = bounds(find_test_id('block-31') ?? 0)
	check(
		'the active match’s Block below the fold scrolls into view',
		[
			lastMatchState,
			lastBlockBox !== null && lastBlockBox.y >= 0 && lastBlockBox.y + lastBlockBox.height <= 538
		],
		[[3, 2, 2], true]
	)
	press('cmd-g')
	check('Cmd-G from the last match wraps to the first', await loadFindState(), [3, 0, 0])

	clickIfPresent('find-next')
	const afterNextChevron = await loadFindState()
	clickIfPresent('find-previous')
	check(
		'the chevrons step to the next and the previous match',
		[afterNextChevron, await loadFindState()],
		[
			[3, 1, 1],
			[3, 0, 0]
		]
	)

	/**
	 * Cmd-F again focuses the field it already shows, its query selected as editmd's `focus()` selects it
	 * (EditorWindowController.swift:295-298), so a key typed a moment later replaces the query
	 */
	press('cmd-f')
	await settleAfter(100)
	/**
	 * a field's selection is not the window's (`getSelectedText` reads painted text only, null here), so the paint tells
	 * it: the most frequent colour over the query's first 12px, past the field's background and text, is gpuix's own
	 * field selection wash (#3f436f, measured over a Block's field in `testSelectionColour` in view.ts)
	 */
	const queryBox = bounds(find_test_id('find-field') ?? 0)
	const queryInk = queryBox
		? getInkColour(captureWindow(), { ...queryBox, width: 12 }, [
				themeController.palette.background ?? '',
				themeController.palette.text ?? ''
			])
		: null
	type('x')
	check(
		`Cmd-F with a query selects it and paints the field’s selection wash over it, so the next key replaces it (ink ${queryInk})`,
		[isNear(queryInk ?? '', '#3f436f', 16), findController.query],
		[true, 'x']
	)
	type('q')
	await loadFindState()
	check(
		'a query with no match turns the field’s text AppKit’s systemRed, as editmd’s `setResult(found:)`',
		[findController.query, findController.total, getField(getProp('find-field', 'theme'), 'text')],
		['xq', 0, themeController.palette['system-red']]
	)

	press('escape')
	type('y')
	check(
		'Escape hides the bar and hands the keys back to the document',
		[find_test_id('find-bar'), findController.query],
		[null, 'xq']
	)

	press('cmd-f')
	type('backspace')
	type('backspace')
	type('backspace')
	const queryBeforeDone = findController.query
	const shownBeforeDone = find_test_id('find-bar') !== null
	clickIfPresent('find-done')
	check(
		'Done hides the bar',
		[queryBeforeDone, shownBeforeDone, find_test_id('find-bar') !== null],
		['', true, false]
	)
	press('cmd-g')
	check(
		'Cmd-G with an empty query shows the bar with its field',
		find_test_id('find-field')?.type,
		'textarea'
	)
	press('escape')

	/**
	 * editmd's field is an NSSearchField (EditorWindowController.swift:240): a magnifier inside it at its left, before
	 * the text, and a clear button while it holds text, which empties it
	 */
	press('cmd-f')
	const clearWhileEmpty = find_test_id('find-clear')
	type('b')
	await loadFindState()
	const searchFieldBox = bounds(find_test_id('find-field-box') ?? 0)
	const magnifierBox = bounds(find_test_id('find-magnifier') ?? 0)
	const searchTextBox = bounds(find_test_id('find-field') ?? 0)
	const clearWhileTyped = find_test_id('find-clear') !== null
	clickIfPresent('find-clear')
	await loadFindState()
	check(
		'the find field shows a magnifier inside its left edge before the text, and a clear button only while it holds text, which empties it',
		[
			clearWhileEmpty,
			searchFieldBox && magnifierBox && searchTextBox
				? // GPUI's `bounds` gives the bezel's x inside its border and padding, where the magnifier starts
					magnifierBox.x >= searchFieldBox.x &&
					magnifierBox.x + magnifierBox.width <= searchTextBox.x
				: null,
			clearWhileTyped,
			findController.query,
			getProp('find-field', 'value'),
			find_test_id('find-clear'),
			findController.total
		],
		[null, true, true, '', '', null, 0]
	)
	press('escape')

	/** a pixel's colour in a decoded screenshot, as `#rrggbb`, at logical point (`x`, `y`) */
	function getShotColourAt(shot: Pixels, scale: number, x: number, y: number): string {
		const at = (Math.round(y * scale) * shot.width + Math.round(x * scale)) * 4
		return `#${[shot.data[at]!, shot.data[at + 1]!, shot.data[at + 2]!].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
	}

	/**
	 * NSSearchField's clear button is `xmark.circle.fill`: a disc with the × cut out of it, so the × shows the field's
	 * own background, dark on a light disc in dark mode and the reverse in light. read off a real paint: the glyph's
	 * centre, where the ×'s strokes cross, is the field's background, and a point inside the disc away from the strokes
	 * is the disc's colour
	 */
	press('cmd-f')
	type('b')
	await loadFindState()
	const clearBox = bounds(find_test_id('find-clear') ?? 0)
	const { shot: clearShot, scale: clearScale } = captureWindow()
	const clearColours = clearBox
		? [
				getShotColourAt(
					clearShot,
					clearScale,
					clearBox.x + clearBox.width / 2,
					clearBox.y + clearBox.height / 2
				),
				getShotColourAt(
					clearShot,
					clearScale,
					clearBox.x + clearBox.width / 2,
					clearBox.y + clearBox.height * 0.2
				)
			]
		: []
	check(
		`the find field’s clear button paints its × in the field’s background, cut out of the disc (centre, disc: ${clearColours.join(', ')})`,
		[
			isNear(clearColours[0] ?? '', themeController.palette.background),
			isNear(clearColours[1] ?? '', themeController.palette.faint),
			!isNear(clearColours[0] ?? '', clearColours[1] ?? '', 40)
		],
		[true, true, true]
	)
	clickIfPresent('find-clear')
	press('escape')
}

export async function testWhereFindLooks(): Promise<void> {
	async function countMatches(query: string): Promise<number> {
		await findQuery(query)
		const total = findController.total
		press('escape')
		return total
	}
	/**
	 * where cmd-f finds text: inside Source mode's field, inside an open Block's field, inside
	 * the closed front matter box. editmd's WKWebView find searches the page's text, its textarea's included
	 */
	documentController.load('---\ntitle: zebra\n---\n\nquokka here\n', sandboxOptions)
	settle()
	const findInFrontmatter = await countMatches('zebra')
	click_test_id('block-1')
	settle()
	const findInOpenField = await countMatches('quokka')
	press('escape')
	press('cmd-/')
	/**
	 * Source mode's field takes the keys on a poll once it is painted (`#toggleSource`), which would take them from the
	 * find field mid-query, so ⌘F waits until it has them
	 */
	await wait(150)
	pump()
	const findInSource = await countMatches('quokka')
	press('cmd-/')
	settle()
	check(
		`⌘F’s matches inside the closed front matter box, an open Block’s field and Source mode’s field (${findInFrontmatter}, ${findInOpenField}, ${findInSource})`,
		[findInFrontmatter, findInOpenField, findInSource],
		[1, 0, 0]
	)
}

export async function testCurrentMatchOnly(): Promise<void> {
	// Find marks only the current match, in the strong mark colour, the others unwashed
	documentController.load('be one be two be\n', sandboxOptions)
	settle()
	press('cmd-f')
	type('cmd-a')
	type('b')
	type('e')
	await loadFindState()
	const findSpec = find((node) => getField(node.customProps?.highlight, 'query') === 'be')
		?.customProps?.highlight
	press('escape')
	settle()
	check(
		'Find washes only the current match, in the strong mark colour, and leaves the other matches unwashed',
		[getField(findSpec, 'color'), getField(findSpec, 'activeColor')],
		['transparent', getPalette().mark]
	)
}
