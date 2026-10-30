/**
 * editmd's Return is ProseMirror's base keymap, which Milkdown keeps (core/src/internal-plugin/keymap.ts:32-41):
 * `newlineInCode`, `createParagraphNear`, `liftEmptyBlock`, `splitBlock`; in a list item `splitListItem` runs first
 * (preset-commonmark/src/node/list-item.ts:201-206). `at` is where Return's newline sits in the field
 */

import { describe, expect, test } from 'vitest'
import { returnEdit } from './returnKey.ts'

/** `field` with Return typed at the `|` */
const typed = (field: string) => {
	const at = field.indexOf('|')
	return returnEdit(`${field.slice(0, at)}\n${field.slice(at + 1)}`, at)
}

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

	// Shift-Return is a hard break (hardbreak.ts:115-118), which editmd's serializer writes as a backslash before the
	// line break (mdast-util-to-markdown lib/handle/break.js:40); in code it is the newline itself
	test('Shift-Return writes a hard break; in code the newline stays', () => {
		const shifted = (field: string) => {
			const at = field.indexOf('|')
			return returnEdit(`${field.slice(0, at)}\n${field.slice(at + 1)}`, at, true)
		}
		expect([shifted('one| two'), shifted('```\na|\n```')]).toEqual([
			{ kind: 'field', field: 'one\\\n two', caret: 5 },
			{ kind: 'newline' }
		])
	})

	test('a quote line continues as a new quote line; an empty one leaves the quote', () => {
		expect([typed('> said|'), typed('> said\n> |')]).toEqual([
			{ kind: 'field', field: '> said\n> ', caret: 9 },
			{ kind: 'split', head: '> said', tail: '' }
		])
	})
})
