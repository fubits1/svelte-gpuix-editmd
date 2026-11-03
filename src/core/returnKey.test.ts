/**
 * editmd's Return is ProseMirror's base keymap, which Milkdown keeps (core/src/internal-plugin/keymap.ts:32-41):
 * `newlineInCode`, `createParagraphNear`, `liftEmptyBlock`, `splitBlock`; in a list item `splitListItem` runs first
 * (preset-commonmark/src/node/list-item.ts:201-206). `at` is where Return's newline sits in the field
 */

import { describe, expect, test } from 'vitest'
import { backspaceEdit, joinedBlocks, returnAfterTyping, returnEdit } from './returnKey.ts'

/**
 * a person types on after Return before the field's newline lands: gpuix hands Return over as a submit, and the
 * newline the port types for it arrives after keys already on their way (measured in a real window: `enter n e x t`
 * in one batch left `Hello worldnext` plus the newline). what was typed after Return belongs after it
 */
describe('returnAfterTyping', () => {
	// `base` the field at Return, `before` its last report before the newline, `field` the report bringing the newline
	test('where Return was, and the keys typed after it: text, and Backspaces it took back', () => {
		expect([
			returnAfterTyping('Hello world', 'Hello worldnext', 'Hello worldnext\n'),
			returnAfterTyping('Hello world', 'Hello world', 'Hello\n world'),
			returnAfterTyping('- one\n- two', '- one\n- twothree', '- one\n- twothree\n'),
			// measured in a real window: one batch `enter backspace !` on `- two` left `- tw!` before the newline came
			returnAfterTyping('- one\n- two', '- one\n- tw!', '- one\n- tw!\n')
		]).toEqual([
			{ at: 11, typed: 'next', deleted: 0 },
			{ at: 5, typed: '', deleted: 0 },
			{ at: 11, typed: 'three', deleted: 0 },
			{ at: 11, typed: '!', deleted: 1 }
		])
	})

	test('no newline added, or one that replaced a selection, is no Return to place', () => {
		expect([
			returnAfterTyping('Hello world', 'Hello worldnext', 'Hello worldnext'),
			returnAfterTyping('Hello world', 'Hello world', 'Hello\n')
		]).toEqual([null, null])
	})
})

/** `field` with Return typed at the `|` */
const typed = (field: string) => {
	const at = field.indexOf('|')
	return returnEdit(`${field.slice(0, at)}\n${field.slice(at + 1)}`, at)
}

/**
 * editmd's Backspace at the start of a list item is `joinBackward` (preset-commonmark list-item.ts:167-181): the item
 * joins the one above as a paragraph of it, so a new empty bullet goes and the caret stays on its line, indented
 * under the item (run in editmd's own editor: `- two`, Enter, Backspace, `!` writes `- two\n\n  !`)
 */
describe('backspaceEdit', () => {
	test('Backspace at an item’s start joins it to the item above as its paragraph; an empty one leaves its line', () => {
		expect([
			backspaceEdit('- one\n- two', '- one\n-two'),
			backspaceEdit('- one\n- two\n- ', '- one\n- two\n-'),
			backspaceEdit('1. one\n2. two', '1. one\n2.two'),
			backspaceEdit('- [ ] one\n- [ ] two', '- [ ] one\n- [ ]two')
		]).toEqual([
			{ field: '- one\n\n  two', caret: 9 },
			{ field: '- one\n- two\n\n  ', caret: 15 },
			{ field: '1. one\n\n   two', caret: 11 },
			// the item's indent is its marker's, the task box left out
			{ field: '- [ ] one\n\n  two', caret: 13 }
		])
	})

	// editmd: `- one` with the caret before `one`, Backspace, writes `one`
	test('Backspace at the list’s first item lifts it out of the list', () => {
		expect(backspaceEdit('- one', '-one')).toEqual({ field: 'one', caret: 0 })
	})

	test('any other Backspace is the field’s own', () => {
		expect([
			backspaceEdit('- one\n- two', '- one\n- tw'),
			backspaceEdit('one two', 'onetwo')
		]).toEqual([null, null])
	})
})

// editmd's Backspace at a paragraph's start joins its text onto the Block above (joinBackward; run in editmd's own
// editor: `one`/`two` gives `onetwo`, `# Title`/`two` gives `# Titletwo`, `- one`/`two` `- onetwo`, `> q`/`two` `> qtwo`)
describe('joinedBlocks', () => {
	test('a paragraph or heading joins its text onto the end of the Block above, the caret where they meet', () => {
		expect([
			joinedBlocks('one', 'two'),
			joinedBlocks('# Title', 'two'),
			joinedBlocks('- one', 'two'),
			joinedBlocks('> q', 'two'),
			joinedBlocks('one', '## Two')
		]).toEqual([
			{ source: 'onetwo', caret: 3 },
			{ source: '# Titletwo', caret: 7 },
			{ source: '- onetwo', caret: 5 },
			{ source: '> qtwo', caret: 3 },
			{ source: 'oneTwo', caret: 3 }
		])
	})

	test('a Block above that holds no text to join, or a Block that is no paragraph or heading, joins nothing', () => {
		expect([joinedBlocks('---', 'two'), joinedBlocks('one', '- two')]).toEqual([null, null])
	})
})

describe('returnEdit', () => {
	test('a paragraph splits at the caret into two Blocks (splitBlock)', () => {
		expect(typed('one| two')).toEqual({ kind: 'split', head: 'one', tail: ' two' })
	})

	test("Return at a heading's end ends the heading; the new Block is an empty paragraph", () => {
		expect(typed('# Title|')).toEqual({ kind: 'split', head: '# Title', tail: '' })
	})

	// splitBlock keeps the node's type for a split inside it: both halves are headings of the same level
	test('Return inside a heading splits it into two headings', () => {
		expect(typed('## One |Two')).toEqual({ kind: 'split', head: '## One ', tail: '## Two' })
	})

	test('in code, mermaid and front matter the newline stays (newlineInCode)', () => {
		expect([
			typed('```js\nlet a|\n```'),
			typed('```mermaid\nflowchart LR|\n```'),
			typed('---\ntitle: a|\n---')
		]).toEqual([{ kind: 'newline' }, { kind: 'newline' }, { kind: 'newline' }])
	})

	// a table's Enter is `exitTable` (preset-gfm table/input.ts:247-253): the table stays whole, a paragraph follows
	test('Return in a table leaves it: the table stays as it was and an empty paragraph follows; Shift-Return keeps its newline', () => {
		const table = '| a | b |\n| - | - |\n| c | d |'
		// a table is full of `|`, so the newline's place is given as an offset
		const at = table.indexOf('c') + 1
		const inCell = `${table.slice(0, at)}\n${table.slice(at)}`
		expect([
			returnEdit(inCell, at),
			returnEdit(`${table}\n`, table.length),
			returnEdit(inCell, at, true)
		]).toEqual([
			{ kind: 'split', head: table, tail: '' },
			{ kind: 'split', head: table, tail: '' },
			{ kind: 'newline' }
		])
	})

	test('a list item continues as a new item with the same marker, the rest of the line in it (splitListItem)', () => {
		expect([typed('- one|'), typed('- one| two'), typed('  * nested|')]).toEqual([
			{ kind: 'field', field: '- one\n- ', caret: 8 },
			{ kind: 'field', field: '- one\n-  two', caret: 8 },
			{ kind: 'field', field: '  * nested\n  * ', caret: 15 }
		])
	})

	test('an ordered item continues with the next number, a task with an open box', () => {
		expect([typed('1. one|'), typed('9) nine|'), typed('- [x] done|')]).toEqual([
			{ kind: 'field', field: '1. one\n2. ', caret: 10 },
			{ kind: 'field', field: '9) nine\n10) ', caret: 12 },
			{ kind: 'field', field: '- [x] done\n- [ ] ', caret: 17 }
		])
	})

	test('Return on an empty item leaves the list: the item goes and a paragraph follows (liftEmptyBlock)', () => {
		expect([typed('- one\n- |'), typed('- one\n- [ ] |')]).toEqual([
			{ kind: 'split', head: '- one', tail: '' },
			{ kind: 'split', head: '- one', tail: '' }
		])
	})

	const shifted = (field: string) => {
		const at = field.indexOf('|')
		return returnEdit(`${field.slice(0, at)}\n${field.slice(at + 1)}`, at, true)
	}

	// Shift-Return is a hard break (hardbreak.ts:115-118), which editmd's serializer writes as a backslash before the
	// line break (mdast-util-to-markdown lib/handle/break.js:40); a code block takes no hard break, so in code it does
	// nothing (run in editmd's own editor: ```` ```js\nx\n``` ````, Shift-Return, `y` writes `xy`)
	test('Shift-Return writes a hard break; in code it does nothing', () => {
		expect([shifted('one| two'), shifted('```\na|\n```')]).toEqual([
			{ kind: 'field', field: 'one\\\n two', caret: 5 },
			{ kind: 'field', field: '```\na\n```', caret: 5 }
		])
	})

	// the line after a hard break in a list item is indented to the item's text, its task box left out, and in a
	// quote it keeps the quote's marks (run in editmd's own editor)
	test('Shift-Return in a list item indents the next line to its text; in a quote it keeps the marks', () => {
		expect([
			shifted('- one\n- two|'),
			shifted('1. one\n2. two|'),
			shifted('- [ ] one|'),
			shifted('- one\n  - inner|'),
			shifted('1. one\n2. two\\\n   x|'),
			shifted('> quoted|')
		]).toEqual([
			{ kind: 'field', field: '- one\n- two\\\n  ', caret: 15 },
			{ kind: 'field', field: '1. one\n2. two\\\n   ', caret: 18 },
			{ kind: 'field', field: '- [ ] one\\\n  ', caret: 13 },
			{ kind: 'field', field: '- one\n  - inner\\\n    ', caret: 21 },
			{ kind: 'field', field: '1. one\n2. two\\\n   x\\\n   ', caret: 24 },
			{ kind: 'field', field: '> quoted\\\n> ', caret: 12 }
		])
	})

	// splitListItem splits the item the caret is in wherever its line is: `1. one\n2. two`, Shift-Return, `x`, Return,
	// `y` writes `3. y` in editmd's own editor
	test('Return on the line after a hard break in a list item starts the next item', () => {
		expect(typed('1. one\n2. two\\\n   x|')).toEqual({
			kind: 'field',
			field: '1. one\n2. two\\\n   x\n3. ',
			caret: 23
		})
	})

	// splitBlock in a quote makes a new paragraph in it (run in editmd's own editor: `> quoted`, Return, `more` writes
	// `> quoted\n>\n> more`); Return on that empty paragraph leaves the quote (`> quoted`, Return, Return, `after`)
	test('Return in a quote starts a new paragraph in it; on an empty one it leaves the quote', () => {
		expect([typed('> said|'), typed('> said\n>\n> |')]).toEqual([
			{ kind: 'field', field: '> said\n>\n> ', caret: 11 },
			{ kind: 'split', head: '> said', tail: '' }
		])
	})
})
