/**
 * the editing area of the headless UI suite: typing and keys in a Block's field, Format commands, Source mode, field
 * probes, undo and redo, selection, copy and paste, and another program writing the open Block
 */
import './harness.ts'
import {
	captureWindow,
	clickIfPresent,
	clickRow,
	fileImageDirectory,
	findFirstRowNear,
	getDevicePixel,
	getDiagramSrc,
	getInkColour,
	getPalette,
	getProp,
	initRemote,
	initRemoteServer,
	initSandboxFolder,
	initView,
	isNear,
	isolated,
	loadNumberedLinesInSource,
	menuOptions,
	menuRuns,
	openFixture,
	openMenu,
	remoteServer,
	runDirectory,
	sandboxDirectory,
	sandboxOptions,
	setMenuClipboardUrl,
	settleAfter,
	snapToWanted,
	waitForFieldIdle,
	waitUntil
} from './harness.ts'
import { check } from './check.ts'
import {
	bounds,
	click_at,
	click_test_id,
	drag_select,
	drain,
	find_test_id,
	focus,
	painted,
	press,
	pump,
	settle,
	type,
	wait,
	wheel
} from 'gpuix-svelte/test'
import { get_native, window_size } from 'gpuix-svelte'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sendKeystrokes } from '../../src/app/fieldKeys.ts'
import { findController } from '../../src/app/find.svelte.ts'
import { themeController } from '../../src/app/theme.svelte.ts'
import { TABLE } from '../../src/core/blockCommands.ts'
import { documentController } from '../../src/ui/DocumentView/controller.svelte.ts'
import type { Range } from '../../src/core/fieldSelection.ts'

/** what `readSelection` learns of the open field, once its probe is done */
async function loadProbedRange(): Promise<Range | null | undefined> {
	let range: Range | null | undefined
	void documentController.readSelection().then((found) => (range = found))
	await waitUntil(() => range !== undefined, 'the selection probe')
	pump()
	return range
}

export async function testTypingAndKeys(): Promise<void> {
	// every remote image's host: a loopback server that answers each request 404 with an empty body
	initRemoteServer()
	await new Promise<void>((resolve) => remoteServer.listen(0, '127.0.0.1', resolve))
	initRemote()

	documentController.load('# Title\n\nBody text with **bold**.\n', isolated)
	// App starts the theme for a window; mounted alone, the view needs the same tokens set before its first paint
	initView()

	const text = painted()
	check('each block is painted', text.includes('Title') && text.includes('Body text with bold.'))

	// GPUI elements have no accessible roles to query by, so blocks and the editor carry test ids
	click_test_id('block-1')
	check(
		'clicking a block opens its source in a text field',
		[find_test_id('block-editor')?.type, getProp('block-editor', 'value')],
		['textarea', 'Body text with **bold**.']
	)

	// `type` takes keystroke notation: one key per call keeps the text literal
	type('a')
	check(
		'typing goes into the document',
		documentController.text,
		'# Title\n\nBody text with **bold**.a\n'
	)

	press('escape')
	check('escape closes the field', find_test_id('block-editor'), null)
	check('the block paints its new text', painted().includes('Body text with bold.a'))

	click_test_id('block-0')
	check('clicking another block opens that one', documentController.activeIndex, 0)
	press('escape')

	// markdown typed into a field is markdown: the Document keeps the syntax, the Block paints it rendered
	click_test_id('block-1')
	for (const key of ['space', '*', '*', 'b', '*', '*']) type(key)
	press('escape')
	check(
		'typing `**b**` at the end of a paragraph’s field puts it in the Document, and the Block paints `b` without asterisks',
		[
			documentController.text,
			painted()
				.split('\n')
				.filter((line) => line.startsWith('Body'))
		],
		['# Title\n\nBody text with **bold**.a **b**\n', ['Body text with bold.a b']]
	)

	// block syntax too: `## ` typed at the start of the paragraph's field turns its Block into a heading
	click_test_id('block-1')
	press('cmd-left')
	for (const key of ['#', '#', 'space']) type(key)
	press('escape')
	check(
		'typing `##` and a space at the start of a paragraph’s field makes its Block a level-2 heading, painted without the hashes',
		[
			documentController.text,
			documentController.blocks[1]?.kind,
			painted()
				.split('\n')
				.filter((line) => line.includes('Body'))
		],
		['# Title\n\n## Body text with **bold**.a **b**\n', 'heading', ['Body text with bold.a b']]
	)

	/**
	 * editmd's input rules (e-input-rules) as plain markdown typed at the start of a paragraph's field: `- ` makes a list,
	 * `> ` a quote and a ``` fence a code block, each painted rendered once the field closes
	 */
	const shortcutCases: [string[], string, string, string][] = [
		[['-', 'space'], '- Typed words\n', 'list', 'Typed words'],
		[['>', 'space'], '> Typed words\n', 'blockquote', 'Typed words'],
		[['`', '`', '`', 'enter'], '```\nTyped words\n', 'code', 'Typed words']
	]
	const shortcutResults = shortcutCases.map(([keys]) => {
		documentController.load('Typed words\n', isolated)
		settle()
		click_test_id('block-0')
		press('cmd-left')
		for (const key of keys) type(key)
		press('escape')
		settle()
		const lines = painted().split('\n')
		return [
			documentController.text,
			documentController.blocks[0]?.kind,
			lines.find((line) => line.includes('Typed words')),
			lines.some((line) => /^(- |> |```)/.test(line))
		]
	})
	check(
		'typing `- `, `> ` or a ``` fence at the start of a paragraph’s field makes a list, a quote or a code block, painted without the syntax',
		shortcutResults,
		shortcutCases.map(([, text, kind, line]) => [text, kind, line, false])
	)

	/**
	 * editmd's input rules turn the Block into a heading, a list or a code block the moment `# `, `- ` or a fence and a
	 * space is typed at its start, so the open field takes that look at once: `keys` typed into an empty Document's
	 * field, then its look while it is still open: the kind it shows, the text, an open field, a heading's size (h1 32px),
	 * the h1's rule box and the code card
	 */
	function getLookAfterTyping(keys: string[]) {
		documentController.load('', isolated)
		settle()
		for (const key of keys) type(key)
		settle()
		const fontSize = find_test_id('block-editor')?.style?.fontSize
		const look = [
			documentController.activeKind,
			documentController.text,
			find_test_id('block-editor') !== null,
			typeof fontSize === 'number' && fontSize > 16,
			find_test_id('block-editor-rule') !== null,
			find_test_id('block-editor-card') !== null
		]
		press('escape')
		return look
	}
	check(
		'typing `# Title`, `- a` or ``` and a space into an empty field shows it at once as a heading at h1 size over its rule, a list, or a code card, the field still open',
		[
			getLookAfterTyping(['#', 'space', 'T', 'i', 't', 'l', 'e']),
			getLookAfterTyping(['-', 'space', 'a']),
			getLookAfterTyping(['`', '`', '`', 'space'])
		],
		// editmd's serializer ends every document with a newline
		[
			['heading', '# Title\n', true, true, true, false],
			['list', '- a\n', true, false, false, false],
			['code', '``` \n', true, false, false, true]
		]
	)
	documentController.load('', isolated)
	settle()
	for (const key of ['#', 'space', 'T']) type(key)
	settle()
	const headingFieldWeight = find_test_id('block-editor')?.style?.fontWeight
	press('escape')
	check(
		'an open heading’s field has editmd’s heading weight, `font-weight: 650`',
		headingFieldWeight,
		650
	)

	/**
	 * a list, a quote or a rule typed into an empty field takes its kind's look at once too: `keys` typed, then whether the
	 * open field sits in the box `box` and whether its left edge is where the closed Block's text `closed` starts once
	 * Escape closes it (the list's item indent, the quote's rail and padding, the rule's column)
	 */
	function getBoxAfterTyping(keys: string[], box: string, closed: string): [boolean, boolean] {
		documentController.load('', isolated)
		settle()
		for (const key of keys) type(key)
		settle()
		const boxed = find_test_id(box) !== null
		const open = bounds(find_test_id('block-editor') ?? 0)?.x
		press('escape')
		settle()
		return [boxed, open !== undefined && open === bounds(find_test_id(closed) ?? 0)?.x]
	}
	check(
		'typing `- a`, `> a` or `---` into an empty field shows it at once at the list’s indent, inside the quote’s rail, or above the rule’s line, the field still open',
		[
			getBoxAfterTyping(['-', 'space', 'a'], 'block-editor-list', 'list-text-2'),
			getBoxAfterTyping(['>', 'space', 'a'], 'block-editor-quote', 'markdown-0.0'),
			getBoxAfterTyping(['-', '-', '-'], 'block-editor-hr', 'markdown-0')
		],
		[
			[true, true],
			[true, true],
			[true, true]
		]
	)

	/**
	 * the look follows the text back: with `# ` deleted the field's text is a paragraph again, as editmd's heading turns
	 * back into one, so the open field drops the heading's look, still open with its caret where the keys left it
	 */
	documentController.load('', isolated)
	settle()
	for (const key of ['#', 'space', 'T', 'i', 't', 'l', 'e']) type(key)
	settle()
	// the caret goes back over `Title` to just after `# `
	for (const key of ['left', 'left', 'left', 'left', 'left', 'backspace']) type(key)
	settle()
	// a field mounted afresh gets its caret back from the keys `#putCaret` sends once it has keyboard focus, after this turn of the loop
	await settleAfter(100)
	type('backspace')
	settle()
	const lostHeadingFontSize = find_test_id('block-editor')?.style?.fontSize
	check(
		'deleting the `# ` typed into an empty field shows the paragraph look again, the field still open on `Title`',
		[
			documentController.activeKind,
			documentController.text,
			find_test_id('block-editor') !== null,
			typeof lostHeadingFontSize === 'number' && lostHeadingFontSize > 16,
			find_test_id('block-editor-rule') !== null
		],
		['paragraph', 'Title\n', true, false, false]
	)
	press('escape')

	/**
	 * Return in a Block's field as editmd's Enter (`returnEdit`): `source` loads, Block 0 opens, `keys` are typed at the
	 * field's end, and Escape closes the field; the Document's text and its Blocks' kinds afterwards
	 */
	function typeReturns(source: string, keys: string[]): [string, string[]] {
		documentController.load(source, isolated)
		settle()
		click_test_id('block-0')
		return typeReturnsInto(keys)
	}

	/** `keys` typed into the open field, then Escape: the Document's text and its Blocks' kinds afterwards */
	function typeReturnsInto(keys: string[]): [string, string[]] {
		for (const key of keys) type(key)
		press('escape')
		settle()
		return [documentController.text, documentController.blocks.map((block) => block.kind)]
	}

	check(
		'Return at a heading’s end opens a new paragraph below it, as editmd’s Enter does',
		typeReturns('# Title\n', ['enter', 'b', 'o', 'd', 'y']),
		['# Title\n\nbody\n', ['heading', 'paragraph']]
	)
	check(
		'Return at a paragraph’s end opens a new paragraph below it',
		typeReturns('one\n', ['enter', 't', 'w', 'o']),
		['one\n\ntwo\n', ['paragraph', 'paragraph']]
	)
	check(
		'Return at a list item’s end adds an item to the same list',
		typeReturns('- one\n', ['enter', 't', 'w', 'o']),
		['- one\n- two\n', ['list']]
	)
	documentController.load('- one\n', isolated)
	settle()
	click_test_id('block-0')
	type('enter')
	type('enter')
	const leftListField = getProp('block-editor', 'value')
	check(
		'Return on an empty list item ends the list: an empty field opens after it, and what is typed there is a paragraph',
		[leftListField, ...typeReturnsInto(['a', 'f', 't', 'e', 'r'])],
		['', '- one\n\nafter\n', ['list', 'paragraph']]
	)
	check(
		'Return inside a code block keeps its newline in the code',
		typeReturns('```\na\n```\n', ['enter', 'b']),
		['```\na\nb\n```\n', ['code']]
	)
	check(
		'Shift-Return in a paragraph is a hard break, a backslash before the line break',
		typeReturns('one\n', ['shift-enter', 't', 'w', 'o']),
		['one\\\ntwo\n', ['paragraph']]
	)
	documentController.load('one\n\ntwo\n', isolated)
	settle()
	click_test_id('block-0')
	type('enter')
	const betweenField = [
		find_test_id('block-editor') !== null,
		find_test_id('block-0') !== null && find_test_id('block-1') !== null,
		painted().includes('one') && painted().includes('two')
	]
	check(
		'Return at the end of a paragraph with another after it opens the new field between the two, both still painted',
		[betweenField, ...typeReturnsInto(['x'])],
		[[true, true, true], 'one\n\nx\n\ntwo\n', ['paragraph', 'paragraph', 'paragraph']]
	)
	check(
		'Return at a heading’s end, then Escape with nothing typed, leaves the Document as it was',
		typeReturns('# Title\n', ['enter']),
		['# Title\n', ['heading']]
	)

	/**
	 * Return in the middle of a Block is one Undo step, as editmd's splitBlock is one transaction (Yjs captureTimeout
	 * 500ms): typed into an empty Document's field 600ms after ` two`, the split is a step of its own, so one ⌘Z takes it
	 * back whole and leaves one Block holding `one two`
	 */
	documentController.load('', isolated)
	settle()
	for (const key of ['o', 'n', 'e', 'space', 't', 'w', 'o']) type(key)
	await wait(600)
	for (const key of ['left', 'left', 'left', 'left', 'enter']) type(key)
	settle()
	const blocksAfterSplit = documentController.blocks.length
	press('escape')
	settle()
	press('cmd-z')
	settle()
	check(
		'Return between `one` and ` two` 600ms after typing ` two` splits the Block, and one ⌘Z takes the split back whole',
		[blocksAfterSplit, documentController.text, documentController.blocks.length],
		[2, 'one two\n', 1]
	)

	/**
	 * `keys` typed into Block 0's field of `source` (an empty Document's own field for ''), from its end, then Escape: the
	 * Document's text, its Blocks' kinds, and whether a field is left open. one key per call when `batch` is false, as a
	 * person types slowly; else every key in one call, which the field takes whole before the controller hears any of it,
	 * as fast typing does in a window, so Return's newline (`pressReturn`) lands after the keys typed behind it
	 */
	async function typeKeys(
		source: string,
		keys: string[],
		batch: boolean
	): Promise<[string, string[], boolean]> {
		documentController.load(source, isolated)
		settle()
		if (source !== '') click_test_id('block-0')

		for (const each of batch ? [keys.join(' ')] : keys) {
			type(each)
			// for `#putCaret` in src/ui/DocumentView/controller.svelte.ts to put the caret back
			await wait(40)
		}
		press('escape')
		settle()
		return [
			documentController.text,
			documentController.blocks.map((block) => block.kind),
			find_test_id('block-editor') !== null
		]
	}

	/** editmd's Enter and Backspace (measured in editmd's own editor): what each key sequence leaves, typed both ways */
	const keyCases: [string, string, string[], [string, string[], boolean]][] = [
		[
			'Return at a paragraph’s end, then `next`, makes a new paragraph holding `next`',
			'Hello world\n',
			['enter', 'n', 'e', 'x', 't'],
			['Hello world\n\nnext\n', ['paragraph', 'paragraph'], false]
		],
		[
			'Return at a heading’s end, then `body`, makes a paragraph below the heading',
			'# Title\n',
			['enter', 'b', 'o', 'd', 'y'],
			['# Title\n\nbody\n', ['heading', 'paragraph'], false]
		],
		[
			'Return between `one` and `two`, then `x`, splits the paragraph and types at the second one’s start',
			'onetwo\n',
			['left', 'left', 'left', 'enter', 'x'],
			['one\n\nxtwo\n', ['paragraph', 'paragraph'], false]
		],
		[
			'Shift-Return, then `two`, is a hard break before `two`',
			'one\n',
			['shift-enter', 't', 'w', 'o'],
			['one\\\ntwo\n', ['paragraph'], false]
		],
		[
			'Return at a list item’s end, then `two`, adds an item holding `two`',
			'- one\n',
			['enter', 't', 'w', 'o'],
			['- one\n- two\n', ['list'], false]
		],
		[
			'Return, Backspace, `!` at a list item’s end: the new bullet goes and `!` is the item’s own paragraph (joinBackward)',
			'- one\n- two\n',
			['enter', 'backspace', '!'],
			['- one\n- two\n\n  !\n', ['list'], false]
		],
		[
			'Return twice at a list item’s end, then `p`, leaves the list and `p` is a paragraph after it',
			'- one\n- two\n',
			['enter', 'enter', 'p'],
			['- one\n- two\n\np\n', ['list', 'paragraph'], false]
		],
		[
			'Return at a quote’s end, then `r`, starts a new paragraph in the quote holding `r` (splitBlock)',
			'> q\n',
			['enter', 'r'],
			['> q\n>\n> r\n', ['blockquote'], false]
		],
		[
			'Return twice at a quote’s end, then `p`, leaves the quote and `p` is a paragraph after it',
			'> q\n',
			['enter', 'enter', 'p'],
			['> q\n\np\n', ['blockquote', 'paragraph'], false]
		],
		[
			'Return in a code block, then `b`, keeps the newline in the code',
			'```\na\n```\n',
			['enter', 'b'],
			['```\na\nb\n```\n', ['code'], false]
		],
		[
			'in an empty Document, `hi`, Return, `next` makes two paragraphs',
			'',
			['h', 'i', 'enter', 'n', 'e', 'x', 't'],
			['hi\n\nnext\n', ['paragraph', 'paragraph'], false]
		]
	]
	for (const [label, source, keys, expected] of keyCases) {
		check(`${label}, one key at a time`, await typeKeys(source, keys, false), expected)
		check(
			`${label}, all keys in one batch as fast typing delivers them`,
			await typeKeys(source, keys, true),
			expected
		)
	}
	check(
		'Return, Backspace, `!` at a paragraph’s end in one batch: Backspace in the new paragraph joins it back (joinBackward), `!` after `Hello`',
		await typeKeys('Hello\n', ['enter', 'backspace', '!'], true),
		['Hello!\n', ['paragraph'], false]
	)
	{
		const emptyThenList = ['enter', '-', 'space', 'enter', '*', '*', 'x', '*', '*']
		const listBackspace = ['x', 'enter', 'backspace', 'enter', 'enter']
		check(
			'a batch holding Returns, an input rule and a Backspace between them keeps every key, in order, as one key at a time does: Return, `- `, Return, `**x**` in an empty Document is editmd’s `<br />` then `**x**`',
			[
				await typeKeys('', emptyThenList, true),
				await typeKeys('', emptyThenList, false),
				await typeKeys('- one\n- two\n', listBackspace, true),
				await typeKeys('- one\n- two\n', listBackspace, false)
			].map(([text]) => text),
			[
				'<br />\n\n**x**\n',
				'<br />\n\n**x**\n',
				'- one\n- twox\n\n<br />\n\n',
				'- one\n- twox\n\n<br />\n\n'
			]
		)
	}
	check(
		'Return twice at a paragraph’s end, then `x`, keeps the empty paragraph between as editmd’s `<br />`; Return then Shift-Return, then `x`, is a hard break in the new paragraph',
		[
			await typeKeys('Hello world\n', ['enter', 'enter', 'x'], false),
			await typeKeys('Hello world\n', ['enter', 'enter', 'x'], true),
			await typeKeys('Hello world\n', ['enter', 'shift-enter', 'x'], false)
		].map(([text]) => text),
		['Hello world\n\n<br />\n\nx\n', 'Hello world\n\n<br />\n\nx\n', 'Hello world\n\n\\\nx\n']
	)

	/**
	 * a lone `<br>` Block, editmd's empty paragraph, in `<br/>` spelling here: painted as one blank body line, not as its
	 * HTML; opened, its field is empty, and typing there replaces it, Escape with nothing typed keeps it, and Return there
	 * makes another empty paragraph after it (splitBlock)
	 */
	documentController.load('one\n\n<br/>\n\ntwo\n', isolated)
	settle()
	const emptyParagraphLook = [
		painted().includes('<br'),
		bounds(find_test_id('markdown-1') ?? 0)?.height ===
			bounds(find_test_id('markdown-0') ?? 0)?.height
	]
	click_test_id('block-1')
	const emptyParagraphField = getProp('block-editor', 'value')
	type('x')
	press('escape')
	settle()
	const typedOverEmpty = documentController.text
	documentController.load('one\n\n<br/>\n\ntwo\n', isolated)
	settle()
	click_test_id('block-1')
	press('escape')
	settle()
	const leftEmpty = documentController.text
	check(
		'a lone `<br/>` Block paints as an empty paragraph line, opens an empty field, is replaced by typing, and stays when left empty; Return in it adds another empty paragraph',
		[
			emptyParagraphLook,
			emptyParagraphField,
			typedOverEmpty,
			leftEmpty,
			(await typeKeys('<br />\n\ntwo\n', ['enter', 'x'], false))[0]
		],
		[[false, true], '', 'one\n\nx\n\ntwo\n', 'one\n\n<br/>\n\ntwo\n', '<br />\n\nx\n\ntwo\n']
	)

	/**
	 * Backspace in the new empty paragraph right after Return joins it back (joinBackward), even when the Backspace before
	 * the Return was heard going up before its deletion was reported, as a window can deliver them
	 */
	documentController.load('', isolated)
	settle()
	for (const key of ['a', 'l', 'p', 'h', 'a']) type(key)
	documentController.backspaceUp()
	type('backspace')
	type('enter')
	await wait(40)
	get_native()?.simulateKeyDown('backspace')
	get_native()?.simulateKeyUp('backspace')
	pump()
	await wait(40)
	type('x')
	press('escape')
	settle()
	check(
		'`alpha`, Backspace, Return, Backspace, `x` joins the new paragraph back: `alphx` (editmd differential case 8)',
		documentController.text,
		'alphx\n'
	)

	/**
	 * Shift-Return, then `more`, in one batch as a window delivers it: the field takes every key first, then each of its
	 * reports is followed by the batch Svelte ships to GPUI, as a window's microtasks run between events, so a field
	 * mounted afresh for the hard break would be destroyed with its reports of `more` still to come
	 */
	documentController.load('Hello world\n', isolated)
	settle()
	click_test_id('block-0')
	await wait(40)
	{
		const typeInActive = documentController.typeInActive.bind(documentController)
		documentController.typeInActive = (field, revision) => {
			typeInActive(field, revision)
			settle()
		}
		get_native()?.simulateKeystrokes('shift-enter m o r e')
		drain()
		documentController.typeInActive = typeInActive
	}
	pump()
	await wait(40)
	press('escape')
	settle()
	check(
		'Shift-Return, then `more`, in one batch reported key by key as a window does, is a hard break before `more`',
		documentController.text,
		'Hello world\\\nmore\n'
	)

	/**
	 * Backspace at the start of Block 1's field of `source`, as a person presses it (key down, then up, which is all a
	 * Backspace that changes nothing reports), then `after` typed: the Document's text and its Blocks' kinds after Escape.
	 * with `batch`, `after` is typed while Backspace is still down, so the controller hears both before its key-up, as
	 * fast typing rolls one key into the next (a keystrokes batch carries no key-up)
	 */
	async function backspaceAtStart(
		source: string,
		after: string,
		batch: boolean
	): Promise<[string, string[]]> {
		documentController.load(source, isolated)
		settle()
		click_test_id('block-1')
		type('cmd-up')
		await wait(40)
		const native = get_native()
		native?.simulateKeyDown('backspace')
		if (batch && after !== '') native?.simulateKeystrokes(after)

		native?.simulateKeyUp('backspace')
		pump()
		await wait(40)
		if (!batch && after !== '') type(after)

		await wait(40)
		press('escape')
		settle()
		return [documentController.text, documentController.blocks.map((block) => block.kind)]
	}
	check(
		'Backspace at a paragraph’s start joins it onto the paragraph above, the caret where they meet: `X` typed then goes between them, after the key-up and while Backspace is still down',
		[
			await backspaceAtStart('one\n\ntwo\n', 'X', false),
			await backspaceAtStart('one\n\ntwo\n', 'X', true)
		],
		[
			['oneXtwo\n', ['paragraph']],
			['oneXtwo\n', ['paragraph']]
		]
	)
	check(
		'Backspace at a paragraph’s start after a heading joins its text onto the heading',
		await backspaceAtStart('# Title\n\ntwo\n', '', false),
		['# Titletwo\n', ['heading']]
	)
	check(
		'Backspace at a paragraph’s start after a code block leaves both as they are',
		await backspaceAtStart('```\na\n```\n\ntwo\n', '', false),
		['```\na\n```\n\ntwo\n', ['code', 'paragraph']]
	)
	documentController.load('one\n', isolated)
	settle()
	click_test_id('block-0')
	type('enter')
	await wait(40)
	get_native()?.simulateKeyDown('backspace')
	get_native()?.simulateKeyUp('backspace')
	pump()
	await wait(40)
	type('x')
	press('escape')
	settle()
	check(
		'Return at a paragraph’s end, then Backspace in the new empty paragraph, takes it away: `x` goes on the first paragraph’s end',
		documentController.text,
		'onex\n'
	)
}

export async function testFormatKeys(): Promise<void> {
	// shortcuts arrive through `on_window_key`, which fires headlessly with GPUI's key name and modifiers
	documentController.load('# Title\n\nBody\n', isolated)
	settle()
	click_test_id('block-0')
	press('cmd-alt-2')
	// the open field's caret is read first, so the command lands once the field answers
	await waitForFieldIdle()
	check(
		'Cmd-Alt-2 makes the Active block a level-2 heading',
		documentController.text,
		'## Title\n\nBody\n'
	)
	check('the field shows the new heading source', getProp('block-editor', 'value'), '## Title')
	press('escape')

	click_test_id('block-1')
	press('cmd-shift-8')
	await waitForFieldIdle()
	check(
		'Cmd-Shift-8 makes the Active paragraph a bullet list',
		documentController.text,
		'## Title\n\n- Body\n'
	)
	press('escape')

	/**
	 * editmd's caret sits at the Document's start once it loads, so a Format command with no Active block acts on the
	 * first Block (measured in editmd's own editor: Heading 2 at load turns the first paragraph into `## …`): its field
	 * opens on the result. a Document just loaded, since once a field has closed the caret stays where it was
	 */
	documentController.load('## Title\n\n- Body\n', isolated)
	settle()
	press('cmd-alt-1')
	check(
		'a Format command with no Active block opens the first Block and acts on it',
		[documentController.text, documentController.activeIndex, getProp('block-editor', 'value')],
		['# Title\n\n- Body\n', 0, '# Title']
	)
	press('escape')

	/**
	 * Bulleted List in a list is a command editmd refuses (formatBlock returns null): nothing at all happens, so the
	 * field is not remounted (same node, its caret still after the typed `- `, where `z` lands) and the Document keeps
	 * the typing
	 */
	click_test_id('block-1')
	press('cmd-left')
	type('-')
	type('space')
	const refusedFieldId = find_test_id('block-editor')?.id
	press('cmd-shift-8')
	type('z')
	check(
		'a Format command editmd refuses changes nothing: the same field keeps its typing, the Document only gains the typing',
		[find_test_id('block-editor')?.id === refusedFieldId, documentController.text],
		[true, '# Title\n\n- z- Body\n']
	)
	press('escape')

	// the field opens on `# Title`; Heading 2 then Heading 1 writes back what it opened with, which must still reset it
	documentController.load('# Title\n', isolated)
	settle()
	click_test_id('block-0')
	press('cmd-alt-2')
	await waitForFieldIdle()
	press('cmd-alt-1')
	await waitForFieldIdle()
	type('z')
	check(
		'a Format command resets the field even to the source it opened with',
		documentController.text,
		'# Titlez\n'
	)
	press('escape')
	documentController.load('## Title\n\n- Body\n', isolated)
	settle()

	/**
	 * every other Format key, each on an open Block of its own: the key, how editmd's menu names it, the Block's
	 * source before and after (editmd MainMenu.swift; the transforms are `formatBlock`)
	 */
	const formatKeyCases: [string, string, string, string][] = [
		['cmd-alt-0', 'Body', '## Title', 'Title'],
		['cmd-alt-1', 'Heading 1', 'Title', '# Title'],
		['cmd-alt-3', 'Heading 3', 'Title', '### Title'],
		['cmd-alt-4', 'Heading 4', 'Title', '#### Title'],
		['cmd-alt-5', 'Heading 5', 'Title', '##### Title'],
		['cmd-alt-6', 'Heading 6', 'Title', '###### Title'],
		['cmd-shift-7', 'Numbered List', 'one', '1. one'],
		// editmd sinks an item only under a sibling before it, so the first item stays where it is
		['cmd-]', 'Indent', '- one\n- two', '- one\n  - two'],
		// a list's Block starts at its first marker, so the indented item is a nested one
		['cmd-[', 'Outdent', '- one\n  - two', '- one\n- two'],
		['cmd-shift-b', 'Quote', 'one', '> one'],
		['cmd-alt-c', 'Code Block', 'x', '```\nx\n```']
	]
	for (const [key, title, before, after] of formatKeyCases) {
		documentController.load(`${before}\n`, isolated)
		settle()
		click_test_id('block-0')
		press(key)
		// in a list the caret decides which item Indent and Outdent move, so the field is read first
		await waitForFieldIdle()
		check(
			`${key} (${title}) turns the Active block’s ${JSON.stringify(before)} into ${JSON.stringify(after)}`,
			documentController.text,
			`${after}\n`
		)
		press('escape')
	}

	/**
	 * Heading 4 on a two-line paragraph writes `#### line one\nline two`, a heading and a paragraph: the open field
	 * covers both until it closes, so `line two` is painted once (in the field), not again as a Block below it
	 */
	documentController.load('line one\nline two\n', isolated)
	settle()
	click_test_id('block-0')
	press('cmd-alt-4')
	await waitForFieldIdle()
	const coveredWhileOpen = [
		documentController.text,
		find_test_id('block-1'),
		painted().split('line two').length - 1
	]
	press('escape')
	check(
		'a Format command that writes several Blocks keeps them all in the open field, nothing painted twice, until it closes',
		[...coveredWhileOpen, find_test_id('block-1')?.type],
		['#### line one\nline two\n', null, 1, 'div']
	)
}

export async function testSourceMergeUndo(): Promise<void> {
	rmSync(fileImageDirectory, { recursive: true, force: true })

	// Source mode (editmd View > Source): Cmd-/ swaps the Blocks for one field over the whole Document
	documentController.load('# Title\n\nBody\n', isolated)
	settle()
	// a Block's field is open first, so the swap has a field to take away
	click_test_id('block-1')
	const blockFieldBefore = find_test_id('block-editor')?.type
	press('cmd-/')
	check(
		'Cmd-/ shows the whole Document in one field, in place of the Blocks and any Block field',
		[
			blockFieldBefore,
			getProp('source-editor', 'value'),
			find_test_id('block-0'),
			find_test_id('block-1'),
			find_test_id('block-editor')
		],
		['textarea', '# Title\n\nBody\n', null, null, null]
	)
	type('x')
	check('typing in Source mode changes the Document', documentController.text, '# Title\n\nBody\nx')
	press('escape')
	check('escape does not leave Source mode', find_test_id('source-editor')?.type, 'textarea')
	press('cmd-alt-2')
	check(
		'a Format command does nothing in Source mode',
		documentController.text,
		'# Title\n\nBody\nx'
	)
	press('cmd-/')
	check('Cmd-/ again hides the source field', find_test_id('source-editor'), null)
	// the view is DocumentView alone here, so everything painted is the two Blocks: the heading, then the paragraph
	check(
		'the Blocks paint the text typed in Source mode: the paragraph paints `Body` then the typed `x`',
		[find_test_id('block-1')?.type, painted()],
		['div', 'Title\nBody x']
	)

	// a Disk merge while Source mode is open defers into its field like a Block's, keeping both edits
	const sourceDirectory = mkdtempSync(join(tmpdir(), 'eg-source-'))
	const sourcePath = join(sourceDirectory, 'source.md')
	writeFileSync(sourcePath, '# Doc\n\nmine\n')
	documentController.open(sourcePath, { ...isolated, socketsDirectory: join(sourceDirectory, 's') })
	settle()
	press('cmd-/')
	type('y')
	writeFileSync(sourcePath, '# Doc\n\nmine\n\ntheirs\n')
	await waitUntil(
		() => documentController.text.includes('theirs') && documentController.text.includes('y'),
		'the disk merge in Source mode'
	)
	await waitUntil(
		() => String(getProp('source-editor', 'value')).includes('theirs'),
		'the disk merge in the source field'
	)
	// editmd's editor shows a Disk merge in Source mode at once too.
	// The field's caret starts at the end, so `y` lands after `mine`'s newline, and the agent's paragraph follows it.
	check(
		'a Disk merge in Source mode keeps both edits and shows them in its field at once: the typed `y` and the paragraph written to disk',
		[documentController.sourceMode, documentController.text, getProp('source-editor', 'value')],
		[true, '# Doc\n\nmine\ny\ntheirs\n', '# Doc\n\nmine\ny\ntheirs\n']
	)
	press('cmd-/')

	// the same for an open Block: a Disk merge into it lands in the Document and shows in its field at once
	const blockPath = openFixture(sourceDirectory, 'block.md', '# Doc\n\npara\n', {
		...isolated,
		socketsDirectory: join(sourceDirectory, 'block-merge')
	})
	settle()
	click_test_id('block-1')
	type('z')
	writeFileSync(blockPath, '# Doc\n\npara\nagent\n')
	await waitUntil(
		() => documentController.text.includes('agent'),
		'the disk merge into the open Block'
	)
	await waitUntil(
		() => String(getProp('block-editor', 'value')).includes('agent'),
		'the disk merge in the open field'
	)
	check(
		'a Disk merge into the open Block lands in the Document and shows in its field at once, merged with the typing',
		[documentController.activeIndex, documentController.text, getProp('block-editor', 'value')],
		[1, '# Doc\n\nparaz\nagent\n', 'paraz\nagent']
	)
	press('escape')

	/**
	 * a key the open field took just before an outside change mounts it afresh: its report is still on its way from GPUI
	 * when the merge remounts the field, so it comes from the replaced field, and must land on top of the merge
	 */
	const lateKeyPath = openFixture(sourceDirectory, 'late-key.md', '# Late\n\nStart.\n', {
		...isolated,
		socketsDirectory: join(sourceDirectory, 'late-key')
	})
	settle()
	click_test_id('block-1')
	type('a')
	const lateKeyRevision = documentController.fieldRevision
	// the field takes `b`, but with no pump its report waits in GPUI's queue
	get_native()?.simulateKeystrokes('b')
	writeFileSync(lateKeyPath, '# Late\n\nA1 Start.\n')
	// neither pumped nor settled until the merge remounts the field, so the replaced field is still there to report
	for (let tries = 0; documentController.fieldRevision === lateKeyRevision && tries < 200; tries++)
		await new Promise((resolve) => setTimeout(resolve, 10))
	const lateKeyRemounted = documentController.fieldRevision !== lateKeyRevision
	pump()
	await waitForFieldIdle()
	type('c')
	press('escape')
	check(
		'a key whose report is still on its way when an outside change remounts the open field lands once, in order, with the outside change',
		[lateKeyRemounted, documentController.text],
		[true, '# Late\n\nA1 Start.abc\n']
	)

	/**
	 * an outside write that removes or adds Blocks above the open one while its field is open: the field
	 * stays on the Edit session's Block wherever the merge moved it, keeps the typed `xy`, nothing paints twice, a new
	 * Block above paints, and after more typing and Escape the Document holds the merged text
	 */
	let shiftRuns = 0
	/** the page's painted lines, without the Agent legend the merge brings up in its corner */
	function getPageLines(): string[] {
		const lines = painted().split('\n')
		const legend = lines.indexOf('AGENTS')
		return legend < 0 ? lines : lines.slice(0, legend)
	}
	async function mergeAroundOpenField(outside: string) {
		shiftRuns++
		const shiftPath = join(sourceDirectory, `shift-${shiftRuns}.md`)
		const typed = '# Title\n\nFirst paragraph.xy\n\nSecond paragraph.\n'
		writeFileSync(shiftPath, '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n')
		documentController.open(shiftPath, {
			...isolated,
			socketsDirectory: join(sourceDirectory, `shift-${shiftRuns}`)
		})
		settle()
		click_test_id('block-1')
		type('x')
		type('y')
		const beforeMerge = documentController.text
		writeFileSync(shiftPath, outside)
		await waitUntil(() => documentController.text !== typed, 'the merge around the open field')
		// an outside change to the open Block shows in its field a moment later, as the user sees it
		await waitForFieldIdle()
		const whileOpen = [documentController.activeIndex, getPageLines()]
		type('z')
		press('escape')
		return [beforeMerge, ...whileOpen, documentController.text, getPageLines()]
	}
	check(
		'an outside write removing the Block above the open one: the field follows its Block, keeps the typing, nothing paints twice, Escape keeps the merged text',
		await mergeAroundOpenField('First paragraph.\n\nSecond paragraph.\n'),
		[
			'# Title\n\nFirst paragraph.xy\n\nSecond paragraph.\n',
			0,
			['First paragraph.xy', 'Second paragraph.'],
			'First paragraph.xyz\n\nSecond paragraph.\n',
			['First paragraph.xyz', 'Second paragraph.']
		]
	)
	check(
		'an outside write adding a Block above the open one: the new Block paints, the field follows its Block and keeps the typing, Escape keeps the merged text',
		await mergeAroundOpenField(
			'# Title\n\nNew paragraph from outside.\n\nFirst paragraph.\n\nSecond paragraph.\n'
		),
		[
			'# Title\n\nFirst paragraph.xy\n\nSecond paragraph.\n',
			2,
			['Title', 'New paragraph from outside.', 'First paragraph.xy', 'Second paragraph.'],
			'# Title\n\nNew paragraph from outside.\n\nFirst paragraph.xyz\n\nSecond paragraph.\n',
			['Title', 'New paragraph from outside.', 'First paragraph.xyz', 'Second paragraph.']
		]
	)
	check(
		'an outside write removing the Block above and changing the open one: the field follows it, shows both changes at once, and Escape keeps both',
		await mergeAroundOpenField('Fresh paragraph.\n\nSecond paragraph.\n'),
		[
			'# Title\n\nFirst paragraph.xy\n\nSecond paragraph.\n',
			0,
			['Fresh paragraph.xy', 'Second paragraph.'],
			'Fresh paragraph.xyz\n\nSecond paragraph.\n',
			['Fresh paragraph.xyz', 'Second paragraph.']
		]
	)
	/**
	 * the paragraph being edited deleted by another program: its typing goes with it and its field closes, as editmd's
	 * rich editor drops the Block, so the Document and the file hold what the write left
	 *
	 * A key the field took just before, its report still on its way from GPUI, lands nowhere.
	 */
	const droppedPath = join(sourceDirectory, 'dropped.md')
	const droppedText = '# Title\n\nSecond paragraph.\n'
	writeFileSync(droppedPath, '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n')
	documentController.open(droppedPath, {
		...isolated,
		socketsDirectory: join(sourceDirectory, 'dropped')
	})
	settle()
	click_test_id('block-1')
	type('x')
	type('y')
	get_native()?.simulateKeystrokes('z')
	writeFileSync(droppedPath, droppedText)
	for (let tries = 0; documentController.text.includes('First') && tries < 200; tries++)
		await new Promise((resolve) => setTimeout(resolve, 10))
	pump()
	await waitForFieldIdle()
	await wait(300)
	check(
		'an outside write deleting the open Block drops its typing and closes its field, a late key landing nowhere: the Document and the file hold what the write left',
		[
			documentController.activeIndex,
			find_test_id('block-editor'),
			getPageLines(),
			documentController.text,
			readFileSync(droppedPath, 'utf8')
		],
		[null, null, ['Title', 'Second paragraph.'], droppedText, droppedText]
	)

	// Source mode's one field over the whole text: a Block removed above the typing keeps the field and both changes
	const sourceShiftPath = join(sourceDirectory, 'source-shift.md')
	writeFileSync(sourceShiftPath, '# Title\n\nFirst paragraph.\n')
	documentController.open(sourceShiftPath, {
		...isolated,
		socketsDirectory: join(sourceDirectory, 'source-shift')
	})
	settle()
	press('cmd-/')
	type('y')
	writeFileSync(sourceShiftPath, 'First paragraph.\n')
	await waitUntil(
		() => !documentController.text.startsWith('# Title'),
		'the merge removing a Block in Source mode'
	)
	await waitForFieldIdle()
	const sourceAfterShift = [
		find_test_id('source-editor')?.type,
		documentController.text,
		getPageLines().filter((line) => line === 'y').length
	]
	press('cmd-/')
	// the field shows the merge at once, the typed `y` once
	check(
		'an outside write removing a Block while Source mode is open keeps its field and both changes',
		[...sourceAfterShift, documentController.text],
		['textarea', 'First paragraph.\ny', 1, 'First paragraph.\ny']
	)
	rmSync(sourceDirectory, { recursive: true, force: true })

	// Cmd-Z / Cmd-Shift-Z with no field focused run the Document's own history; headlessly no field reports focus
	documentController.load('- [ ] task\n\nParagraph\n', isolated)
	settle()
	click_test_id('task-3')
	const tickedBeforeUndo = documentController.text
	press('cmd-z')
	check(
		'Cmd-Z with no field focused unticks the task again',
		[tickedBeforeUndo, documentController.text],
		['- [x] task\n\nParagraph\n', '- [ ] task\n\nParagraph\n']
	)
	press('cmd-shift-z')
	check('Cmd-Shift-Z ticks it again', documentController.text, '- [x] task\n\nParagraph\n')

	click_test_id('block-1')
	type('a')
	type('b')
	press('escape')
	const typedBeforeUndo = documentController.text
	press('cmd-z')
	check(
		'Cmd-Z takes back a closed Edit session’s typing as one Undo step',
		[typedBeforeUndo, documentController.text],
		['- [x] task\n\nParagraphab\n', '- [x] task\n\nParagraph\n']
	)

	/**
	 * with a field focused, Cmd-Z is the field's own native undo and the window never sees it: headlessly
	 * no focus event arrives, so `focus` reports it as a window would
	 */
	click_test_id('block-1')
	const paragraphField = find_test_id('block-editor')
	if (paragraphField) focus(paragraphField)

	type('x')
	type('y')
	const textBeforeFieldUndo = documentController.text
	press('cmd-z')
	check(
		'Cmd-Z in a focused field takes back its typing, leaving the Document’s Undo steps alone: the task stays ticked',
		[textBeforeFieldUndo, documentController.text, documentController.activeIndex],
		['- [x] task\n\nParagraphxy\n', '- [x] task\n\nParagraph\n', 1]
	)
	/**
	 * the Document's own redo would bring back the closed session's `ab`, which the Cmd-Z after the closed session took back; the field's
	 * native redo brings back its own `xy` instead
	 */
	const textBeforeFieldRedo = documentController.text
	press('cmd-shift-z')
	check(
		'Cmd-Shift-Z in a focused field brings back its typing, leaving the Document’s Undo steps alone: no `ab` comes back',
		[textBeforeFieldRedo, documentController.text, documentController.activeIndex],
		['- [x] task\n\nParagraph\n', '- [x] task\n\nParagraphxy\n', 1]
	)
}

export async function testDragSelectCopy(): Promise<void> {
	press('escape')

	/**
	 * a drag over painted text selects it and leaves the Block closed, as editmd keeps a selection; Edit > Copy is
	 * enabled while text is selected, and it and ⌘C outside a field put the selection on the pasteboard (`writeClipboard`,
	 * a recorder here, never the real pasteboard)
	 */
	const copied: string[] = []
	documentController.load('Copy these words from the page.\n\nSecond\n', {
		...menuOptions,
		writeClipboard: (text: string) => {
			copied.push(text)
			return true
		}
	})
	settle()
	const findCopyItem = () =>
		documentController.menus
			.find(({ title }) => title === 'Edit')
			?.items.find((item) => item.kind === 'item' && item.title === 'Copy')
	const copyEnabledBefore = findCopyItem()
	const copyText = bounds(find_test_id('block-0')?.children?.[0] ?? 0)
	const dragged = copyText
		? drag_select(
				{ x: copyText.x + 2, y: copyText.y + copyText.height / 2 },
				{ x: copyText.x + 120, y: copyText.y + copyText.height / 2 }
			)
		: null
	settle()
	const afterDrag = [documentController.activeIndex, find_test_id('block-editor')]
	const copyEnabledAfter = findCopyItem()
	press('cmd-c')
	settle()
	check(
		`a drag over a Block’s text selects it and opens no field; Copy is enabled then, and ⌘C copies the selection (${dragged})`,
		[
			copyEnabledBefore?.kind === 'item' && copyEnabledBefore.enabled,
			typeof dragged === 'string' && dragged.length > 0,
			afterDrag,
			copyEnabledAfter?.kind === 'item' && copyEnabledAfter.enabled,
			copied
		],
		[false, true, [null, null], true, [dragged]]
	)
	click_test_id('block-1')
	check('a click on a Block after a selection still opens it', documentController.activeIndex, 1)
}

export async function testFieldCommands(): Promise<void> {
	documentController.load('', isolated)
	rmSync(runDirectory, { recursive: true, force: true })

	/**
	 * a field's selection and caret, which gpuix does not report (gap G1), learnt and changed through the keys the
	 * field takes; every effect outside the window is this folder's or a recorder's, the pasteboard never touched
	 */
	initSandboxFolder()

	// "two" selected, then the caret at the start: the probe's sentinel and cmd-z never reach the Document
	documentController.load('one two three\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	type('cmd-left right right right right shift-right shift-right shift-right')
	// the window's title recorder hears an Edited mark the moment the Document changes, even back and forth
	menuRuns.length = 0
	const probedTwo = await loadProbedRange()
	const afterProbe = [
		documentController.text,
		documentController.edited,
		painted().includes('one two three'),
		painted().includes('one a three')
	]
	type('cmd-left')
	const probedStart = await loadProbedRange()
	const titlesWhileProbing = menuRuns.filter(([command]) => command === 'setWindowTitle')
	press('escape')
	check(
		'a probe reads the open field’s selection and its caret by a typed sentinel and cmd-z, and neither reaches the Document: no change, no Edited mark at any moment, the field’s text as it was',
		[probedTwo, probedStart, afterProbe, titlesWhileProbing],
		[{ start: 4, end: 7 }, { start: 0, end: 0 }, ['one two three\n', false, true, false], []]
	)

	/** whether Format's first four items (Bold, Italic, Strikethrough, Inline Code) are enabled */
	const getInlineEnabled = () =>
		(documentController.menus[2]?.items ?? [])
			.slice(0, 4)
			.map((item) => item.kind === 'item' && item.enabled)
	const inlineClosed = getInlineEnabled()
	click_test_id('block-0')
	const inlineOpen = getInlineEnabled()
	type('cmd-left right right right right shift-right shift-right shift-right')
	press('cmd-b')
	await waitForFieldIdle()
	press('escape')
	check(
		'⌘B on “two” selected in a Block’s field writes `one **two** three` once the field closes; Bold, Italic, Strikethrough and Inline Code are enabled with a field open and without, as editmd’s Format',
		[documentController.text, inlineOpen, inlineClosed],
		['one **two** three\n', [true, true, true, true], [true, true, true, true]]
	)
	click_test_id('block-0')
	type('cmd-left shift-right shift-right shift-right')
	openMenu('Format')
	clickRow('Italic')
	await waitForFieldIdle()
	press('escape')
	check(
		'Format > Italic from the menu bar wraps the field’s selection, the field keeping the keys',
		documentController.text,
		'_one_ **two** three\n'
	)

	/**
	 * a selection that is the probe's own sentinel: typed over itself it leaves the value as it was, which the field still
	 * reports, and cmd-z puts the selection back, so the probe reads it with no remount
	 */
	documentController.load('x a y\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	type('cmd-left right right shift-right')
	const sentinelRevision = documentController.fieldRevision
	press('cmd-b')
	await waitForFieldIdle()
	const sentinelRemounts = documentController.fieldRevision - sentinelRevision
	press('escape')
	check(
		'⌘B on a selected “a” in `x a y`, the probe’s own sentinel, writes `x **a** y` with no remount of the field',
		[documentController.text, sentinelRemounts],
		['x **a** y\n', 0]
	)

	/**
	 * a selection of spaces only gets no marks (toggleInlineKeys gives no keys): nothing is sent, and the probe is settled,
	 * so ⇧⌘Z after it brings no sentinel back
	 */
	documentController.load('x  y\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	type('cmd-left right shift-right shift-right')
	press('cmd-b')
	await waitForFieldIdle()
	type('cmd-shift-z')
	await waitForFieldIdle()
	press('escape')
	check(
		'⌘B on a selection of two spaces changes nothing, and ⇧⌘Z after it brings no sentinel back',
		documentController.text,
		'x  y\n'
	)

	// a list's Indent acts on the item the caret is in, read from the field (editmd's block format keeps the caret's item)
	documentController.load('- a\n- b\n- c\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	type('cmd-up down cmd-right')
	press('cmd-]')
	await waitForFieldIdle()
	press('escape')
	const indentAtCaret = documentController.text
	/**
	 * Indent at the first item, which editmd refuses: after its probe the field is set to its own text again, so ⇧⌘Z in it
	 * brings no sentinel back, and its caret is where the probe found it
	 */
	documentController.load('- a\n- b\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	type('cmd-up')
	press('cmd-]')
	await waitForFieldIdle()
	type('cmd-shift-z')
	type('x')
	press('escape')
	check(
		'Indent with the caret after “b” indents that item; refused at the first item it changes nothing after its probe, ⇧⌘Z then bringing nothing back and the caret staying put',
		[indentAtCaret, documentController.text],
		['- a\n  - b\n- c\n', 'x- a\n- b\n']
	)

	/** `command` with the field's selection from after `b` to after `c`, as shift-up from the end of `c` selects */
	async function runOverTwoItems(source: string, command: string): Promise<string> {
		documentController.load(source, sandboxOptions)
		settle()
		click_test_id('block-0')
		type('shift-up')
		press(command)
		await waitForFieldIdle()
		press('escape')
		return documentController.text
	}
	check(
		'Indent and Outdent over a selection from after “b” to after “c” move both items at the first one’s level, as editmd’s sinkListItem and liftListItem over its range',
		[
			await runOverTwoItems('- a\n- b\n- c\n', 'cmd-]'),
			await runOverTwoItems('- a\n  - b\n  - c\n', 'cmd-[')
		],
		['- a\n  - b\n  - c\n', '- a\n- b\n- c\n']
	)

	// editmd's commands are Undo steps of their own: the typing before Heading 2 stays when ⌘Z takes the heading back
	documentController.load('Intro\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	type('x')
	press('cmd-alt-2')
	await waitForFieldIdle()
	press('escape')
	press('cmd-z')
	settle()
	check(
		'a Format command on an open field is an Undo step of its own: after Heading 2 and Escape, one ⌘Z takes the heading back and keeps the typed x',
		documentController.text,
		'Introx\n'
	)

	// Add Link at the selection, read when Add is pressed; Cancel reads nothing
	documentController.load('one two three\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	type('cmd-left right right right right shift-right shift-right shift-right')
	setMenuClipboardUrl('https://example.com/x')
	press('cmd-shift-k')
	settle()
	const busyOnSheet = documentController.fieldBusy
	press('enter')
	await waitForFieldIdle()
	type('!')
	press('escape')
	const linkedText = documentController.text
	click_test_id('block-0')
	press('cmd-shift-k')
	settle()
	press('escape')
	settle()
	const busyAfterCancel = documentController.fieldBusy
	press('escape')
	setMenuClipboardUrl(null)
	check(
		'Add Link with “two” selected makes it the link’s text and puts the caret just after the link; the sheet reads nothing until Add, and Cancel reads nothing',
		[linkedText, busyOnSheet, busyAfterCancel, documentController.text],
		['one [two](https://example.com/x)! three\n', false, false, linkedText]
	)

	// The field's own undo takes Add Link back while the field is still open: the link's syntax goes, its text stays.
	documentController.load('one two three\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	type('cmd-left right right right right shift-right shift-right shift-right')
	setMenuClipboardUrl('https://example.com/x')
	press('cmd-shift-k')
	settle()
	press('enter')
	await waitForFieldIdle()
	setMenuClipboardUrl(null)
	const linkInField = documentController.text
	type('cmd-z')
	await waitForFieldIdle()
	const afterFirstUndo = documentController.text
	type('cmd-z')
	await waitForFieldIdle()
	press('escape')
	check(
		'⌘Z in the open field after Add Link on “two” takes the link back in two steps, as GPUI groups the field’s undo (the typing, then the deleted word): `one two three` again',
		[linkInField, afterFirstUndo, documentController.text],
		['one [two](https://example.com/x) three\n', 'one  three\n', 'one two three\n']
	)

	// Add with the URL cleared takes the link at the caret off, as editmd's Add with nothing in the field does
	documentController.load('see [docs](https://old.example) here\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	type('cmd-left right right right right right right')
	setMenuClipboardUrl('https://old.example')
	press('cmd-shift-k')
	settle()
	await wait(150)
	type('backspace')
	settle()
	const clearedUrl = getProp('add-link-url', 'value')
	press('enter')
	await waitForFieldIdle()
	press('escape')
	setMenuClipboardUrl(null)
	check(
		'Add Link with its URL cleared and the caret inside a link takes the link off, its text kept',
		[clearedUrl, documentController.text],
		['', 'see docs here\n']
	)

	/** Edit's Cut, Copy, Paste, Paste and Match Style, Delete and Select All: whether each is enabled */
	const getEditEnabled = () =>
		(documentController.menus[1]?.items ?? [])
			.slice(3, 9)
			.map((item) => item.kind === 'item' && item.enabled)
	documentController.load('Alpha beta\n', sandboxOptions)
	settle()
	const editClosed = getEditEnabled()
	click_test_id('block-0')
	const editOpen = getEditEnabled()
	const getEditorId = () => find_test_id('block-editor')?.id
	openMenu('Edit')
	const focusedWithMenu = get_native()?.getFocusedElementId() === getEditorId()
	clickRow('Select All')
	await wait(50)
	pump()
	const focusedAfterMenu = get_native()?.getFocusedElementId() === getEditorId()
	type('q')
	press('escape')
	check(
		'Edit’s field items are enabled with a field open and greyed without, Paste enabled either way as editmd pastes at its caret, Delete greyed always; Select All from the menu, which leaves the field its keys, selects the field’s text, so typing replaces it',
		[editClosed, editOpen, focusedWithMenu, focusedAfterMenu, documentController.text],
		[
			[false, false, true, false, false, false],
			[true, true, true, true, false, true],
			true,
			true,
			'q\n'
		]
	)

	// editmd's Source mode puts its caret at the start (editor.ts:318-322), so its field shows the Document's first line
	await loadNumberedLinesInSource('\n\n')
	const sourceShowsTop = painted()
		.split('\n')
		.some((line) => line === 'line 1')
	type('Z')
	const sourceTyped = documentController.text.slice(0, 7)
	press('cmd-/')
	check(
		'Source mode opens with its caret at the top: the field shows the first line, and typing goes in before it',
		[sourceShowsTop, sourceTyped],
		[true, 'Zline 1']
	)

	// ⌘F with a query already in the field selects it all, as NSSearchField does
	documentController.load('Find me here.\n', sandboxOptions)
	settle()
	press('cmd-f')
	type('m')
	type('e')
	press('escape')
	press('cmd-f')
	await wait(100)
	pump()
	type('h')
	const queryAfterRefind = findController.query
	press('escape')
	check(
		'⌘F with a query in the find field selects it, so typing replaces it',
		queryAfterRefind,
		'h'
	)

	// ⌃⌘F is AppKit's View > Enter Full Screen
	menuRuns.length = 0
	press('ctrl-cmd-f')
	check(
		'⌃⌘F toggles full screen',
		menuRuns.filter(([command]) => command === 'toggleFullScreen'),
		[['toggleFullScreen', []]]
	)

	/**
	 * editmd focuses the editor once a Document loads (main.ts:80-84): an empty one takes typing at once, the field showing
	 * "Start writing…" in the faint colour until its first character (style.css:392-399)
	 */
	documentController.load('', sandboxOptions)
	settle()
	const emptyFieldBox = bounds(find_test_id('block-editor') ?? 0)
	const emptyHintInk = emptyFieldBox
		? getInkColour(captureWindow(), emptyFieldBox, [getPalette().background ?? ''])
		: null
	const emptyField = [find_test_id('block-editor')?.type, getProp('empty-hint-text', 'source')]
	type('x')
	const typedIntoEmpty = [documentController.text, find_test_id('empty-hint')]
	press('escape')
	check(
		`an empty Document opens its field on load showing “Start writing…” in the faint colour (${emptyHintInk}) until its first character, so a key typed without a click writes it`,
		[emptyField, isNear(emptyHintInk ?? '', getPalette().faint ?? '', 16), typedIntoEmpty],
		[['textarea', 'Start writing…'], true, ['x\n', null]]
	)
}

export async function testOpenFieldSizesAndLoadCaret(): Promise<void> {
	/**
	 * row e-mermaid-edit: the source card keeps editmd's `.code-block.mermaid.editing > pre { margin-bottom: 0.5em }`
	 * of its 13.5px, 6.75px, above the live diagram (style.css:417-419)
	 */
	documentController.load('```mermaid\nflowchart LR\n  A --> B\n```\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	settle()
	const mermaidCard = bounds(find_test_id('block-editor-card') ?? 0)
	/**
	 * measured in the paint, since the card is a padded box (see `remoteLayout` in test/ui/rendering.ts): down a column
	 * inside the card, from its last row in the surface colour to the live diagram's 1px border
	 */
	const mermaidGap = (() => {
		if (!mermaidCard) return Number.NaN

		const capture = captureWindow()
		// near the card's right edge, clear of the source text and the language label
		const column = Math.round((mermaidCard.x + mermaidCard.width - 60) * capture.scale)
		let cardEnd = Math.round((mermaidCard.y + 20) * capture.scale)
		while (isNear(getDevicePixel(capture, column, cardEnd), getPalette().surface ?? '', 3)) {
			cardEnd++
		}
		const border = findFirstRowNear(
			capture,
			column,
			cardEnd,
			cardEnd + Math.round(60 * capture.scale),
			getPalette().border ?? '',
			6
		)
		return border < 0 ? Number.NaN : (border - cardEnd) / capture.scale
	})()
	press('escape')
	check(
		`an open mermaid Block’s source card sits 6.75px above its live diagram (${mermaidGap})`,
		snapToWanted([mermaidGap], [6.75]),
		[6.75]
	)

	/**
	 * editmd's `.source { min-height: 70vh; field-sizing: content }` (style.css:88-103) grows to its whole text, and the
	 * page scrolls it: on 80 lines its field is 80 of its 22px rows tall (22.4px lines at whole px), and scrolled to the
	 * bottom the page shows the 80th line.
	 */
	await loadNumberedLinesInSource('\n')
	const sourceFieldHeight = bounds(find_test_id('source-editor') ?? 0)?.height ?? 0
	wheel({ x: 400, y: 300 }, 0, -100_000)
	settle()
	await wait(50)
	pump()
	// the field's last row in the window: its paint holds every line wherever it is, so its box says what shows
	const scrolledField = bounds(find_test_id('source-editor') ?? 0)
	const sourceShowsLast =
		painted()
			.split('\n')
			.some((line) => line === 'line 80') &&
		scrolledField !== null &&
		scrolledField.y + scrolledField.height <= 538
	press('cmd-/')
	settle()
	// GPUI lays a field's rows out at whole pixels: 22px for the 22.4px line, 21px for code's 20.925px (measured)
	check(
		`Source mode’s field grows to its whole text, which the page scrolls: 80 lines make it at least 80 of its 22px rows tall (${sourceFieldHeight}px), and the 80th paints at the bottom`,
		[sourceFieldHeight >= 80 * 22, sourceShowsLast],
		[true, true]
	)

	// editmd shows a Block whole while it is edited: a 60-line code block's field holds every line, 20.925px each, painted as 21px rows.
	documentController.load(
		`\`\`\`\n${Array.from({ length: 60 }, (_line, index) => `code ${index + 1}`).join('\n')}\n\`\`\`\n`,
		sandboxOptions
	)
	settle()
	// the Block is taller than the window, so the click lands near its top rather than at its centre
	const tallCodeBox = bounds(find_test_id('block-0') ?? 0)
	if (tallCodeBox) click_at(tallCodeBox.x + 40, tallCodeBox.y + 30)

	settle()
	const codeFieldHeight = bounds(find_test_id('block-editor') ?? 0)?.height ?? 0
	press('escape')
	check(
		`a Block’s field holds its whole text: a 60-line code block’s field, its code alone, is at least its 60 lines of 21px rows tall (${codeFieldHeight}px)`,
		codeFieldHeight >= 60 * 21,
		true
	)

	/**
	 * with no field open, editmd's commands act at its load caret, the start of the text of the first Block that
	 * holds text (`firstTextOffset`; front matter, rules and definitions have none): Outdent there takes the first item
	 * out of its list, Add Link puts the URL before the first word, and Heading 2 passes over a rule to its paragraph
	 */
	documentController.load('- a\n- b\n- c\n', sandboxOptions)
	settle()
	press('cmd-[')
	press('escape')
	const outdentAtLoad = documentController.text
	documentController.load('see docs\n', sandboxOptions)
	settle()
	setMenuClipboardUrl('https://a.example')
	press('cmd-shift-k')
	settle()
	press('enter')
	await waitForFieldIdle()
	press('escape')
	setMenuClipboardUrl(null)
	const linkAtLoad = documentController.text
	documentController.load('---\n\npara\n', sandboxOptions)
	settle()
	press('cmd-alt-2')
	press('escape')
	const headingAtLoad = documentController.text
	check(
		'with no field open a command acts at editmd’s load caret, the start of the first Block holding text: Outdent, Add Link and Heading 2',
		[outdentAtLoad, linkAtLoad, headingAtLoad],
		['a\n\n- b\n- c\n', '<https://a.example>see docs\n', '---\n\n## para\n']
	)

	/**
	 * with no Block holding text after a rule or a definition, editmd's load caret sits in the empty paragraph Milkdown's
	 * `trailing` plugin keeps at the end (web/src/editor.ts:482): Heading 1 makes a heading there and Add Link puts its URL
	 * there, each in a new Block's field after the last Block
	 */
	documentController.load('---\n', sandboxOptions)
	settle()
	press('cmd-alt-1')
	settle()
	type('x')
	press('escape')
	const headingAfterRule = documentController.text
	documentController.load('[x]: https://e.example\n', sandboxOptions)
	settle()
	setMenuClipboardUrl('https://a.example')
	press('cmd-shift-k')
	settle()
	press('enter')
	await waitForFieldIdle()
	press('escape')
	setMenuClipboardUrl(null)
	check(
		'with no Block holding text, Heading 1 after a rule and Add Link after a definition act in a new Block after it',
		[headingAfterRule, documentController.text],
		['---\n\n# x\n', '[x]: https://e.example\n\n<https://a.example>\n']
	)
}

export async function testLateProbeReply(): Promise<void> {
	/**
	 * a probe whose reply comes only after it gave up (its wait cut to 0ms through `fieldReplyMs`) leaves the
	 * Document as it was: the late reply carries the sentinel, and never reaches the Edit session
	 */
	documentController.load('one two three\n', { ...sandboxOptions, fieldReplyMs: 0 })
	settle()
	click_test_id('block-0')
	type('cmd-left right right right right shift-right shift-right shift-right')
	menuRuns.length = 0
	const lateProbe = await loadProbedRange()
	for (let round = 0; round < 5; round++) {
		await wait(30)
		pump()
	}
	const afterLateProbe = [
		documentController.text,
		documentController.edited,
		menuRuns.filter(([command]) => command === 'setWindowTitle')
	]
	press('escape')
	check(
		`a probe that gives up before the field replies never lets the late reply, sentinel and all, into the Document (${JSON.stringify(afterLateProbe)})`,
		[lateProbe, afterLateProbe, documentController.text],
		[null, ['one two three\n', false, []], 'one two three\n']
	)
}

export async function testCommandOnLastEdited(): Promise<void> {
	// with no field open a command acts where editmd's caret was last: the Block of the last closed Edit session
	documentController.load('one\n\ntwo\n\nthree\n', sandboxOptions)
	settle()
	click_test_id('block-2')
	type('x')
	press('escape')
	press('cmd-alt-2')
	press('escape')
	check(
		'with no field open, Heading 2 acts on the Block edited last, where editmd’s caret stayed',
		documentController.text,
		'one\n\ntwo\n\n## threex\n'
	)
}

export async function testRefusedInCode(): Promise<void> {
	/**
	 * editmd refuses Bold in code and its front matter box never takes Format (`takesMarks`): the field keeps its text,
	 * no probe is typed, nothing is remounted. Add Link in front matter, which `linkAtSelection` refuses, the same
	 */
	const marklessText = '---\ntitle: x\n---\n\n```js\nlet a\n```\n'
	documentController.load(marklessText, sandboxOptions)
	settle()
	/** a format or Add Link in Block `index`'s field: whether the Document and the field stayed as they were */
	async function leavesField(index: number, act: () => void): Promise<[string, boolean]> {
		click_test_id(`block-${index}`)
		settle()
		type('cmd-up shift-right shift-right shift-right')
		const fieldId = find_test_id('block-editor')?.id
		act()
		await waitForFieldIdle()
		const result: [string, boolean] = [
			documentController.text,
			find_test_id('block-editor')?.id === fieldId
		]
		press('escape')
		return result
	}
	const boldInCode = await leavesField(1, () => press('cmd-b'))
	const boldInFrontmatter = await leavesField(0, () => press('cmd-b'))
	setMenuClipboardUrl('https://x.example')
	const linkInFrontmatter = await leavesField(0, () => {
		press('cmd-shift-k')
		settle()
		press('enter')
	})
	setMenuClipboardUrl(null)
	check(
		'Bold in an open code field and in the front matter field, and Add Link in the front matter field, change nothing and remount nothing',
		[boldInCode, boldInFrontmatter, linkInFrontmatter],
		[
			[marklessText, true],
			[marklessText, true],
			[marklessText, true]
		]
	)
}

export async function testMarkShortcuts(): Promise<void> {
	async function toggleBold(source: string, keys: string): Promise<string> {
		documentController.load(source, sandboxOptions)
		settle()
		click_test_id('block-0')
		type(keys)
		press('cmd-b')
		await waitForFieldIdle()
		press('escape')
		return documentController.text
	}
	/**
	 * the field's arrows step one character, an emoji too, so the keys that toggle marks and put a selection back
	 * count characters, not UTF-16 units
	 */
	const unboldedEmoji = await toggleBold('**😀** next\n', 'cmd-left right right shift-right')
	const boldedEmoji = await toggleBold('a 😀b c\n', 'cmd-left right right shift-right shift-right')
	// Bold on the two spaces after an emoji gets no marks; the probe's settle selects them again, which `z` then replaces
	documentController.load('😀  x\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	type('cmd-left right shift-right shift-right')
	press('cmd-b')
	await waitForFieldIdle()
	type('z')
	await waitForFieldIdle()
	press('escape')
	check(
		'with an emoji in the field, ⌘B unbolds `**😀**` to `😀 next`, bolds `😀b` to `a **😀b** c`, and a settled probe puts the selection after the emoji back',
		[unboldedEmoji, boldedEmoji, documentController.text],
		['😀 next\n', 'a **😀b** c\n', '😀zx\n']
	)

	/**
	 * a mark's shortcut and the keys after it in one batch, as fast typing delivers them: the field takes them all before
	 * the toggle's probe types its sentinel, so the reports of the typed keys come in while it waits. `before` goes in one
	 * call first; with no field open (`click` false) the batch opens the field at editmd's load caret
	 */
	async function markThenType(
		source: string,
		before: string,
		burst: string,
		click = true
	): Promise<string> {
		documentController.load(source, sandboxOptions)
		settle()
		if (click) click_test_id('block-0')
		if (before !== '') type(before)

		type(burst)
		await waitForFieldIdle()
		press('escape')
		return documentController.text
	}
	const selectTwo = 'cmd-left right right right right shift-right shift-right shift-right'
	const afterOne = 'cmd-left right right right right'
	check(
		'a mark’s shortcut and the keys after it in one batch keep every key and the mark: ⌘B twice on `two` takes the mark off, ⌘B or ⌘I then typing at a caret types between the marks, ⌘B on `two`, Right, ` x` keeps ` x`, ⇧⌘X then `x` too, ⌘E at a caret takes no mark and keeps `x`, and with no field open ⌘B then `x` types at editmd’s load caret',
		[
			await markThenType('one two three\n', selectTwo, 'cmd-b cmd-b'),
			await markThenType('one two\n', '', 'cmd-b x'),
			await markThenType('one two\n', afterOne, 'cmd-i x'),
			await markThenType('one two three\n', afterOne, 'cmd-b b o l d'),
			// Right moved the selection before the probe could read it, so only the keys are sure to land, not the marks
			(await markThenType('one two three\n', selectTwo, 'cmd-b right space x')).replaceAll('*', ''),
			await markThenType('one two\n', afterOne, 'cmd-shift-x x'),
			await markThenType('one two\n', afterOne, 'cmd-e x'),
			await markThenType('one two three\n', '', 'cmd-b x', false)
		],
		[
			'one two three\n',
			'one two**x**\n',
			'one _x_two\n',
			'one **bold**two three\n',
			'one two x three\n',
			'one ~~x~~two\n',
			'one xtwo\n',
			'**x**one two three\n'
		]
	)

	/**
	 * `shortcut` at the caret after `one two` in its open field, waited out so `keys` are no fast typing behind it, then
	 * `keys`, if any, and Escape
	 */
	async function markAtCaret(shortcut: string, keys: string): Promise<string> {
		documentController.load('one two\n', sandboxOptions)
		settle()
		click_test_id('block-0')
		press(shortcut)
		await waitForFieldIdle()
		if (keys !== '') {
			type(keys)
			await waitForFieldIdle()
		}
		press('escape')
		return documentController.text
	}
	check(
		'at a caret in an open field, ⌘B or ⌘I then Escape leave no empty pair, as editmd’s stored mark leaves no text, and ⌘B then `x` keeps the pair',
		[
			await markAtCaret('cmd-b', ''),
			await markAtCaret('cmd-i', ''),
			await markAtCaret('cmd-b', 'x')
		],
		['one two\n', 'one two\n', 'one two**x**\n']
	)

	// with no field open, Table goes in after the Block last edited, while it is as its Edit session left it
	documentController.load('One.\n\nTwo.\n\nThree.\n', sandboxOptions)
	settle()
	click_test_id('block-1')
	type('cmd-right x')
	await waitForFieldIdle()
	press('escape')
	documentController.run('table')
	settle()
	check(
		'Format > Table with no field open goes in after the Block last edited',
		documentController.text,
		`One.\n\nTwo.x\n\n${TABLE}\n\nThree.\n`
	)
}

export async function testCoEditing(): Promise<void> {
	/**
	 * a Block's field is open with typing in it, and another program writes the same Block.
	 * editmd shows the outside change in the field at once, merged with the typing, the caret kept; a format or more
	 * typing after it then shows at once, in the field and, after Escape, in the painted Block
	 */
	let coEditRuns = 0
	/** the open field after the outside write, then after `act`, and the Document and painted Block after Escape */
	async function runAfterOutsideWrite(act: () => Promise<void>): Promise<{
		merged: unknown
		field: string[]
		fieldValue: unknown
		text: string
		kind: string | undefined
		block: unknown
	}> {
		/**
		 * a file per call: the Document a call leaves keeps its pending autosave once the window opens the next one, so
		 * that save must land in a file no later call has open, where it would merge in as an outside write
		 */
		coEditRuns++
		const coEditPath = join(sandboxDirectory, `co-edit-${coEditRuns}.md`)
		writeFileSync(coEditPath, '# Doc\n\none two three\n')
		documentController.open(coEditPath, sandboxOptions)
		settle()
		await wait(100)
		click_test_id('block-1')
		type('cmd-right z')
		await waitForFieldIdle()
		writeFileSync(coEditPath, '# Doc\n\none two three\nagent\n')
		await waitUntil(
			() => String(getProp('block-editor', 'value')).includes('agent'),
			'the outside write in the field'
		)
		await waitForFieldIdle()
		const merged = getProp('block-editor', 'value')
		await act()
		await waitForFieldIdle()
		const field = painted()
			.split('\n')
			.filter((line) => line.includes('one'))
		const fieldValue = getProp('block-editor', 'value')
		const text = documentController.text
		press('escape')
		settle()
		return {
			merged,
			field,
			fieldValue,
			text,
			kind: documentController.blocks[1]?.kind,
			block: find_test_id('block-1')?.children?.[0]?.customProps?.source
		}
	}
	const typedAfterWrite = await runAfterOutsideWrite(async () => {
		type('q')
	})
	check(
		`an outside write to the open Block shows in its field at once, merged with the typing, and typing after it lands at the caret (${JSON.stringify(typedAfterWrite)})`,
		[
			typedAfterWrite.merged,
			typedAfterWrite.field.some((line) => line.includes('threezq')),
			typedAfterWrite.text,
			String(typedAfterWrite.block).includes('threezq')
		],
		['one two threez\nagent', true, '# Doc\n\none two threezq\nagent\n', true]
	)
	const boldAfterWrite = await runAfterOutsideWrite(async () => {
		type('cmd-up right right right right shift-right shift-right shift-right')
		press('cmd-b')
	})
	const headingAfterWrite = await runAfterOutsideWrite(async () => {
		type('cmd-up')
		press('cmd-alt-2')
	})
	check(
		`after an outside write to the open Block, ⌘B and ⌥⌘2 show at once in the field and, after Escape, in the painted Block (${JSON.stringify([boldAfterWrite, headingAfterWrite])})`,
		[
			[
				boldAfterWrite.field.some((line) => line.includes('**two**')),
				boldAfterWrite.text,
				String(boldAfterWrite.block).includes('**two**')
			],
			// the paragraph holds two lines now, so Heading 2 makes it a setext heading (formatBlock)
			[headingAfterWrite.fieldValue, headingAfterWrite.text, headingAfterWrite.kind]
		],
		[
			[true, '# Doc\n\none **two** threez\nagent\n', true],
			['one two threez\nagent\n-----', '# Doc\n\none two threez\nagent\n-----\n', 'heading']
		]
	)
	/**
	 * In a window the field takes the caret keys of an outside write's merge a frame after it shows the merged text, so
	 * keys the user presses in that frame meet them: here they are handed over a frame late, and the selection made
	 * right after the write must still be the one ⌘B bolds.
	 */
	const lateCaretPath = join(sandboxDirectory, 'co-edit-late-caret.md')
	writeFileSync(lateCaretPath, '# Doc\n\none two three\n')
	documentController.open(lateCaretPath, {
		...sandboxOptions,
		sendKeys: (keys: string) => void setTimeout(() => sendKeystrokes(keys), 16)
	})
	settle()
	await wait(100)
	click_test_id('block-1')
	type('cmd-right z')
	await waitForFieldIdle()
	writeFileSync(lateCaretPath, '# Doc\n\none two three\nagent\n')
	await waitUntil(
		() => String(getProp('block-editor', 'value')).includes('agent'),
		'the outside write in the field'
	)
	type('cmd-up right right right right shift-right shift-right shift-right')
	press('cmd-b')
	await waitForFieldIdle()
	press('escape')
	settle()
	const lateCaretText = documentController.text
	check(
		`keys pressed in the frame after an outside write, before its caret keys land, keep their selection: ⌘B bolds it (${JSON.stringify(lateCaretText)})`,
		lateCaretText,
		'# Doc\n\none **two** threez\nagent\n'
	)
	/**
	 * the open field shows an agent's change marked, as editmd marks the agent's run live: a <textarea>
	 * paints no `highlight` of its own (measured headless), so the field takes the Block's agent tint and bar
	 */
	const markPath = join(sandboxDirectory, 'co-edit-mark.md')
	writeFileSync(markPath, '# Doc\n\none two three\n')
	documentController.open(markPath, sandboxOptions)
	settle()
	await wait(100)
	click_test_id('block-1')
	type('cmd-right z')
	await waitForFieldIdle()
	const fieldLookBefore = find_test_id('block-editor')?.style?.backgroundColor ?? null
	writeFileSync(markPath, '# Doc\n\none two three\nagent\n')
	await waitUntil(
		() => String(getProp('block-editor', 'value')).includes('agent'),
		'the outside write in the field'
	)
	await waitForFieldIdle()
	const markedField = find_test_id('block-editor')?.style
	press('escape')
	check(
		`an outside change to the open Block marks its field with the agent’s tint and bar (${markedField?.backgroundColor}, ${markedField?.borderColor})`,
		[fieldLookBefore, markedField?.backgroundColor, markedField?.borderColor],
		[null, getPalette()['agent-unknown-tint'], getPalette()['agent-unknown']]
	)
}

export async function testClickBelowFrontMatter(): Promise<void> {
	/**
	 * a Document of front matter only: a click on its "Start writing…" puts the caret in the empty body after the front
	 * matter, as editmd's does, so a field opens there and typing makes the body's first Block
	 */
	documentController.load('---\ntitle: a\n---\n', sandboxOptions)
	settle()
	clickIfPresent('empty-hint')
	settle()
	const bodyFieldOpen = find_test_id('block-editor') !== null
	type('x')
	press('escape')
	settle()
	check(
		'clicking “Start writing…” below front matter opens a field after it, and typing x writes the body’s first Block',
		[bodyFieldOpen, documentController.text],
		[true, '---\ntitle: a\n---\n\nx\n']
	)
}

export async function testHeadingFieldHeight(): Promise<void> {
	/**
	 * a heading's open field paints at the heading's size, so the page does
	 * not jump: the open h1 field is as tall as the closed h1's painted text, within a few px
	 */
	documentController.load('# Big heading\n\nText.\n', sandboxOptions)
	settle()
	const closedHeading = bounds(find_test_id('block-0')?.children?.[0] ?? 0)
	click_test_id('block-0')
	settle()
	await settleAfter(100)
	// an h1's field sits in the box that draws its rule, as the closed h1's text does
	const openHeading = bounds(find_test_id('block-editor-rule') ?? find_test_id('block-editor') ?? 0)
	press('escape')
	check(
		`an h1’s open field is as tall as the closed h1 (${openHeading?.height} open, ${closedHeading?.height} closed)`,
		closedHeading && openHeading ? Math.abs(openHeading.height - closedHeading.height) <= 4 : null,
		true
	)
}

export async function testSourceUndoAndBatchedCommands(): Promise<void> {
	/**
	 * editmd builds its editor anew each time Source mode turns on or off (editor.ts:303-320), its undo history with it: an
	 * edit made before the toggle, or typed in source mode, is not undone by cmd-z after it
	 */
	documentController.load('- [ ] task\n\nParagraph\n', sandboxOptions)
	settle()
	click_test_id('task-3')
	press('cmd-/')
	press('cmd-z')
	await waitForFieldIdle()
	const undoneInSource = documentController.text
	press('cmd-/')
	press('cmd-z')
	settle()
	const undoneAfterSource = documentController.text
	press('cmd-/')
	// Source mode's caret goes to the start by keys once its field has them
	await settleAfter(100)
	type('x')
	press('cmd-/')
	press('cmd-z')
	settle()
	check(
		'Source mode starts a fresh undo history both ways: a tick before Source on survives ⌘Z in Source mode and after it, and typing in Source mode survives ⌘Z after Source off',
		[undoneInSource, undoneAfterSource, documentController.text],
		['- [x] task\n\nParagraph\n', '- [x] task\n\nParagraph\n', 'x- [x] task\n\nParagraph\n']
	)

	/**
	 * editmd's `.frontmatter { padding: 0.75rem 1rem; font: 12.5px/1.55 }` with `.frontmatter:focus { box-shadow: 0 0 0 2px
	 * var(--selection) }` (style.css:73-86): the ring is drawn outside the box and takes no room. GPUI paints a <textarea>'s
	 * rows at whole px (measured headless: 19.375px rows paint 19px), so the four open lines are 1.5px shorter than the
	 * closed box's (24 + 4 × 19.375, painted 102)
	 */
	documentController.load('---\ntitle: A\ntags: [x]\n---\n\nBody\n', sandboxOptions)
	settle()
	const closedFrontmatterHeight = bounds(find_test_id('frontmatter-box-0') ?? 0)?.height
	click_test_id('block-0')
	settle()
	const openFrontmatterHeight = bounds(find_test_id('block-editor-card') ?? 0)?.height
	const openFrontmatterStyle = find_test_id('block-editor-card')?.style
	press('escape')
	check(
		'open front matter keeps the closed box’s padding, its 4 lines at GPUI’s whole-px 19px rows (100 open, 102 closed), its ring a 2px selection outline outside the box and no border',
		[
			[closedFrontmatterHeight, openFrontmatterHeight],
			openFrontmatterStyle?.outlineWidth,
			openFrontmatterStyle?.outlineColor,
			openFrontmatterStyle?.outlineOffset ?? 0,
			openFrontmatterStyle?.borderWidth ?? openFrontmatterStyle?.borderTopWidth ?? 0,
			openFrontmatterStyle?.paddingTop,
			openFrontmatterStyle?.paddingLeft
		],
		[[102, 100], 2, themeController.palette.selection, 0, 0, 12, 16]
	)

	/**
	 * editmd's `.source { font: 14px/1.6 var(--font-mono); min-height: 70vh }` (style.css:90-103): the field's line height is
	 * 22.4px, which GPUI paints at whole px (measured headless: two more lines make the field 44px taller, not 44.8px), and
	 * the field is at least 70% of the window's height
	 */
	function getSourceHeight(lines: number): number | undefined {
		documentController.load(
			`${Array.from({ length: lines }, (_line, index) => `line ${index}`).join('\n')}\n`,
			sandboxOptions
		)
		settle()
		press('cmd-/')
		settle()
		const height = bounds(find_test_id('source-editor') ?? 0)?.height
		press('cmd-/')
		return height
	}
	const sourceTall = getSourceHeight(40)
	const sourceTaller = getSourceHeight(42)
	documentController.load('Short.\n', sandboxOptions)
	settle()
	press('cmd-/')
	settle()
	const sourceStyle = find_test_id('source-editor')?.style
	const sourceShort = bounds(find_test_id('source-editor') ?? 0)?.height
	press('cmd-/')
	check(
		`Source mode’s field: line height 22.4px, painted at GPUI’s whole-px 22px rows (${sourceTall} for 41 lines, ${sourceTaller} for 43), and a minimum height of 70% of the window (${sourceShort} for one line)`,
		[
			sourceTall !== undefined && sourceTaller !== undefined
				? Math.round(((sourceTaller - sourceTall) / 2) * 100) / 100
				: null,
			sourceStyle?.lineHeight,
			sourceStyle?.minHeight,
			sourceShort !== undefined && Math.abs(sourceShort - window_size.height * 0.7) < 1
		],
		[22, 22.4, Math.round(window_size.height * 7) / 10, true]
	)

	// a block command keeps the caret where it was in the text, as editmd's ProseMirror maps it through the command
	documentController.load('- a\n- b\n- c\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	type('cmd-up down cmd-right')
	press('cmd-]')
	await waitForFieldIdle()
	type('X')
	press('escape')
	check(
		'Indent with the caret after “b” keeps the caret there: typing X after it writes `- bX`',
		documentController.text,
		'- a\n  - bX\n- c\n'
	)
	/**
	 * `burst` typed in one batch into Block 0's field of `source` from its end, then Escape at once, as fast typing ends:
	 * the field work a key of the batch started is still in flight when Escape comes
	 */
	async function escapeAfter(source: string, burst: string): Promise<string> {
		documentController.load(source, sandboxOptions)
		settle()
		click_test_id('block-0')
		type(burst)
		press('escape')
		await waitForFieldIdle()
		return documentController.text
	}
	check(
		'Tab, or Tab and `z` in one batch, at the second item’s end, then Escape at once, sink the item and keep `z` after `b`, as editmd takes the keys in order (list-item.ts:212-218)',
		[await escapeAfter('- a\n- b\n', 'tab z'), await escapeAfter('- a\n- b\n', 'tab')],
		['- a\n  - bz\n', '- a\n  - b\n']
	)
	/** a click on another Block while Tab's indent probe is still running, where Escape waits for it */
	documentController.load('- a\n- b\n\nnext\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	type('tab z')
	click_test_id('block-1')
	await waitForFieldIdle()
	settle()
	press('escape')
	await waitForFieldIdle()
	check(
		'Tab and `z` in one batch at the second item’s end, then a click on the next Block at once, sink the item and keep `z` after `b`',
		documentController.text,
		'- a\n  - bz\n\nnext\n'
	)
	/**
	 * Escape waits for Tab's indent probe, so ⌘/ pressed right after it must wait too: run first, it would open Source
	 * mode and the Escape after it would close Source mode's session, and the typing there would go nowhere.
	 */
	documentController.load('- a\n- b\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	type('tab')
	press('escape')
	press('cmd-/')
	await waitForFieldIdle()
	await wait(200)
	pump()
	type('Q')
	await waitForFieldIdle()
	const sourceAfterRace = [documentController.sourceMode, documentController.text]
	press('cmd-/')
	await waitForFieldIdle()
	check(
		`Tab, then Escape and ⌘/ at once: Source mode opens after the Escape, and typing there lands in the text (${JSON.stringify(sourceAfterRace)})`,
		[sourceAfterRace[0], String(sourceAfterRace[1]).includes('Q')],
		[true, true]
	)

	/**
	 * Bold with no field open acts at editmd's load caret, the start of the first textblock: its empty pair is a stored
	 * mark there, so closing untouched leaves the text as it was, and typing goes between the marks
	 */
	documentController.load('one\n', sandboxOptions)
	settle()
	press('cmd-b')
	await waitForFieldIdle()
	press('escape')
	const boldUntouched = documentController.text
	documentController.load('one\n', sandboxOptions)
	settle()
	press('cmd-b')
	await waitForFieldIdle()
	type('x')
	press('escape')
	check(
		'Bold with no field open: Escape at once leaves `one`, typing x writes `**x**one` at the load caret',
		[boldUntouched, documentController.text],
		['one\n', '**x**one\n']
	)

	// Tab in a table goes to the next cell and selects its text, as editmd's table keymap's goToNextCell
	documentController.load('| a | b |\n| - | - |\n| c | d |\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	type('cmd-up right right')
	press('tab')
	await waitForFieldIdle()
	type('X')
	press('escape')
	check(
		'Tab with the caret in a table’s first cell selects the second cell’s text: X replaces `b`',
		documentController.text,
		'| a | X |\n| - | - |\n| c | d |\n'
	)

	/**
	 * a block command whose outcome no caret changes still keeps the caret where it was in the text, as editmd's
	 * ProseMirror maps it through the command; syntax put in right at the caret goes before it (assoc 1)
	 */
	documentController.load('one two\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	type('cmd-up right right right')
	press('cmd-alt-2')
	await waitForFieldIdle()
	type('X')
	press('escape')
	const headingAtCaret = documentController.text
	documentController.load('one\n', sandboxOptions)
	settle()
	press('cmd-alt-2')
	await waitForFieldIdle()
	type('X')
	press('escape')
	check(
		'Heading 2 keeps the caret in the text: after “one” in `one two` typing X writes `## oneX two`; with no field open, at the load caret, `## Xone`',
		[headingAtCaret, documentController.text],
		['## oneX two\n', '## Xone\n']
	)

	/**
	 * editmd edits a code block or a diagram as its code alone: its node holds the code, and the fences are no text of its
	 * editor. `source`'s Block 0 opens: what its field shows and the preview a diagram paints then; X typed at the field's
	 * end; and, opened afresh, Return then Y. the Document's text after each
	 */
	async function editCodeField(source: string): Promise<[unknown, unknown, string, string]> {
		documentController.load(source, sandboxOptions)
		settle()
		click_test_id('block-0')
		settle()
		const value = getProp('block-editor', 'value')
		const preview = getProp('mermaid-0', 'src') ?? null
		type('X')
		await waitForFieldIdle()
		press('escape')
		const typed = documentController.text
		documentController.load(source, sandboxOptions)
		settle()
		click_test_id('block-0')
		settle()
		type('enter')
		type('Y')
		await waitForFieldIdle()
		press('escape')
		return [value, preview, typed, documentController.text]
	}
	check(
		'a ```js code Block’s field holds its code alone: X typed at its end goes before the closing fence, and Return keeps a newline in the code',
		await editCodeField('```js\nlet a = 1\n```\n'),
		['let a = 1', null, '```js\nlet a = 1X\n```\n', '```js\nlet a = 1\nY\n```\n']
	)
	check(
		'a mermaid diagram’s field holds its code alone, its live preview drawn from that code: X typed at its end goes before the closing fence, and Return keeps a newline in the code',
		await editCodeField('```mermaid\nflowchart LR\n  A --> B\n```\n'),
		[
			'flowchart LR\n  A --> B',
			getDiagramSrc('flowchart LR\n  A --> B'),
			'```mermaid\nflowchart LR\n  A --> BX\n```\n',
			'```mermaid\nflowchart LR\n  A --> B\nY\n```\n'
		]
	)
}

export async function testClipboard(): Promise<void> {
	/**
	 * Copy writes what editmd's clipboard serializer writes for the window's selection (`copiedText`): a whole
	 * paragraph as its markdown with a final newline; the pasteboard is a recorder here
	 */
	const copiedMarkdown: string[] = []
	documentController.load('One **bold** two.\n', {
		...sandboxOptions,
		writeClipboard: (text: string) => {
			copiedMarkdown.push(text)
			return true
		}
	})
	settle()
	const boldParagraph = bounds(find_test_id('block-0') ?? 0)
	const boldSelected = boldParagraph
		? drag_select(
				{ x: boldParagraph.x + 1, y: boldParagraph.y + boldParagraph.height / 2 },
				{
					x: boldParagraph.x + boldParagraph.width - 1,
					y: boldParagraph.y + boldParagraph.height / 2
				}
			)
		: null
	settle()
	press('cmd-c')
	settle()
	check(
		`⌘C over a whole \`One **bold** two.\` paragraph copies its markdown with a final newline, as editmd’s serializer (selected ${JSON.stringify(boldSelected)})`,
		copiedMarkdown,
		['One **bold** two.\n']
	)

	// editmd's `li::marker` is no selectable text, so a drag over an ordered list reads its items' text alone
	documentController.load('1. one\n2. two\n', sandboxOptions)
	settle()
	const orderedList = bounds(find_test_id('block-0') ?? 0)
	if (orderedList) {
		drag_select(
			{ x: orderedList.x + 1, y: orderedList.y + 4 },
			{ x: orderedList.x + orderedList.width - 1, y: orderedList.y + orderedList.height - 4 }
		)
	}
	settle()
	check(
		'a drag over an ordered list `1. one`, `2. two` selects `one` and `two` without their numbers',
		get_native()?.getSelectedText() ?? null,
		'one\ntwo'
	)

	/**
	 * editmd pastes at its caret, so Paste with no field open, from Edit and by ⌘V, opens the field at the load caret
	 * and sends it ⌘V (`sendKeys`, a recorder here, so no paste reads a pasteboard)
	 */
	const pasteKeys: string[] = []
	const pasteOptions = { ...sandboxOptions, sendKeys: (keys: string) => void pasteKeys.push(keys) }
	/** what `paste` does with no field open: the field it opens, whether one shows, and whether the last keys sent end in ⌘V */
	async function pasteWithNoField(paste: () => void) {
		// past the 300ms in which the window takes a ⌘V as the echo of one a command sent (`ECHO_MS`); the recorder sends none
		await wait(350)
		documentController.load('First\n\nSecond\n', pasteOptions)
		settle()
		pasteKeys.length = 0
		paste()
		await wait(100)
		pump()
		const result = [
			documentController.activeIndex,
			find_test_id('block-editor') !== null,
			pasteKeys.at(-1)?.endsWith('cmd-v') ?? false
		]
		press('escape')
		settle()
		return result
	}
	const pastedFromMenu = await pasteWithNoField(() => {
		openMenu('Edit')
		clickRow('Paste')
	})
	const pastedByKey = await pasteWithNoField(() => press('cmd-v'))
	check(
		'with no field open, Edit > Paste and ⌘V each open the field at the load caret, which then gets ⌘V',
		[pastedFromMenu, pastedByKey],
		[
			[0, true, true],
			[0, true, true]
		]
	)
}
