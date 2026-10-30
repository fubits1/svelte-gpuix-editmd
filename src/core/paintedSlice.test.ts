import { describe, expect, test } from 'vitest'
import { parseBlocks } from '../engine/blocks.ts'
import { paintedSlice, struckThrough, withoutInfoString } from './paintedSlice.ts'

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
			'See¹ and [`[](https://e.x)`](https://e.x) then².'
		)
	})

	// editmd shows each inline HTML tag as its source in muted mono (`span[data-type="html"]`, style.css:346-349); a code
	// span is the run <markdown> paints in mono, and the view gives it the muted colour
	test('each inline HTML tag paints as a code span of its source, the text between them as it is', () => {
		const text = 'Line<br>break <b>bold</b> and <https://a.example>.\n'
		const [block] = parseBlocks(text)

		expect(paintedSlice(text.slice(block!.start, block!.end), block!.start, block!)).toBe(
			'Line`<br>`break `<b>`bold`</b>` and <https://a.example>.'
		)
	})

	// a child of a quote or a list item spans lines that carry the container's `> ` or indent; it paints without them,
	// as the child's own markdown
	test('a Block inside a quote or a list item paints without its container’s line prefix', () => {
		const quote = '> ```js\n> x\n> ```\n'
		const list = '- a\n\n  ```\n  x\n  ```\n'
		const code = parseBlocks(quote)[0]!.children![0]!
		const listed = parseBlocks(list)[0]!.items![0]!.children![1]!
		expect([
			paintedSlice(quote.slice(code.start, code.end), code.start, code),
			paintedSlice(list.slice(listed.start, listed.end), listed.start, listed)
		]).toEqual(['```js\nx\n```', '```\nx\n```'])
	})

	// CommonMark lets a tab follow the `>`; left in, the tab would make a fence's lines indented code
	test('a quote line whose marker a tab follows paints without the tab', () => {
		const quote = '>\t```\n>\tx\n>\t```\n'
		const code = parseBlocks(quote)[0]!.children![0]!
		expect(paintedSlice(quote.slice(code.start, code.end), code.start, code)).toBe('```\nx\n```')
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
