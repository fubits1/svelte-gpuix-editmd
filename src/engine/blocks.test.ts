import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseBlocks } from './blocks.ts'

const corpus: Record<string, string> = JSON.parse(
	readFileSync('test/fixtures/editmd/corpus.json', 'utf8')
)

/** every character outside the Blocks, in order */
function gapsOf(text: string): string[] {
	const gaps: string[] = []
	let at = 0
	for (const block of parseBlocks(text)) {
		gaps.push(text.slice(at, block.start))
		at = block.end
	}
	gaps.push(text.slice(at))
	return gaps
}

describe('parseBlocks', () => {
	test('a heading and a paragraph are two blocks with their source offsets', () => {
		const text = '# Title\n\nBody text.\n'

		expect(parseBlocks(text).map(({ kind, start, end }) => ({ kind, start, end }))).toEqual([
			{ kind: 'heading', start: 0, end: 7 },
			{ kind: 'paragraph', start: 9, end: 19 }
		])
	})

	test("headings carry their level and GitHub's anchor, repeats numbered", () => {
		const text = "# What's new\n\n## Setup\n\n## Setup *again*\n\n## Setup\n"

		expect(parseBlocks(text).map((block) => block.heading)).toEqual([
			{ level: 1, slug: 'whats-new' },
			{ level: 2, slug: 'setup' },
			{ level: 2, slug: 'setup-again' },
			{ level: 2, slug: 'setup-1' }
		])
	})

	// editmd paints a reference-style image as the image its definition names (both apps' --snapshot)
	test('a reference-style image is an image with its definition’s source, full, collapsed or shortcut', () => {
		const text =
			'![full][p] ![collapsed][] ![shortcut]\n\n[p]: a.png\n[collapsed]: b.png\n[Shortcut]: c.png\n'
		expect(parseBlocks(text)[0]?.images).toEqual([
			{ src: 'a.png', alt: 'full' },
			{ src: 'b.png', alt: 'collapsed' },
			{ src: 'c.png', alt: 'shortcut' }
		])
	})

	// editmd's heading text is ProseMirror's textContent, where inline HTML is an atom with no text: its editor gives
	// `linebreak-html` (run in editmd's own editor)
	test('inline HTML in a heading adds nothing to its anchor', () => {
		expect(parseBlocks('# Line<br>break <b>html</b>\n')[0]?.heading?.slug).toBe('linebreak-html')
	})

	// editmd numbers every heading in the document, those in quotes and lists too (anchors.ts:66-69)
	test('a repeated anchor counts headings inside quotes and lists', () => {
		const text = '> # Setup\n\n- # Setup\n\n# Setup\n'

		expect(parseBlocks(text).map((block) => block.heading?.slug ?? null)).toEqual([
			null,
			null,
			'setup-2'
		])
	})

	test('a mermaid fence is its own kind, other fences keep their language', () => {
		const text = '```mermaid\ngraph TD\nA-->B\n```\n\n```js\nlet x = 1\n```\n\n```\nplain\n```\n'

		expect(parseBlocks(text).map(({ kind, lang }) => ({ kind, lang }))).toEqual([
			{ kind: 'mermaid', lang: 'mermaid' },
			{ kind: 'code', lang: 'js' },
			{ kind: 'code', lang: null }
		])
	})

	test('task items, nested ones too, carry the offset of their mark and whether it is checked', () => {
		const text = '- [ ] one\n- [x] two\n  - [ ] nested\n- plain\n'
		const [list] = parseBlocks(text)

		expect(list?.tasks).toEqual([
			{ mark: 3, checked: false },
			{ mark: 13, checked: true },
			{ mark: 25, checked: false }
		])
		expect(list?.tasks?.map(({ mark }) => text[mark])).toEqual([' ', 'x', ' '])
	})

	test('a list with tasks lists every item flat, with depth, marker, content and task', () => {
		const text = '- [ ] one\n- [x] two **b**\n  - [ ] nested\n- plain\n\n1. [ ] numbered\n'
		const [list, numbered] = parseBlocks(text)

		expect(
			list?.items?.map(({ depth, marker, contentStart, contentEnd, task }) => ({
				depth,
				marker,
				content: text.slice(contentStart, contentEnd),
				checked: task?.checked ?? null
			}))
		).toEqual([
			{ depth: 0, marker: '-', content: 'one', checked: false },
			{ depth: 0, marker: '-', content: 'two **b**', checked: true },
			{ depth: 1, marker: '-', content: 'nested', checked: false },
			{ depth: 0, marker: '-', content: 'plain', checked: null }
		])
		expect(numbered?.items?.[0]).toMatchObject({ marker: '1.', depth: 0 })
	})

	// a plain list paints its own rows too (marker beside the text, hollow nested bullet), so it needs them as well
	test('a list without tasks lists every item flat as well, and has no tasks', () => {
		const text = '- one\n  - nested\n\n3. three\n4. four\n'
		const [bullets, numbered] = parseBlocks(text)
		const itemsOf = (block: typeof bullets) =>
			block?.items?.map(({ depth, marker, contentStart, contentEnd, task }) => ({
				depth,
				marker,
				content: text.slice(contentStart, contentEnd),
				task: task ?? null
			}))

		expect([itemsOf(bullets), itemsOf(numbered), bullets?.tasks, numbered?.tasks]).toEqual([
			[
				{ depth: 0, marker: '-', content: 'one', task: null },
				{ depth: 1, marker: '-', content: 'nested', task: null }
			],
			[
				{ depth: 0, marker: '3.', content: 'three', task: null },
				{ depth: 0, marker: '4.', content: 'four', task: null }
			],
			undefined,
			undefined
		])
	})

	// editmd paints a whole `li`; text after an item's nested list belongs to the item, at its depth, after the list
	test('what follows an item’s nested list is a continuation row of that item, with no marker of its own', () => {
		const text = '- a\n  - b\n\n  more text\n- c\n'
		const [list] = parseBlocks(text)

		expect(
			list?.items?.map(({ depth, marker, contentStart, contentEnd, continuation }) => ({
				depth,
				marker,
				content: text.slice(contentStart, contentEnd),
				continuation: continuation ?? false
			}))
		).toEqual([
			{ depth: 0, marker: '-', content: 'a', continuation: false },
			{ depth: 1, marker: '-', content: 'b', continuation: false },
			{ depth: 0, marker: '', content: 'more text', continuation: true },
			{ depth: 0, marker: '-', content: 'c', continuation: false }
		])
	})

	test('every corpus block has a known kind', () => {
		const kinds = new Set(
			Object.values(corpus).flatMap((text) => parseBlocks(text).map(({ kind }) => kind))
		)

		expect([...kinds].filter((kind) => kind === 'other')).toEqual([])
	})

	test('a paragraph of only images lists them, since native <markdown> paints images as link text', () => {
		const [images, mixed] = parseBlocks(
			'![a pic](img/a.png) ![b](https://example.com/b.png "B")\n\nText with ![inline](c.png) image.\n'
		)

		expect(images?.images).toEqual([
			{ src: 'img/a.png', alt: 'a pic' },
			{ src: 'https://example.com/b.png', alt: 'b' }
		])
		expect(mixed?.images).toBeUndefined()
	})

	test('footnote references carry their offsets and label, inside tables too, since native <markdown> paints them literally', () => {
		const text =
			'Text[^1] and[^note].\n\n| a |\n|---|\n| x[^1] |\n\n[^1]: First.\n[^note]: Second.\n'
		const [paragraph, table] = parseBlocks(text)
		const spelled = (block: typeof paragraph) =>
			block?.footnoteReferences?.map(({ start, end, label }) => [text.slice(start, end), label])

		expect(spelled(paragraph)).toEqual([
			['[^1]', '1'],
			['[^note]', 'note']
		])
		expect(spelled(table)).toEqual([['[^1]', '1']])
	})

	test('a footnote definition carries its label and where its content starts', () => {
		const text = 'Text[^note].\n\n[^note]: Second note\n    with continuation.\n'
		const definition = parseBlocks(text)[1]

		expect(definition?.footnote?.label).toBe('note')
		expect(text.slice(definition!.footnote!.contentStart, definition!.end)).toBe(
			'Second note\n    with continuation.'
		)
	})

	test('a paragraph mixing text and images is split into text and image segments, offsets into the text', () => {
		const text = 'See ![a pic](a.png "A") here, then ![b](https://example.com/b.png).\n'
		const [paragraph] = parseBlocks(text)

		expect(
			paragraph?.segments?.map((segment) =>
				segment.kind === 'text'
					? ['text', text.slice(segment.start, segment.end)]
					: ['image', segment.src, segment.alt]
			)
		).toEqual([
			['text', 'See '],
			['image', 'a.png', 'a pic'],
			['text', ' here, then '],
			['image', 'https://example.com/b.png', 'b'],
			['text', '.']
		])
		expect(parseBlocks('Only text.\n')[0]?.segments).toBeUndefined()
		expect(parseBlocks('![only](a.png)\n')[0]?.segments).toBeUndefined()
	})

	// editmd shows a link with no text as its source (markdown/links.ts:84-155, style.css:363-366)
	test('a link with no text is listed with its offsets and URL; one with text is not', () => {
		const text = 'An empty link [](https://example.com/empty) and [a link](https://x.y).\n'
		const [paragraph] = parseBlocks(text)

		expect(
			paragraph?.emptyLinks?.map((link) => [text.slice(link.start, link.end), link.url])
		).toEqual([['[](https://example.com/empty)', 'https://example.com/empty']])
		expect(parseBlocks('Only [text](https://x.y).\n')[0]?.emptyLinks).toBeUndefined()
	})

	// editmd shows the pointer over a link only while ⌘ is held (main.ts:48-54, style.css:170-181)
	test('a Block that paints a link, of any spelling, is marked as holding one; a Block without is not', () => {
		const marked = (text: string) => parseBlocks(text).map((block) => block.links === true)

		expect(
			marked(
				'An [inline](https://x.y) link.\n\nA [reference][r].\n\n[r]: https://r.x\n\n- <https://auto.x>\n\n> www.bare.x\n\nNone here.\n\n# Heading with [a link](#x)\n'
			)
		).toEqual([true, true, false, true, true, false, true])
	})

	test('a link around nothing but an image is an image segment that keeps the link (README badge)', () => {
		const text = '[![badge](badge.png)](https://example.com/ci) after a badge.\n'
		const [paragraph] = parseBlocks(text)

		expect(
			paragraph?.segments?.map((segment) =>
				segment.kind === 'text'
					? ['text', text.slice(segment.start, segment.end)]
					: ['image', text.slice(segment.start, segment.end), segment.src, segment.href]
			)
		).toEqual([
			[
				'image',
				'[![badge](badge.png)](https://example.com/ci)',
				'badge.png',
				'https://example.com/ci'
			],
			['text', ' after a badge.']
		])
	})

	test('a leading U+FEFF kept as content does not shift offsets', () => {
		const text = String.fromCharCode(0xfeff) + '- [x] done\n'
		const [list] = parseBlocks(text)

		expect(list).toMatchObject({ kind: 'list', start: 1, end: text.length - 1 })
		expect(text[list!.tasks![0]!.mark]).toBe('x')
	})

	test('YAML and TOML front matter are the first block, kind frontmatter', () => {
		for (const frontmatter of ['---\ntitle: A\n---', '+++\ntitle = "A"\n+++']) {
			const text = `${frontmatter}\n\nBody.\n`

			expect(parseBlocks(text).map(({ kind, start, end }) => ({ kind, start, end }))).toEqual([
				{ kind: 'frontmatter', start: 0, end: frontmatter.length },
				{ kind: 'paragraph', start: frontmatter.length + 2, end: frontmatter.length + 7 }
			])
		}
	})

	test.each(Object.entries(corpus))(
		'corpus %s: blocks are ordered and in bounds, gaps are whitespace only',
		(_name, text) => {
			let at = 0
			for (const block of parseBlocks(text)) {
				expect(block.start).toBeGreaterThanOrEqual(at)
				expect(block.end).toBeGreaterThanOrEqual(block.start)
				at = block.end
			}
			expect(at).toBeLessThanOrEqual(text.length)
			expect(gapsOf(text).filter((gap) => gap.trim() !== '')).toEqual([])
		}
	)
})
