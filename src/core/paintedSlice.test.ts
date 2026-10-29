import { describe, expect, test } from 'vitest'
import { parseBlocks } from '../engine/blocks.ts'
import { paintedSlice, struckThrough, unquoted, withoutInfoString } from './paintedSlice.ts'

describe('withoutInfoString', () => {
	// native <markdown> draws a header bar for a fence with an info string and none without (probed), and editmd
	// shows the language as a small label instead, which the view paints itself
	test('drops the info string after the opening fence and keeps the code and closing fence', () => {
		expect(withoutInfoString('```js\nconst x = 1;\n```')).toBe('```\nconst x = 1;\n```')
		expect(withoutInfoString('~~~~ python title="a"\nx\n~~~~')).toBe('~~~~\nx\n~~~~')
		expect(withoutInfoString('  ```js\n  x\n  ```')).toBe('  ```\n  x\n  ```')
	})

	test('a bare fence and an indented code block stay as written', () => {
		expect(withoutInfoString('```\nx\n```')).toBe('```\nx\n```')
		expect(withoutInfoString('    ```js')).toBe('    ```js')
	})
})

describe('unquoted', () => {
	// a quote paints in a view of its own (rail, padding, muted text), so its markdown goes in without its markers
	test('drops one `>` and the space after it from each line', () => {
		expect(unquoted('> A quote\n> over two lines')).toBe('A quote\nover two lines')
	})

	test('keeps lazy lines, inner quotes and a marker without its space', () => {
		expect(unquoted('> one\nlazy\n>\n>two\n> > inner\n   > indented')).toBe(
			'one\nlazy\n\ntwo\n> inner\nindented'
		)
	})

	// CommonMark: the marker takes one column of a tab after it, and the rest stays as spaces (`>\tfoo`
	// was painted as indented code)
	test('a tab after the marker leaves the columns it had beyond the one space', () => {
		expect([unquoted('>\tfoo'), unquoted('  >\tfoo')]).toEqual(['  foo', 'foo'])
	})
})

describe('struckThrough', () => {
	// editmd strikes a ticked task's text through (style.css:268-272); native <markdown> strikes `~~text~~`
	test('wraps the text in `~~`', () => {
		expect(struckThrough('done **soon**')).toBe('~~done **soon**~~')
	})

	test('each paragraph of an item on its own, trimmed, since a strike cannot span a blank line', () => {
		expect(struckThrough('first\nline\n\n  second ')).toBe('~~first\nline~~\n\n~~second~~')
	})

	// `~~~~` would open a code fence
	test('an empty item stays empty', () => {
		expect(struckThrough('')).toBe('')
		expect(struckThrough('  ')).toBe('')
	})

	// `~~gone~~ kept` opened a tilde code fence and its text vanished; `pay 5~` showed raw tildes
	test('tildes of its own text neither open a fence nor show as marks; code keeps them', () => {
		expect([
			struckThrough('~~gone~~ kept'),
			struckThrough('pay 5~'),
			struckThrough('a ~b~ c'),
			struckThrough('`x~~y` z')
		]).toEqual(['~~gone kept~~', '~~pay 5\\~~~', '~~a b c~~', '~~`x~~y` z~~'])
	})
})

describe('paintedSlice', () => {
	// editmd shows a link with no text as its source in code type, still a link (style.css:363-366)
	test('an empty link paints as a link whose text is its own source in code', () => {
		const text = 'An empty link [](https://example.com/empty).\n'
		const [block] = parseBlocks(text)

		expect(paintedSlice(text.slice(block!.start, block!.end), block!.start, block!)).toBe(
			'An empty link [`[](https://example.com/empty)`](https://example.com/empty).'
		)
	})

	test('footnote references and empty links in one slice are both rewritten, each where it was', () => {
		const text = 'See[^1] and [](https://e.x) then[^2].\n\n[^1]: one\n[^2]: two\n'
		const [block] = parseBlocks(text)

		expect(paintedSlice(text.slice(block!.start, block!.end), block!.start, block!)).toBe(
			'See[\\[1\\]](footnote:1) and [`[](https://e.x)`](https://e.x) then[\\[2\\]](footnote:2).'
		)
	})

	test('a part of a Block (one task item) rewrites only what lies inside it', () => {
		const text = '- [ ] a [](https://a.x)\n- [ ] b [](https://b.x)\n'
		const [block] = parseBlocks(text)
		const second = text.indexOf('b [')

		expect(paintedSlice(text.slice(second, block!.end), second, block!)).toBe(
			'b [`[](https://b.x)`](https://b.x)'
		)
	})

	test('a URL holding a backtick gets a longer code fence', () => {
		const text = 'x [](https://e.x/a`b)\n'
		const [block] = parseBlocks(text)

		expect(paintedSlice(text.slice(block!.start, block!.end), block!.start, block!)).toBe(
			'x [`` [](https://e.x/a`b) ``](https://e.x/a`b)'
		)
	})
})
