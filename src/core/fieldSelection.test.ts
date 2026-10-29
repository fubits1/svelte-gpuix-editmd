import { describe, expect, test } from 'vitest'
import {
	applyKeys,
	caretKeys,
	type FieldState,
	selectionCandidates,
	settleSelection,
	takesMarks,
	toggleInlineKeys
} from './fieldSelection.ts'

// GPUI's field moves one character per arrow, an emoji included (measured headless: `x😀yéz`,
// right right Z gives `x😀Zyéz`); the model and the keys counted UTF-16 units, so unbolding `**😀**` cut a space
describe('characters, not UTF-16 units', () => {
	test('an arrow, delete and backspace step over a whole character', () => {
		const at = (text: string, keys: string) => applyKeys({ text, anchor: 0, focus: 0 }, keys).text
		expect([
			at('x😀yéz', 'right right Z'),
			at('😀a', 'delete'),
			at('a😀', 'cmd-down backspace')
		]).toEqual(['x😀Zyéz', 'a', 'a'])
	})

	test('the keys that toggle marks and place the caret count characters', () => {
		const unbold = field('**😀** next', '😀')
		const bold = field('a 😀b c', '😀b')
		expect([
			after(unbold, toggleInlineKeys(unbold, 'bold')).text,
			after(bold, toggleInlineKeys(bold, 'bold')).text,
			caretKeys('a😀b', 3)
		]).toEqual(['😀 next', 'a **😀b** c', 'cmd-down left'])
	})
})

// editmd's Bold, Italic, Strikethrough and Inline Code refuse in code, and never reach its front matter box
// (measured in editmd's own editor; editor.ts:330-345)
test('only a Block of text takes inline marks: no code, diagram, front matter, HTML, definition or rule', () => {
	expect(
		[
			'one two',
			'## title',
			'- a\n- b',
			'> quote',
			'| a |\n| - |\n| b |',
			'```js\nx = 1\n```',
			'```mermaid\ngraph TD\n```',
			'---\ntitle: x\n---',
			'<div>x</div>',
			'[d]: https://x.example',
			'---'
		].map(takesMarks)
	).toEqual([true, true, true, true, true, false, false, false, false, false, false])
})

/** the field holding `text` with `selected` selected, left to right */
const field = (text: string, selected: string, from = 0): FieldState => {
	const start = text.indexOf(selected, from)
	return { text, anchor: start, focus: start + selected.length }
}

/** what the field shows and selects after `keys` */
const after = (state: FieldState, keys: string) => {
	const { text, anchor, focus } = applyKeys(state, keys)
	return { text, selected: text.slice(Math.min(anchor, focus), Math.max(anchor, focus)) }
}

describe('selectionCandidates', () => {
	test('a sentinel typed over the selection gives where it was', () => {
		expect(selectionCandidates('one two three', 'one two a', 'a')).toEqual([{ start: 8, end: 13 }])
	})

	test('a sentinel the text holds beside it gives every place it could have been', () => {
		// "aa" with its second a selected, the sentinel a typed over it
		expect(selectionCandidates('aa', 'aa', 'a')).toEqual([
			{ start: 0, end: 1 },
			{ start: 1, end: 2 }
		])
	})

	test('a caret with nothing selected comes back as an empty selection', () => {
		expect(selectionCandidates('abc', 'abxc', 'x')).toEqual([{ start: 2, end: 2 }])
	})

	test('a second sentinel settles it: only where both could have been', () => {
		// "abc", the caret after the first a; sentinel a gives "aabc", sentinel b gives "abbc"
		expect(
			settleSelection([
				selectionCandidates('abc', 'aabc', 'a'),
				selectionCandidates('abc', 'abbc', 'b')
			])
		).toEqual({ start: 1, end: 1 })
	})

	test('a report that could not come from typing one character over the text settles nothing', () => {
		expect(settleSelection([selectionCandidates('abc', 'xyz!', 'x')])).toBeNull()
	})
})

describe('applyKeys, the field as GPUI moves it in a real window', () => {
	test('characters replace the selection; left and right collapse it; delete is forward', () => {
		expect([
			after(field('one two three', 'two'), 'x'),
			after(field('one two three', 'two'), 'left x'),
			after(field('one two three', 'two'), 'right x'),
			after(field('one two three', ''), 'delete'),
			after(field('one two three', ''), 'backspace')
		]).toEqual([
			{ text: 'one x three', selected: '' },
			{ text: 'one xtwo three', selected: '' },
			{ text: 'one twox three', selected: '' },
			{ text: 'ne two three', selected: '' },
			{ text: 'one two three', selected: '' }
		])
	})

	test('shift moves the selection’s moving end', () => {
		expect(after(field('one two three', '', 4), 'shift-right shift-right shift-right')).toEqual({
			text: 'one two three',
			selected: 'two'
		})
	})
})

describe('caretKeys', () => {
	test('puts the caret at an offset from the nearer end of the field', () => {
		const text = 'abcdefghij'
		const moved = (at: number) => {
			const keys = caretKeys(text, at)
			return [applyKeys({ text, anchor: 3, focus: 7 }, keys).focus, keys.split(' ').length]
		}
		expect([moved(2), moved(9), moved(0), moved(10)]).toEqual([
			[2, 3],
			[9, 2],
			[0, 1],
			[10, 1]
		])
	})

	// measured 0.5ms a key: an arrow per character put a caret 5000 characters in after 2.5s. GPUI's
	// alt-left and alt-right jump by Unicode word segment (`split_word_bound_indices`, whitespace skipped)
	test('jumps by word over Latin text, so a caret deep in a long text takes a few hundred keys, not thousands', () => {
		const text = 'The quick brown fox, jumps over the lazy dog. '.repeat(120)
		const at = 2700
		const keys = caretKeys(text, at)
		const placed = applyKeys({ text, anchor: 0, focus: 0 }, keys)
		expect([placed.focus, placed.anchor, keys.split(' ').length < 800]).toEqual([at, at, true])
	})

	test('a word jump stops where a word ends and starts, as GPUI’s word moves do, and never crosses other scripts', () => {
		const model = (text: string, keys: string, at = 0) =>
			applyKeys({ text, anchor: at, focus: at }, keys).focus
		const cjk = '中文字符测试'.repeat(10)
		expect([
			model('one two, three', 'alt-right'),
			model('one two, three', 'alt-right alt-right alt-right'),
			model('one two, three', 'alt-left', 14),
			model('one two, three', 'alt-left alt-left', 14),
			caretKeys(cjk, 30).includes('alt-')
		]).toEqual([3, 8, 9, 7, false])
	})
})

// what editmd's Format > Bold, Italic, Strikethrough and Inline Code write (Milkdown toggles, serialized with
// strong `**`, emphasis `_`, editor.ts:82-99); measured in editmd's own editor
describe('toggleInlineKeys', () => {
	test('wraps the selection in the format’s marks and keeps it selected', () => {
		const state = field('one two three', 'two')
		expect([
			after(state, toggleInlineKeys(state, 'bold')),
			after(state, toggleInlineKeys(state, 'italic')),
			after(state, toggleInlineKeys(state, 'strikethrough')),
			after(state, toggleInlineKeys(state, 'code'))
		]).toEqual([
			{ text: 'one **two** three', selected: 'two' },
			{ text: 'one _two_ three', selected: 'two' },
			{ text: 'one ~~two~~ three', selected: 'two' },
			{ text: 'one `two` three', selected: 'two' }
		])
	})

	test('takes the marks off a selection inside them, or holding them', () => {
		const inside = field('one **two** three', 'two')
		const holding = field('one **two** three', '**two**')
		expect([
			after(inside, toggleInlineKeys(inside, 'bold')),
			after(holding, toggleInlineKeys(holding, 'bold'))
		]).toEqual([
			{ text: 'one two three', selected: 'two' },
			{ text: 'one two three', selected: 'two' }
		])
	})

	// editmd's editor reads `*x*`, `__x__` and `~x~` as the same marks and takes them off (e-inline-format);
	// a `*` that belongs to `**` is not italic's
	test('takes off the marks however they are spelled, and leaves a longer run alone', () => {
		const cases = [
			[field('one *two* three', 'two'), 'italic'],
			[field('one __two__ three', 'two'), 'bold'],
			[field('one ~two~ three', 'two'), 'strikethrough'],
			[field('one **two** three', 'two'), 'italic']
		] as const
		expect(
			cases.map(([state, format]) => after(state, toggleInlineKeys(state, format)).text)
		).toEqual(['one two three', 'one two three', 'one two three', 'one **_two_** three'])
	})

	// editmd's mark leaves the spaces at a selection's ends outside it: `**two **` would not be bold
	test('wraps the text of a selection, the spaces at its ends left outside the marks', () => {
		const state = field('one two three', 'two ')
		expect(after(state, toggleInlineKeys(state, 'bold'))).toEqual({
			text: 'one **two** three',
			selected: 'two'
		})
	})

	test('with nothing selected the marks go in around the caret, so typing goes between them', () => {
		const caret = field('one ', '', 4)
		expect(after(caret, `${toggleInlineKeys(caret, 'bold')} x`)).toEqual({
			text: 'one **x**',
			selected: ''
		})
	})

	test('a selection made right to left wraps the same', () => {
		const { text, anchor, focus } = field('one two three', 'two')
		const backwards = { text, anchor: focus, focus: anchor }
		expect(after(backwards, toggleInlineKeys(backwards, 'bold'))).toEqual({
			text: 'one **two** three',
			selected: 'two'
		})
	})
})
