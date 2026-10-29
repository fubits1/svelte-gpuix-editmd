/**
 * every expected value is what editmd 9e889e6 wrote for the same source and command: its own
 * `MarkdownEditor` run under its happy-dom test setup, the caret at the end of the Block (where the
 * port's field puts it), then serialized. a null is a command
 * editmd refused (`run` returned false), so the source stays as it is
 */

import { describe, expect, test } from 'vitest'
import { firstTextOffset, formatBlock, type BlockFormat } from './formatBlock.ts'

type Case = [format: BlockFormat, source: string, expected: string | null]

const TWO_LINES = 'line one\nline two'
const CODE = '```js\nx = 1\n```'
const MERMAID = '```mermaid\ngraph TD\nA-->B\n```'
const TABLE = '| a | b |\n| - | - |\n| c | d |'

const check = (cases: Case[]) =>
	test.each(cases)('%s on %j gives %j', (format, source, expected) => {
		expect(formatBlock(format, source)).toBe(expected)
	})

describe('a paragraph', () => {
	check([
		['heading2', 'title', '## title'],
		['heading2', 'one **bold** two', '## one **bold** two'],
		// a heading of more than one line is written setext up to level 2, underlined as long as its last line
		['heading1', TWO_LINES, 'line one\nline two\n========'],
		['heading2', TWO_LINES, 'line one\nline two\n--------'],
		['heading2', 'a long first line\nb', 'a long first line\nb\n-'],
		// from level 3 the line break stays in the text, so only the first line ends up a heading
		['heading4', TWO_LINES, '#### line one\nline two'],
		['body', TWO_LINES, null],
		// one item, the next lines indented under it
		['bulletList', TWO_LINES, '- line one\n  line two'],
		['bulletList', 'one **bold**\ntwo', '- one **bold**\n  two'],
		['numberedList', TWO_LINES, '1. line one\n   line two'],
		['quote', TWO_LINES, '> line one\n> line two'],
		// editmd's code block takes the text without its line breaks
		['codeBlock', TWO_LINES, '```\nline oneline two\n```'],
		['codeBlock', 'a ``` b', '````\na ``` b\n````'],
		// code holds no marks: editmd keeps the text and drops them (measured in editmd's own editor)
		['codeBlock', 'one **bold** two', '```\none bold two\n```'],
		['codeBlock', 'a [link](https://e.example) and `x`', '```\na link and x\n```'],
		['indent', TWO_LINES, null],
		['outdent', TWO_LINES, null],
		['heading2', '<div>hi</div>', '## <div>hi</div>']
	])
})

describe('a heading', () => {
	check([
		['heading3', '## title', '### title'],
		['heading2', '## title', null],
		['heading3', 'title\n=====', '### title'],
		['heading1', 'title\n=====', null],
		['heading2', '# Title #', '## Title'],
		['body', 'title\n---', 'title'],
		['body', '## title', 'title'],
		['quote', '## title', '> ## title'],
		['codeBlock', '## title', '```\ntitle\n```'],
		['bulletList', '## title', null],
		['numberedList', '## title', null]
	])
})

describe('a code block or diagram', () => {
	check([
		['heading2', CODE, '## x = 1'],
		['heading1', '```js\nx = 1\ny = 2\n```', '# x = 1 y = 2'],
		['heading2', MERMAID, '## graph TD A-->B'],
		['body', CODE, 'x = 1'],
		['body', MERMAID, 'graph TD A-->B'],
		['quote', CODE, '> ```js\n> x = 1\n> ```'],
		['quote', MERMAID, '> ```mermaid\n> graph TD\n> A-->B\n> ```'],
		// Code Block on a fenced block drops its language, and does nothing without one
		['codeBlock', CODE, '```\nx = 1\n```'],
		['codeBlock', '~~~py\nx\n~~~', '```\nx\n```'],
		['codeBlock', '```\nhas ``` fence\n```', null],
		['codeBlock', '    indented code', null],
		['heading2', '    indented code', '## indented code'],
		['bulletList', CODE, null],
		['numberedList', CODE, null]
	])
})

describe('a list: only Indent and Outdent act, on the last item', () => {
	check([
		['bulletList', '- a\n- b', null],
		['numberedList', '- a\n- b', null],
		['bulletList', '1. a\n2. b', null],
		['quote', '- a\n- b', null],
		['codeBlock', '- a\n- b', null],
		['body', '- a\n- b', null],
		['heading2', '- [ ] a\n- [x] b', null],
		['indent', '- a\n- b', '- a\n  - b'],
		['indent', '- a\n- b\n- c', '- a\n- b\n  - c'],
		['indent', '- a\n  - b\n  - c', '- a\n  - b\n    - c'],
		['indent', '1. a\n2. b', '1. a\n   1. b'],
		['indent', '- [ ] a\n- [ ] b', '- [ ] a\n  - [ ] b'],
		// a loose list keeps the blank line before the item
		['indent', '- a\n\n  more\n- b', '- a\n\n  more\n\n  - b'],
		// the first item of its list has no item to go under
		['indent', '- a', null],
		['indent', '- a\n  - b', null],
		['outdent', '- a\n  - b\n  - c', '- a\n  - b\n- c'],
		['outdent', '1. a\n   1. b', '1. a\n2. b'],
		// out of a top-level list it becomes a paragraph, its checkbox gone
		['outdent', '- a\n- b', '- a\n\nb'],
		['outdent', '- a\n- b\n  more', '- a\n\nb\nmore'],
		['outdent', '3. a\n4. b', '3. a\n\nb'],
		['outdent', '- [ ] a\n- [ ] b', '- [ ] a\n\nb']
	])
})

describe('a quote: the command acts on its last paragraph', () => {
	check([
		['heading2', '> q', '> ## q'],
		['heading2', '> q one\n> q two', '> q one\n> q two\n> -----'],
		['heading2', '> one\n>\n> two', '> one\n>\n> ## two'],
		['quote', '> q', '> > q'],
		['quote', '> one\n>\n> two', '> one\n>\n> > two'],
		['bulletList', '> q', '> - q'],
		['codeBlock', '> q', '> ```\n> q\n> ```'],
		['body', '> q', null]
	])
})

describe('a footnote definition: the command acts on its text', () => {
	check([
		['heading2', '[^1]: note here', '[^1]: ## note here'],
		['quote', '[^1]: note here', '[^1]: > note here']
	])
})

// the caret where the field has it (core/fieldSelection.ts's probe), just after `needle`; editmd's outputs with its caret there
describe('the caret inside the Block: a list or quote command acts on the item or paragraph it is in', () => {
	test.each([
		['indent', '- a\n- b\n- c', 'b', '- a\n  - b\n- c'],
		['outdent', '- a\n  - b\n  - c', 'b', '- a\n- b\n  - c'],
		['outdent', '- a\n  - b\n  - c\n- d', 'b', '- a\n- b\n  - c\n- d'],
		['outdent', '- a\n- b\n- c', 'b', '- a\n\nb\n\n- c'],
		['outdent', '- a\n- b\n- c', 'a', 'a\n\n- b\n- c'],
		['indent', '- a\n- b\n  - x\n- c', 'b', '- a\n  - b\n    - x\n- c'],
		['indent', '1. a\n2. b\n3. c', 'b', '1. a\n   1. b\n2. c'],
		['heading2', '> one\n>\n> two\n>\n> three', 'two', '> one\n>\n> ## two\n>\n> three'],
		['codeBlock', '> one\n>\n> two', 'one', '> ```\n> one\n> ```\n>\n> two'],
		['bulletList', '> one\n>\n> two', 'one', '> - one\n>\n> two'],
		// out of a top-level list, the item's own nested items stay a list after it, and the rest count on from its number
		['outdent', '- a\n  - b\n  - c', 'a', 'a\n\n- b\n- c'],
		['outdent', '1. a\n   1. b', 'a', 'a\n\n1. b'],
		['outdent', '3. a\n4. b', 'a', 'a\n\n3. b']
	] as const)('%s on %j after %j gives %j', (format, source, needle, expected) => {
		expect(formatBlock(format, source, source.indexOf(needle) + needle.length)).toBe(expected)
	})
})

// a loaded document's caret: ProseMirror's first cursor spot, the start of the first textblock's text (editmd focuses
// its editor on load, main.ts:80-84), which a command acts at when no field is open
describe('firstTextOffset: where a Block’s text starts, past its markers', () => {
	test.each([
		['line one', 0],
		['## title', 3],
		['- a\n- b', 2],
		['- [ ] a', 6],
		['> q', 2],
		['```js\nx = 1\n```', 6],
		['    indented', 4],
		['| a | b |\n| - | - |\n| c | d |', 2],
		['1. one', 3],
		// editmd shows raw HTML as a paragraph of its source, so its caret starts there
		['<div>hi</div>', 0]
	] as const)('%j starts at %i', (source, expected) => {
		expect(firstTextOffset(source)).toBe(expected)
	})

	// a rule, a definition or front matter holds no caret; editmd's caret starts in the next textblock
	test('a Block with no text to hold a caret has none', () => {
		expect(
			['---', '[x]: https://e.example', '---\ntitle: a\n---'].map((source) =>
				firstTextOffset(source)
			)
		).toEqual([null, null, null])
	})
})

describe('Blocks no Format command changes', () => {
	const formats: BlockFormat[] = [
		'body',
		'heading2',
		'bulletList',
		'numberedList',
		'indent',
		'outdent',
		'quote',
		'codeBlock'
	]
	test.each([
		['a table', TABLE],
		['a link reference definition', '[x]: https://e.example'],
		['front matter', '---\ntitle: a\n---'],
		['a rule', '---']
	])('%s', (_, source) => {
		expect(formats.map((format) => formatBlock(format, source))).toEqual(formats.map(() => null))
	})
})
