/**
 * the headless UI suite's checks of links: following them, the "Open this link?" dialog, Add Link and Edit Link,
 * a missing link target, #heading links, and the alerts' and titles' look
 */
import './harness.ts'
import {
	badgeDirectory,
	clickIfPresent,
	clickLinkIn,
	createPng,
	filler,
	getProp,
	getText,
	getWashPoint,
	initBadgeDirectory,
	initLinkRecorder,
	linkOptions,
	linkRuns,
	loadTipAfterHover,
	loadTipAt,
	menuOptions,
	menuRuns,
	menuWindows,
	sandboxDirectory,
	sandboxOptions,
	setApp,
	setMenuClipboardUrl,
	settleAfter,
	stopTheme,
	view,
	waitForFieldIdle
} from './harness.ts'
import { check } from './check.ts'
import {
	bounds,
	click_at,
	click_test_id,
	find_test_id,
	mount_headless,
	mouse_move,
	press,
	settle,
	type,
	unfocus,
	wait,
	wheel
} from 'gpuix-svelte/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import App from '../../App.svelte'
import { themeController } from '../../src/app/theme.svelte.ts'
import { documentController } from '../../src/ui/DocumentView/controller.svelte.ts'

export async function testFollowLinks(): Promise<void> {
	unfocus()
	press('escape')

	// links follow only on Cmd-click, as editmd's onClick (`if (!event.metaKey) return`); scrolling needs App's Scroller
	await view.unmount()
	stopTheme()
	setApp(mount_headless(App, { width: 800, height: 538 }))

	initLinkRecorder()
	documentController.load(
		`[jump](#later)\n\n[web](https://example.com)\n\n${filler.join('\n\n')}\n\n## Later\n`,
		linkOptions
	)
	settle()

	clickLinkIn('block-1', 'cmd')
	// `linkDestination` resolves every link to an absolute URL, which adds the root path's slash
	check('Cmd-clicking a web link opens it through `open`', linkRuns, [
		['open', ['https://example.com/']]
	])
	// closes the editor a Cmd-click that does not follow would open, so the next click finds its Block
	press('escape')

	linkRuns.length = 0
	clickLinkIn('block-1')
	check(
		'a plain click on a link opens its Block for editing and runs nothing',
		[documentController.activeIndex, find_test_id('block-editor')?.type, linkRuns],
		[1, 'textarea', []]
	)
	press('escape')

	// the heading starts below the fold, so only following the link can bring it into view
	const laterBefore = bounds(find_test_id('block-32') ?? 0)
	clickLinkIn('block-0', 'cmd')
	// the scroll is smooth, as editmd's `scrollIntoView({ behavior: "smooth" })`, done in about 300ms
	await settleAfter(400)
	const laterBounds = bounds(find_test_id('block-32') ?? 0)
	check(
		'Cmd-clicking a #fragment link scrolls its heading into view',
		[
			laterBefore !== null && laterBefore.y >= 538,
			laterBounds !== null && laterBounds.y >= 0 && laterBounds.y + laterBounds.height <= 538
		],
		[true, true]
	)
	check('following a link opens no editor', find_test_id('block-editor'), null)

	/**
	 * a footnote reference paints as superscript text with no link, as editmd's bare `sup`, and editmd's Cmd-click
	 * follows only an `a` (web/src/editor.ts:406-410): the click follows nothing and scrolls nothing, and like any
	 * Cmd-click on plain text it opens its Block, where editmd's caret lands
	 */
	documentController.load(
		`[^1] starts here.\n\n${filler.join('\n\n')}\n\n[^1]: The note.\n`,
		linkOptions
	)
	settle()
	// the column keeps the scroll the #fragment link left it at, so it goes back to the top first
	wheel({ x: 400, y: 200 }, 0, 10000)
	settle()
	const definitionBefore = bounds(find_test_id('footnote-31') ?? 0)
	linkRuns.length = 0
	clickLinkIn('block-0', 'cmd')
	const definitionAfter = bounds(find_test_id('footnote-31') ?? 0)
	check(
		'Cmd-clicking a footnote reference follows nothing, its definition staying below the fold, and opens its Block',
		[
			definitionBefore !== null && definitionBefore.y >= 538,
			definitionAfter !== null && definitionAfter.y >= 538,
			linkRuns,
			documentController.activeIndex
		],
		[true, true, [], 0]
	)
	press('escape')

	/**
	 * a link in the middle of a paragraph's text: <markdown> gives no run positions, so Cmd-clicks walk along the
	 * line in 4px steps until one follows a link, closing the editor each plain-text Cmd-click opens on the way
	 */
	linkRuns.length = 0
	documentController.load('Read the [manual](https://example.com/manual) first.\n', linkOptions)
	settle()
	const sentence = bounds(find_test_id('block-0') ?? 0)
	let linkOffset: number | null = null
	for (let x = 2; sentence && linkOffset === null && x < sentence.width; x += 4) {
		click_at(sentence.x + x, sentence.y + sentence.height / 2, { modifiers: 'cmd' })
		if (linkRuns.length > 0) {
			linkOffset = x
		} else {
			press('escape')
		}
	}
	// "Read the " paints well over 20px wide, so a link found nearer the start is not the one mid-sentence
	check(
		'Cmd-clicking a link in the middle of a paragraph opens it through `open`, the text before it following nothing',
		[linkRuns, linkOffset !== null && linkOffset > 20],
		[[['open', ['https://example.com/manual']]], true]
	)
	press('escape')

	linkRuns.length = 0
	documentController.load('[write](mailto:kira@example.com)\n', linkOptions)
	settle()
	clickLinkIn('block-0', 'cmd')
	check('Cmd-clicking a mail link opens it through `open`', linkRuns, [
		['open', ['mailto:kira@example.com']]
	])

	/**
	 * with no runner handed in, the window's own runner starts `open`: here a stand-in for it, first on PATH, that
	 * writes its arguments to a file. the click only happens once `which` resolves `open` to the stand-in, so the
	 * real `open` is never reached
	 */
	const openStandIn = mkdtempSync(join(tmpdir(), 'eg-open-'))
	const openArguments = join(openStandIn, 'arguments')
	writeFileSync(join(openStandIn, 'open'), `#!/bin/sh\nprintf '%s|' "$@" > '${openArguments}'\n`, {
		mode: 0o755
	})
	const pathBefore = process.env.PATH
	process.env.PATH = `${openStandIn}:${pathBefore ?? ''}`
	const resolvedOpen = execFileSync('/usr/bin/which', ['open'], { encoding: 'utf8' }).trim()
	if (resolvedOpen === join(openStandIn, 'open')) {
		documentController.load('[web](https://example.com/default)\n', {
			...linkOptions,
			run: undefined
		})
		settle()
		clickLinkIn('block-0', 'cmd')
		for (let poll = 0; poll < 40 && !existsSync(openArguments); poll++) await wait(50)
	}
	process.env.PATH = pathBefore
	check(
		'with no runner handed in, Cmd-clicking a web link starts `open` with the URL',
		[
			resolvedOpen === join(openStandIn, 'open'),
			existsSync(openArguments) && readFileSync(openArguments, 'utf8')
		],
		[true, 'https://example.com/default|']
	)
	rmSync(openStandIn, { recursive: true, force: true })

	// another scheme could start any app, so editmd asks first (LinkOpener.swift `confirm`)
	linkRuns.length = 0
	documentController.load('[x](ftp://example.com/x)\n', linkOptions)
	settle()
	clickLinkIn('block-0', 'cmd')
	// the dialog's title and message are its first two <text> elements, each string on its child text node
	check(
		'Cmd-clicking a link of another scheme asks first, showing the URL, and runs nothing',
		[
			find_test_id('confirm-link')
				?.children?.slice(0, 2)
				.map((element) => element.children?.[0]?.text),
			linkRuns
		],
		[['Open this link?', 'It opens in another app:\n\nftp://example.com/x'], []]
	)
	const shownBeforeCancel = find_test_id('confirm-link') !== null
	clickIfPresent('confirm-link-cancel')
	check(
		'Cancel closes the dialog and runs nothing',
		[shownBeforeCancel, find_test_id('confirm-link'), linkRuns],
		[true, null, []]
	)

	clickLinkIn('block-0', 'cmd')
	const shownBeforeOpen = find_test_id('confirm-link') !== null
	clickIfPresent('confirm-link-open')
	check(
		'Open runs `open` with the URL and closes the dialog',
		[shownBeforeOpen, linkRuns, find_test_id('confirm-link')],
		[true, [['open', ['ftp://example.com/x']]], null]
	)

	linkRuns.length = 0
	clickLinkIn('block-0', 'cmd')
	const shownBeforeEscape = find_test_id('confirm-link') !== null
	press('escape')
	check(
		'Escape cancels the dialog',
		[shownBeforeEscape, find_test_id('confirm-link'), linkRuns],
		[true, null, []]
	)

	/**
	 * a scheme editmd's page strips (Milkdown's `sanitizeLinkHref` keeps none but http, https, mailto, tel and ftp)
	 * leaves the link with an empty href there, so a ⌘-click on it does nothing: no dialog, nothing run, no Block opened
	 */
	linkRuns.length = 0
	documentController.load('[x](obsidian://open?vault=a)\n', linkOptions)
	settle()
	clickLinkIn('block-0', 'cmd')
	check(
		'Cmd-clicking a link editmd’s page strips, `obsidian://open?vault=a`, does nothing: no dialog, nothing run, no Block opened',
		[find_test_id('confirm-link'), linkRuns, documentController.activeIndex],
		[null, [], null]
	)
	press('escape')

	/**
	 * a relative link in an untitled Document names nothing: editmd resolves it against its own page (main.ts:44),
	 * its LinkPolicy ignores it (LinkPolicy.swift:17-18) and its LinkOpener beeps (LinkOpener.swift:19-20)
	 */
	linkRuns.length = 0
	documentController.load('[x](notes.md)\n', linkOptions)
	settle()
	clickLinkIn('block-0', 'cmd')
	check(
		'Cmd-clicking a relative link in an untitled Document beeps through `osascript` and opens nothing',
		[linkRuns, find_test_id('confirm-link'), documentController.activeIndex],
		[[['osascript', ['-e', 'beep']]], null, null]
	)
	press('escape')

	// the same link in a Document with a folder opens the file it names
	const relativeDirectory = mkdtempSync(join(tmpdir(), 'eg-relative-'))
	const relativePath = join(relativeDirectory, 'links.md')
	writeFileSync(relativePath, '[x](notes.md)\n')
	writeFileSync(join(relativeDirectory, 'notes.md'), '# Notes\n')
	linkRuns.length = 0
	documentController.open(relativePath, {
		...linkOptions,
		socketsDirectory: join(relativeDirectory, 's'),
		describeFile: () => ({ isDirectory: false, isText: true })
	})
	settle()
	clickLinkIn('block-0', 'cmd')
	check(
		'Cmd-clicking a relative link in a Document with a folder opens the file it names, with no beep',
		linkRuns,
		[['openInEditor', [join(relativeDirectory, 'notes.md')]]]
	)
	press('escape')
	rmSync(relativeDirectory, { recursive: true, force: true })

	// a linked image, as a README badge (parity row r-image-linked): it paints as an image, and Cmd-click follows its link
	initBadgeDirectory()
	writeFileSync(join(badgeDirectory, 'badge.png'), createPng(90, 20))
	const badgePath = join(badgeDirectory, 'r-image-linked.md')
	writeFileSync(badgePath, '[![badge](badge.png)](https://example.com/ci) after a badge.\n')
	linkRuns.length = 0
	documentController.open(badgePath, {
		...linkOptions,
		socketsDirectory: join(badgeDirectory, 's')
	})
	settle()
	check(
		'a linked image paints as an image with its own src, not as its link text',
		[find_test_id('image-0-0')?.type, getProp('image-0-0', 'src')],
		['img', join(badgeDirectory, 'badge.png')]
	)
	const badgeBounds = bounds(find_test_id('image-0-0') ?? 0)
	if (badgeBounds) {
		click_at(badgeBounds.x + badgeBounds.width / 2, badgeBounds.y + badgeBounds.height / 2, {
			modifiers: 'cmd'
		})
	}
	check(
		'Cmd-clicking a linked image opens its link through `open` and opens no editor',
		[linkRuns, find_test_id('block-editor')],
		[[['open', ['https://example.com/ci']]], null]
	)
	press('escape')
	linkRuns.length = 0
	if (badgeBounds) {
		click_at(badgeBounds.x + badgeBounds.width / 2, badgeBounds.y + badgeBounds.height / 2)
	}
	check(
		'a plain click on a linked image opens its paragraph for editing and runs nothing',
		[documentController.activeIndex, find_test_id('block-editor')?.type, linkRuns],
		[0, 'textarea', []]
	)
}

export async function testLinkDialog(): Promise<void> {
	// the link dialog is modal like editmd's NSAlert: Return presses Open, its default button, and the Document takes no clicks
	linkRuns.length = 0
	documentController.load('[x](ftp://example.com/x)\n', linkOptions)
	settle()
	clickLinkIn('block-0', 'cmd')
	const shownBeforeReturn = find_test_id('confirm-link') !== null
	press('enter')
	check(
		'Return presses Open: it runs `open` with the URL and closes the dialog',
		[shownBeforeReturn, linkRuns, find_test_id('confirm-link')],
		[true, [['open', ['ftp://example.com/x']]], null]
	)

	linkRuns.length = 0
	clickLinkIn('block-0', 'cmd')
	const shownBeforeClick = find_test_id('confirm-link') !== null
	click_test_id('block-0')
	check(
		'while the dialog is open a click on the Document opens no editor and keeps the dialog',
		[
			shownBeforeClick,
			find_test_id('block-editor'),
			find_test_id('confirm-link') !== null,
			linkRuns
		],
		[true, null, true, []]
	)
	press('escape')
}

export async function testAddLink(): Promise<void> {
	press('escape')
	settle()

	/**
	 * Format > Link… (⌘K) is editmd's Add Link sheet (EditorWindowController.swift:115-150): an NSAlert titled Add Link
	 * with "Enter the URL for the selected text.", a field with the https:// placeholder prefilled with the pasteboard's
	 * URL, and Add (the default) then Cancel, which paint right to left
	 */
	documentController.load('See\n', menuOptions)
	settle()
	click_test_id('block-0')
	type('s')
	setMenuClipboardUrl('https://example.com/a')
	press('cmd-k')
	settle()
	const addLinkShown = [
		getText('add-link-title'),
		getText('add-link-message'),
		getProp('add-link-url', 'placeholder'),
		getProp('add-link-url', 'value'),
		getText('add-link-cancel-label'),
		getText('add-link-add-label')
	]
	press('enter')
	// the field's caret is read when Add is pressed, here at the end of the typed `s`
	await waitForFieldIdle()
	const addedLinkText = documentController.text
	const addedLinkField = getProp('block-editor', 'value')
	press('escape')
	press('cmd-z')
	check(
		'Cmd-K shows Add Link prefilled from the pasteboard, and Return adds the URL as a link at the field’s caret, an Undo step of its own that one Undo takes back, the typing before it kept',
		[
			addLinkShown,
			addedLinkText,
			addedLinkField,
			find_test_id('add-link'),
			documentController.text
		],
		[
			[
				'Add Link',
				'Enter the URL for the selected text.',
				'https://',
				'https://example.com/a',
				'Cancel',
				'Add'
			],
			'Sees<https://example.com/a>\n',
			'Sees<https://example.com/a>',
			null,
			'Sees\n'
		]
	)

	// Escape is Cancel; an empty pasteboard leaves the field empty; Source mode disables Link… with the rest of Format
	click_test_id('block-0')
	setMenuClipboardUrl(null)
	press('cmd-k')
	settle()
	const emptyPrefill = getProp('add-link-url', 'value')
	press('escape')
	settle()
	const afterCancel = [find_test_id('add-link'), documentController.text]
	press('escape')
	documentController.run('toggleSource')
	settle()
	press('cmd-k')
	settle()
	const sheetInSource = find_test_id('add-link')
	documentController.run('toggleSource')
	settle()
	check(
		'Escape cancels Add Link and changes nothing, an empty pasteboard prefills nothing, and Cmd-K in Source mode opens no sheet',
		[emptyPrefill, afterCancel, sheetInSource],
		['', [null, 'Sees\n'], null]
	)

	/**
	 * editmd's caret sits at the Document's start once it loads, so Link… with no Active block puts the link at the start
	 * of the first Block's text (`firstTextOffset`), and the field opens on it
	 */
	documentController.load('First\n\nSecond\n', menuOptions)
	settle()
	setMenuClipboardUrl('https://example.com/b')
	press('cmd-k')
	settle()
	press('enter')
	settle()
	check(
		'Link… with no Active block adds the link at the start of the first Block’s text, whose field opens on it',
		[documentController.text, documentController.activeIndex, getProp('block-editor', 'value')],
		['<https://example.com/b>First\n\nSecond\n', 0, '<https://example.com/b>First']
	)
	press('escape')
}

export async function testMissingLinkTarget(): Promise<void> {
	/**
	 * ⌘-click on a link to a text file that cannot be opened alerts here and starts no window, as editmd's
	 * LinkOpener only alerts (LinkOpener.swift:11-14)
	 */
	const missingLinkPath = join(sandboxDirectory, 'missing-link.md')
	writeFileSync(missingLinkPath, '[gone](gone.md) is not there.\n')
	menuRuns.length = 0
	menuWindows.length = 0
	// the default opener, editmd's LinkOpener, which reads the file first; a window it starts would reach `menuWindows`
	documentController.open(missingLinkPath, { ...sandboxOptions, openInEditor: undefined })
	settle()
	clickLinkIn('block-0', 'cmd')
	settle()
	const missingLinkOverlay = documentController.overlay?.kind ?? null
	press('escape')
	settle()
	check(
		'⌘-click on a link to a missing .md shows the open-failure alert and starts no window',
		[missingLinkOverlay, menuWindows],
		['openFailed', []]
	)
}

export async function testHeadingLinksDialogsTips(): Promise<void> {
	/**
	 * a `#heading` link to one of the last headings scrolls it to the window's top, as editmd's
	 * scrollIntoView puts it, past where the page's own end would stop the scroll
	 */
	documentController.load(
		`[Jump to the end](#the-end)\n\n${Array.from({ length: 30 }, (_paragraph, n) => `Paragraph ${n + 1} of filler text.`).join('\n\n')}\n\n# The end\n\nLast words.\n`,
		sandboxOptions
	)
	settle()
	await wait(100)
	clickLinkIn('block-0', 'cmd')
	// the smooth scroll, the room it lacked and the scroll again each paint in frames of their own: waited out until the
	// heading stays put for five frames in a row, six seconds at most
	let endHeading = bounds(find_test_id('block-31') ?? 0)
	for (let frame = 0, still = 0; still < 5 && frame < 150; frame++) {
		await wait(40)
		const now = bounds(find_test_id('block-31') ?? 0)
		still = now?.y === endHeading?.y ? still + 1 : 0
		endHeading = now
	}
	const barBottom = (() => {
		const bar = bounds(find_test_id('menu-bar') ?? 0)
		return bar ? bar.y + bar.height : 0
	})()
	check(
		`a link to the last heading scrolls it to the window’s top (heading at ${endHeading?.y}, page top ${barBottom})`,
		endHeading ? Math.abs(endHeading.y - barBottom) <= 1 : null,
		true
	)
	documentController.load('', sandboxOptions)
	settle()

	/**
	 * a `#heading` link to a heading inside a quote scrolls that heading's own row to the window's top, as editmd's
	 * `scrollIntoView` takes the heading itself (main.ts:39-41), and smoothly (`behavior: "smooth"`): one frame after the
	 * click the heading is on its way, below where it ends
	 */
	const quotedLines = Array.from({ length: 40 }, (_line, n) => `> Quoted line ${n + 1}.`).join(
		'\n>\n'
	)
	documentController.load(
		`[deep](#deep-heading)\n\n${quotedLines}\n>\n> ## Deep heading\n>\n> Under it.\n\n${filler.join('\n\n')}\n`,
		sandboxOptions
	)
	settle()
	await settleAfter(100)
	const getDeepTop = () => bounds(find_test_id('markdown-1.40') ?? 0)?.y ?? Number.NaN
	const deepBefore = getDeepTop()
	clickLinkIn('block-0', 'cmd')
	await settleAfter(30)
	const deepOneFrame = getDeepTop()
	for (let frame = 0; frame < 15; frame++) await settleAfter(40)
	const deepAfter = getDeepTop()
	check(
		`⌘-clicking a #heading link to a heading deep in a quote scrolls the heading’s own row to the window’s top, smoothly (before ${deepBefore}, one frame in ${deepOneFrame}, after ${deepAfter}, page top ${barBottom})`,
		[
			Math.abs(deepAfter - barBottom) <= 1,
			deepBefore > deepOneFrame && deepOneFrame > deepAfter + 1
		],
		[true, true]
	)
	press('escape')

	/**
	 * Add Link with the caret inside a reference link (e-link-dialog): the definition elsewhere in the Document makes
	 * `[docs][d]` a link, so the link takes the new URL, written inline, as editmd's Edit Link does (editor.ts:387-392)
	 */
	documentController.load('see [docs][d] here\n\n[d]: https://ref.example\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	type('cmd-left right right right right right right')
	setMenuClipboardUrl('https://a.example')
	press('cmd-k')
	settle()
	press('enter')
	await waitForFieldIdle()
	press('escape')
	setMenuClipboardUrl(null)
	check(
		'Add Link with the caret inside a reference link gives the link the new URL, written inline, its definition kept',
		documentController.text,
		'see [docs](https://a.example) here\n\n[d]: https://ref.example\n'
	)

	/**
	 * with no field open and editmd's load caret in a link, ⌘K is editmd's Edit Link (EditorWindowController.swift:117-128):
	 * titled Edit Link, its field holding the link's URL rather than the pasteboard's, Update in place of Add, and Remove
	 * Link, which takes the link off its text
	 */
	documentController.load('[docs](https://a.example) x\n', sandboxOptions)
	settle()
	setMenuClipboardUrl('https://clip.example')
	press('cmd-k')
	settle()
	const editLinkShown = [
		getText('add-link-title'),
		getProp('add-link-url', 'value'),
		getText('add-link-add-label'),
		getText('add-link-remove-label')
	]
	clickIfPresent('add-link-remove')
	await waitForFieldIdle()
	press('escape')
	setMenuClipboardUrl(null)
	check(
		'with no field open and the load caret in a link, ⌘K shows Edit Link with the link’s URL, Update and Remove Link, and Remove Link takes the link off',
		[editLinkShown, documentController.text],
		[['Edit Link', 'https://a.example', 'Update', 'Remove Link'], 'docs x\n']
	)

	/** an alert's width, radius and surface, the dim behind it, whether it has an icon, and its default button's fill and ring */
	function getAlertLook(testId: string, defaultId: string) {
		const style = find_test_id(testId)?.style
		const defaultButtonStyle = find_test_id(defaultId)?.style
		return [
			bounds(find_test_id(testId) ?? 0)?.width,
			style?.borderTopLeftRadius ?? style?.borderRadius,
			style?.backgroundColor,
			find_test_id(`${testId}-backdrop`)?.style?.backgroundColor,
			find_test_id(`${testId}-icon`) !== null,
			defaultButtonStyle?.backgroundColor,
			defaultButtonStyle?.outlineWidth ?? 0
		]
	}
	const focusRingColour = themeController.focusRing ?? themeController.palette['focus-ring']
	/** what `getAlertLook` reads of an alert `width` wide with no icon, its default button in the accent with no ring */
	const getExpectedAlertLook = (width: number) => [
		width,
		26,
		themeController.palette['alert-surface'],
		themeController.palette['alert-dim'],
		false,
		themeController.palette.accent,
		0
	]

	/**
	 * Add Link is editmd's own NSAlert with an accessory field (measured in editmd's window at 2x): the alert's radius and
	 * surface over the dimmed page, no icon, Add filled in the accent with no ring, the box 350pt wide round its 320pt
	 * field, which holds AppKit's 3pt focus ring while it has the keys
	 */
	documentController.load('See\n', sandboxOptions)
	settle()
	press('cmd-k')
	// the field's ring follows its focus, read on a 100ms poll
	await settleAfter(250)
	const addLinkLook = getAlertLook('add-link', 'add-link-add')
	const urlField = find_test_id('add-link-url')?.style
	const urlRing = [urlField?.outlineWidth, urlField?.outlineColor]
	press('escape')
	settle()
	check(
		'Add Link is the alert over the dimmed page, 350px round its field, no icon, Add filled in the accent with no ring, and the URL field ringed while it has the keys',
		[addLinkLook, urlRing],
		[getExpectedAlertLook(350), [3, focusRingColour]]
	)

	/**
	 * "Open this link?" is editmd's own NSAlert (LinkOpener.swift:25-30): the alert's box over the
	 * dimmed page, no icon, Open filled in the accent with no ring and Cancel, the key view, ringed; Return is Open
	 */
	documentController.load('[x](ftp://example.com/x)\n', sandboxOptions)
	settle()
	menuRuns.length = 0
	clickLinkIn('block-0', 'cmd')
	settle()
	const questionLook = getAlertLook('confirm-link', 'confirm-link-open')
	const questionCancel = find_test_id('confirm-link-cancel')?.style
	const cancelRing = [questionCancel?.outlineWidth, questionCancel?.outlineColor]
	press('enter')
	settle()
	check(
		'“Open this link?” is the alert over the dimmed page, no icon, Open filled in the accent with no ring, Cancel ringed, and Return opens the link',
		[
			questionLook,
			cancelRing,
			menuRuns.filter(([command]) => command === 'open'),
			find_test_id('confirm-link')
		],
		[getExpectedAlertLook(260), [3, focusRingColour], [['open', ['ftp://example.com/x']]], null]
	)

	/**
	 * a link's title and an image's are native tips at the pointer, as editmd's page titles its `a` (links.ts:174) and
	 * `img` (remote.ts:77-78): over the titled link only, and over a titled image, in a paragraph of images or one mixing
	 * text and images
	 */
	writeFileSync(join(sandboxDirectory, 'titled.png'), createPng(120, 60))
	const titlesPath = join(sandboxDirectory, 'titles.md')
	writeFileSync(
		titlesPath,
		'See [docs](https://a.example "Docs title") and more words here.\n\n![pic](titled.png "Pic title")\n\nText ![pic](titled.png "Mixed title") after.\n'
	)
	documentController.open(titlesPath, sandboxOptions)
	settle()
	await settleAfter(300)
	const titledLinkPoint = getWashPoint('block-0')
	const linkTitleTip = await loadTipAt(titledLinkPoint ?? { x: -1, y: -1 }, 'block-tooltip-0-tip')
	const offLinkTip = await loadTipAt(
		titledLinkPoint ? { x: titledLinkPoint.x + 120, y: titledLinkPoint.y } : { x: -1, y: -1 },
		'block-tooltip-0-tip'
	)
	const imageTitleTip = await loadTipAfterHover('image-1-0', 'image-tooltip-1-0-tip')
	const mixedTitleTip = await loadTipAfterHover('image-2-0', 'image-tooltip-2-0-tip')
	mouse_move({ x: 5, y: 500 })
	check(
		'hovering a titled link shows its title and none off the link, and a titled image shows its title, alone or among text',
		[linkTitleTip, offLinkTip, imageTitleTip, mixedTitleTip],
		['Docs title', null, 'Pic title', 'Mixed title']
	)
}
