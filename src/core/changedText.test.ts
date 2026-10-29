/**
 * editmd marks a Block that kept its kind with one inline range, from the first difference in its text to the
 * last, and a Block of another kind as a whole (web/src/changes.ts:48-74); the port paints the range as a wash
 * over the Block's painted text, found by its text and which occurrence of it it is
 */

import { describe, expect, test } from 'vitest'
import { changedText, removedText } from './changedText.ts'

describe('changedText', () => {
	test('a word changed in a paragraph is one run', () => {
		expect(changedText('one two three', 'one TWO three')).toEqual([{ text: 'TWO', index: 0 }])
	})

	test('the run is told apart from the same text earlier in the Block by its occurrence', () => {
		expect(changedText('x and x', 'x and x and x')).toEqual([{ text: ' and x', index: 1 }])
	})

	test('markup is left out: the run is the painted text', () => {
		expect(changedText('see *this*', 'see *that*')).toEqual([{ text: 'at', index: 0 }])
	})

	test('a change inside a list item is a run of that item', () => {
		expect(changedText('- a\n- b', '- a\n- B')).toEqual([{ text: 'B', index: 0 }])
	})

	test('a run over several painted lines is one run per line, blank ones left out', () => {
		expect(changedText('- a\n- b', '- a\n- new\n- b, too')).toEqual([
			{ text: 'new', index: 0 },
			{ text: 'b, too', index: 0 }
		])
	})

	// ProseMirror's findDiffStart/findDiffEnd compare marks as well as text, so a word made bold is a change
	test('text that only gained or lost a mark (bold, emphasis, code, a link) is a run', () => {
		expect([
			changedText('one word two', 'one **word** two'),
			changedText('one *word* two', 'one word two'),
			changedText('see docs', 'see [docs](https://a.example)'),
			changedText('see [docs](https://a.example)', 'see [docs](https://b.example)')
		]).toEqual([
			[{ text: 'word', index: 0 }],
			[{ text: 'word', index: 0 }],
			[{ text: 'docs', index: 0 }],
			[{ text: 'docs', index: 0 }]
		])
	})

	test('a Block that became another kind is marked whole: null', () => {
		expect(changedText('Title', '# Title')).toBeNull()
		expect(changedText('one', '- one')).toBeNull()
		expect(changedText('# Title', '## Title')).toBeNull()
	})

	test('text only taken away leaves no run to paint', () => {
		expect(changedText('one two', 'one')).toEqual([])
	})

	// editmd marks text taken away inside a block with its "Deleted by" marker, the removed text in its title
	// (changes.ts:71-73, highlights.ts:189-219)
	test('the text taken away is what was painted between the first difference and the last', () => {
		expect([
			removedText('one two', 'one'),
			removedText('one *two* three', 'one three'),
			removedText('one two', 'one TWO'),
			removedText('Title', '# Title')
		]).toEqual([' two', 'two ', null, null])
	})
})
