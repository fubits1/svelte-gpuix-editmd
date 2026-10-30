/**
 * editmd marks a Block that kept its kind with one inline range per changed paragraph or item, from the first
 * difference in its text to the last, and a Block of another kind as a whole (web/src/changes.ts:28-74); the port
 * paints the range as a wash over the Block's painted text, found by its text and which occurrence of it it is
 */

import { describe, expect, test } from 'vitest'
import { blockChange, describedText, linkRunsOf, runOffset } from './changedText.ts'

const changedText = (before: string, after: string) => blockChange(before, after)?.runs ?? null

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
		expect(changedText('one  \ntwo', 'ONE  \nTWO')).toEqual([
			{ text: 'ONE', index: 0 },
			{ text: 'TWO', index: 0 }
		])
	})

	// editmd's compareChildren gives a new child, or one that became another node (a ticked task), a `block` change: the
	// item takes the tint and bar, its text no wash (changes.ts:38-40, 49-50)
	test('a new item or quote paragraph is marked whole: its run says so', () => {
		expect([
			changedText('- a\n- b', '- a\n- new\n- b, too'),
			changedText('> one', '> one\n>\n> two')
		]).toEqual([
			[
				{ text: 'new', index: 0 },
				{ text: 'b, too', index: 0, whole: true }
			],
			[{ text: 'two', index: 0, whole: true }]
		])
	})

	// editmd's `deleted` change at the child after the removed ones, which it paints as a line between them
	// (changes.ts:41-44, highlights.ts:189-196)
	test('items or quote paragraphs taken away leave a gap before the child after them, or at the end', () => {
		const gapsOf = (before: string, after: string) => blockChange(before, after)?.gaps
		expect([
			gapsOf('- a\n- b\n- c', '- a\n- c'),
			gapsOf('- a\n- b', '- a'),
			gapsOf('> one\n>\n> two', '> two'),
			gapsOf('- a\n- b\n- c', '- a\n- B'),
			gapsOf('one two', 'one')
		]).toEqual([
			[{ text: 'b', before: { text: 'c', index: 0 } }],
			[{ text: 'b', before: null }],
			[{ text: 'one', before: { text: 'two', index: 0 } }],
			[{ text: 'c', before: null }],
			[]
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

	// an image paints no text, a hard break is a line of its own, a footnote reference paints its label in brackets,
	// and a reference link carries the definition it names as its mark
	test('images, hard breaks, footnote references and reference links compare as they paint', () => {
		expect([
			changedText('see ![a](x.png) here', 'see ![b](y.png) here'),
			changedText('one  \ntwo', 'ONE  \nTWO'),
			changedText('see[^1] x\n\n[^1]: n\n', 'see[^2] x\n\n[^2]: n\n'),
			changedText(
				'see [docs][a]\n\n[a]: https://a.example\n',
				'see [docs][b]\n\n[b]: https://b.example\n'
			)
		]).toEqual([
			[],
			[
				{ text: 'ONE', index: 0 },
				{ text: 'TWO', index: 0 }
			],
			[{ text: '2', index: 0 }],
			[{ text: 'docs', index: 0 }]
		])
	})

	// editmd compares a list or a quote child by child (compareChildren, changes.ts:28-56), so an item or paragraph
	// between two changed ones is not marked
	test('an unchanged item or quote paragraph between two changed ones is not marked', () => {
		const changedEnds = [
			{ text: 'ONE', index: 0 },
			{ text: 'THREE', index: 0 }
		]
		expect([
			changedText('- one\n- two\n- three', '- ONE\n- two\n- THREE'),
			changedText('> one\n>\n> two\n>\n> three', '> ONE\n>\n> two\n>\n> THREE')
		]).toEqual([changedEnds, changedEnds])
	})

	// editmd's legend counts each change `changes` reports (highlights.ts:145-150): one per changed paragraph or item,
	// one per new item, one per run of removed items
	test('a Block counts each change editmd reports in it', () => {
		const changesIn = (before: string, after: string) => blockChange(before, after)?.changes
		expect([
			changesIn('one two', 'one TWO'),
			changesIn('- one\n- two\n- three', '- ONE\n- two\n- THREE'),
			changesIn('- a\n- b\n- c\n- d', '- a\n- B\n- new'),
			changesIn('- a\n- b\n- c', '- a')
		]).toEqual([1, 2, 3, 1])
	})

	// editmd's reveal stops at each change (highlights.ts:131-142): the first run of each change is where it stops
	test('each change names the run it starts with', () => {
		expect([
			blockChange('- one\n- two\n- three', '- ONE\n- two\n- THREE')?.firsts,
			blockChange('one two', 'one TWO')?.firsts
		]).toEqual([[0, 1], [0]])
	})

	// a view paints a list's items and a quote's children as rows by their source offsets, so it places a run by where
	// its text starts in the Block's source
	test('a run’s start in the Block’s source, by its text and occurrence', () => {
		expect([
			runOffset('- a\n- new\n- b', { text: 'new', index: 0 }),
			runOffset('> one\n>\n> two', { text: 'two', index: 0 }),
			runOffset('- x\n- x', { text: 'x', index: 1 }),
			runOffset('- **bold** b', { text: 'b', index: 1 }),
			runOffset('- a', { text: 'zz', index: 0 })
		]).toEqual([6, 10, 6, 11, null])
	})

	// editmd turns the pointer to a hand only over a link while ⌘ is held (style.css:178-181), so the view needs each
	// link's painted text to find its rects, in the run convention the Agent washes use
	test('each link’s painted text, as a run of the Block’s painted text', () => {
		expect([
			linkRunsOf('see [a link](u) and [b](v)'),
			linkRunsOf('[x](u) x [x](v)'),
			linkRunsOf('[**b** c](u) d'),
			// as the view renders a Block: its definitions after it (`renderSource`)
			linkRunsOf('[t][r] and <https://a.example>\n\n[r]: https://r.example'),
			linkRunsOf('no links here')
		]).toEqual([
			[
				{ text: 'a link', index: 0 },
				{ text: 'b', index: 0 }
			],
			[
				{ text: 'x', index: 0 },
				{ text: 'x', index: 2 }
			],
			[{ text: 'b c', index: 0 }],
			[
				{ text: 't', index: 0 },
				{ text: 'https://a.example', index: 0 }
			],
			[]
		])
	})

	// a ticked task is another node to editmd (sameAttrs, changes.ts:49), so its item is marked
	test('a task ticked off marks its item whole', () => {
		expect(changedText('- [ ] a\n- [ ] b', '- [x] a\n- [ ] b')).toEqual([
			{ text: 'a', index: 0, whole: true }
		])
	})

	// editmd's `describe` (changes.ts:95-98): a node's textContent, a hard break a line, else its type in brackets
	test('a removed Block is described by its text, or by its kind when it has none', () => {
		expect([
			describedText('one  \ntwo'),
			describedText('-\n'),
			describedText('1.\n'),
			describedText('```\n```'),
			describedText('')
		]).toEqual(['one\ntwo', '(bullet list)', '(ordered list)', '(code block)', ''])
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
		const removedText = (before: string, after: string) =>
			blockChange(before, after)?.removed ?? null
		expect([
			removedText('one two', 'one'),
			removedText('one *two* three', 'one three'),
			removedText('one two', 'one TWO'),
			removedText('Title', '# Title')
		]).toEqual([' two', 'two ', null, null])
	})
})
