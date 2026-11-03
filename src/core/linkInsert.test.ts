/**
 * expected values are editmd 9e889e6's: Add Link with nothing selected (editor.ts:387-396) run by its own
 * `MarkdownEditor` with the caret at the end of the Block, then serialized; its sheet's URL comes from the pasteboard
 * (EditorWindowController.swift:144-150)
 */

import { describe, expect, test } from 'vitest'
import { insertLink, linkAt, linkAtSelection, urlFromClipboard } from './linkInsert.ts'

describe('insertLink: the URL goes in at the end of the Block as its own link text', () => {
	test.each([
		['see docs', 'https://a.example', 'see docs<https://a.example>'],
		['see docs', 'mailto:a@b.example', 'see docs<mailto:a@b.example>'],
		['see docs', 'https://a.example?q=1&r=(2)', 'see docs<https://a.example?q=1&r=(2)>'],
		// a URL an autolink cannot hold is written as a link with the destination in brackets
		[
			'see docs',
			'https://a.example/a b',
			'see docs[https://a.example/a b](<https://a.example/a b>)'
		],
		['## title', 'https://a.example', '## title<https://a.example>'],
		['- a\n- b', 'https://a.example', '- a\n- b<https://a.example>'],
		['> q', 'https://a.example', '> q<https://a.example>'],
		// code takes no links: the URL goes in as text
		['```js\nx\n```', 'https://a.example', '```js\nxhttps://a.example\n```'],
		[
			'| a | b |\n| - | - |\n| c | d |',
			'https://a.example',
			'| a | b |\n| - | - |\n| c | d<https://a.example> |'
		]
	])('%j with %j gives %j', (source, url, expected) => {
		expect(insertLink(source, url)).toBe(expected)
	})

	test('an empty URL changes nothing, as editmd refuses it with nothing selected', () => {
		expect(insertLink('see docs', '')).toBe(null)
		expect(insertLink('see docs', '  ')).toBe(null)
	})

	test('front matter, definitions and rules take no link', () => {
		expect(
			['---\ntitle: a\n---', '[x]: https://e.example', '---'].map((source) =>
				insertLink(source, 'https://a.example')
			)
		).toEqual([null, null, null])
	})
})

// editmd's Add Link at the field's selection (editor.ts:374-399), learnt through the sentinel probe in core/fieldSelection.ts;
// measured in editmd's own editor
// editmd titles the sheet Edit Link, prefills the link's URL and offers Remove Link when its caret is in a link
// (EditorWindowController.swift:117-128, editor.ts:362-372 `linkAtSelection` reads the link mark's href)
describe('linkAt', () => {
	test('the URL of the link a caret is in: inline, autolink, bare URL or reference; null outside one', () => {
		const definitions = '[d]: https://ref.example'
		expect([
			linkAt('see [docs](https://a.example "T") here', 6),
			linkAt('see <https://b.example> here', 8),
			linkAt('see https://c.example here', 10),
			linkAt('see [docs][d] here', 6, definitions),
			linkAt('see [docs](https://a.example) here', 1),
			// at the link's first character editmd's caret is in the link: its `nodeAfter` carries the mark (editor.ts:369)
			linkAt('see [docs](https://a.example) here', 4),
			linkAt('see [docs](https://a.example) here', 29)
		]).toEqual([
			'https://a.example',
			'https://b.example',
			'https://c.example',
			'https://ref.example',
			null,
			'https://a.example',
			null
		])
	})
})

describe('linkAtSelection', () => {
	const at = (source: string, selected: string, from = 0) => {
		const start = source.indexOf(selected, from)
		return { start, end: start + selected.length }
	}

	test('a selection becomes the link’s text', () => {
		expect(linkAtSelection('see docs here', at('see docs here', 'docs'), 'https://a.example')).toBe(
			'see [docs](https://a.example) here'
		)
	})

	test('a caret takes the URL as its own link text where it is', () => {
		expect(linkAtSelection('see docs', { start: 4, end: 4 }, 'https://a.example')).toBe(
			'see <https://a.example>docs'
		)
	})

	test('a caret inside a link gives the link the new URL (Edit Link)', () => {
		const source = 'see [docs](https://old.example) here'
		expect(linkAtSelection(source, { start: 7, end: 7 }, 'https://a.example')).toBe(
			'see [docs](https://a.example) here'
		)
	})

	// editmd's caret at a link's first character is in the link (editor.ts:369, 382): Edit Link and Remove Link act on it
	test('a caret at a link’s first character edits or removes that link', () => {
		const source = 'see [docs](https://old.example) here'
		expect([
			linkAtSelection(source, { start: 4, end: 4 }, 'https://a.example'),
			linkAtSelection(source, { start: 4, end: 4 }, '')
		]).toEqual(['see [docs](https://a.example) here', 'see docs here'])
	})

	// a reference link is a link mark to editmd: Edit Link marks its text with only the new href, and a selection over
	// it toggles the mark off; the definition stays (run in editmd's own editor). `definitions` are the Document's
	// definition lines, which the Block alone does not hold
	test('a reference link takes the new URL as an inline link at a caret, and its link off over a selection', () => {
		const definitions = '[d]: https://old.example'
		expect([
			linkAtSelection('see [docs][d] here', { start: 7, end: 7 }, 'https://a.example', definitions),
			linkAtSelection(
				'see [docs][d] here',
				at('see [docs][d] here', 'docs'),
				'https://a.example',
				definitions
			),
			linkAtSelection('see [d] here', { start: 5, end: 5 }, 'https://a.example', definitions)
		]).toEqual([
			'see [docs](https://a.example) here',
			'see docs here',
			'see [d](https://a.example) here'
		])
	})

	// inline code takes a link mark round its text: the whole span inside the link, or the span split round a part
	// of it (run in editmd's own editor)
	test('a selection in inline code links the code: the whole span, or its selected part split out', () => {
		expect([
			linkAtSelection('see `code` here', at('see `code` here', 'code'), 'https://a.example'),
			linkAtSelection('see `code` here', at('see `code` here', 'od'), 'https://a.example')
		]).toEqual(['see [`code`](https://a.example) here', 'see `c`[`od`](https://a.example)`e` here'])
	})

	// editmd's Edit Link puts a new link mark of only the href on the link's range (editor.ts:388-390,
	// `link.create({ href })`), so the link keeps its text and loses its title; an autolink keeps its URL as text
	test('a caret inside a link with a title, or an autolink, gives it the new URL and nothing else', () => {
		const titled = 'see [docs](https://old.example "Old") here'
		const auto = 'see <https://old.example> here'
		expect([
			linkAtSelection(titled, { start: 6, end: 6 }, 'https://a.example'),
			linkAtSelection(auto, { start: 8, end: 8 }, 'https://a.example')
		]).toEqual([
			'see [docs](https://a.example) here',
			'see [https://old.example](https://a.example) here'
		])
	})

	// editmd's serializer writes a link whose text is its own URL as an autolink
	test('a selection that is its own URL becomes an autolink', () => {
		const source = 'write mailto:a@b.example now'
		expect(linkAtSelection(source, at(source, 'mailto:a@b.example'), 'mailto:a@b.example')).toBe(
			'write <mailto:a@b.example> now'
		)
	})

	test('in code the URL goes in as text at the caret', () => {
		expect(linkAtSelection('```js\nx\n```', { start: 7, end: 7 }, 'https://a.example')).toBe(
			'```js\nxhttps://a.example\n```'
		)
	})

	// editmd's front matter box is no part of its editor, which Format > Link acts on (editor.ts:330-345)
	test('front matter, a definition or a rule takes no link, at a caret or a selection', () => {
		expect([
			linkAtSelection('---\ntitle: x\n---', { start: 11, end: 12 }, 'https://a.example'),
			linkAtSelection('---\ntitle: x\n---', { start: 12, end: 12 }, 'https://a.example'),
			linkAtSelection('[d]: https://x.example', { start: 1, end: 2 }, 'https://a.example'),
			linkAtSelection('---', { start: 3, end: 3 }, 'https://a.example')
		]).toEqual([null, null, null, null])
	})

	// editmd refuses: a selection in code takes no link (measured in editmd's own editor)
	test('a selection in code changes nothing', () => {
		expect(
			linkAtSelection('```js\nx = 1\n```', { start: 10, end: 11 }, 'https://a.example')
		).toBeNull()
	})

	// editmd links the text of each line the selection covers, list markers and quote marks left out
	test('a selection across list items or quoted paragraphs links each line’s text', () => {
		expect([
			linkAtSelection('- a\n- b', { start: 2, end: 7 }, 'https://a.example'),
			linkAtSelection('> one\n>\n> two', { start: 3, end: 13 }, 'https://a.example')
		]).toEqual([
			'- [a](https://a.example)\n- [b](https://a.example)',
			'> o[ne](https://a.example)\n>\n> [two](https://a.example)'
		])
	})

	// editmd's serializer: angle brackets only around a destination with a space, `<`/`>` escaped inside them; a `<`
	// in the text escaped (measured in editmd's own editor)
	test('angle brackets in a URL are written as editmd writes them', () => {
		expect([
			linkAtSelection('see here', { start: 4, end: 8 }, 'https://e.example/a<b'),
			linkAtSelection('see here', { start: 4, end: 8 }, 'https://e.example/a b>c'),
			linkAtSelection('see here', { start: 4, end: 4 }, 'https://e.example/a<b')
		]).toEqual([
			'see [here](https://e.example/a<b)',
			'see [here](<https://e.example/a b\\>c>)',
			'see [https://e.example/a\\<b](https://e.example/a<b)here'
		])
	})

	// a destination with an escaped parenthesis is one destination, not cut at `\)`
	test('a caret in a link whose URL escapes a parenthesis replaces the whole URL', () => {
		const source = 'see [docs](https://e.example/a\\)b) here'
		expect(linkAtSelection(source, { start: 6, end: 6 }, 'https://a.example')).toBe(
			'see [docs](https://a.example) here'
		)
	})

	// across table rows editmd links each cell's text, never putting brackets round the pipes, which would make
	// the table a paragraph (run in editmd's own editor)
	test('a selection across table rows links the text of each cell, the table kept', () => {
		const table = '| a | b |\n| - | - |\n| c | d |'
		expect(linkAtSelection(table, { start: 6, end: 27 }, 'https://a.example')).toBe(
			'| a | [b](https://a.example) |\n| - | - |\n| [c](https://a.example) | [d](https://a.example) |'
		)
	})

	// editmd's Add or Update with an empty URL removes the link (EditorWindowController.swift:133-134, editor.ts:380-385);
	// a URL left as text is escaped, as its serializer writes it, so GFM does not link it again
	test('an empty URL takes the link off at the caret or across the selection', () => {
		const source = 'see [docs](https://old.example) and <https://b.example> here'
		expect([
			linkAtSelection(source, { start: 6, end: 6 }, ''),
			linkAtSelection(source, { start: 0, end: source.length }, ' '),
			linkAtSelection('see docs', { start: 4, end: 4 }, '')
		]).toEqual([
			'see docs and <https://b.example> here',
			'see docs and https\\://b.example here',
			null
		])
	})

	// editmd's link toggles as a mark (editor.ts:398, toggleLinkCommand is toggleMark): a selection that holds a link
	// loses it, whatever URL is given; a bare URL is a link to editmd (GFM), and the text left is escaped
	test('a URL given for a selection that holds a link takes the link off', () => {
		const bare = 'see https://a.example here'
		const inline = 'see [docs](https://old.example) here'
		expect([
			linkAtSelection(bare, at(bare, 'https://a.example'), 'https://a.example'),
			linkAtSelection(inline, at(inline, '[docs](https://old.example)'), 'https://a.example')
		]).toEqual(['see https\\://a.example here', 'see docs here'])
	})

	test('an empty URL changes nothing', () => {
		expect(linkAtSelection('see docs', { start: 4, end: 8 }, ' ')).toBeNull()
	})

	// editmd's serializer escapes what would end the link early (measured in editmd's own editor)
	test('parentheses in the URL and brackets in the text are escaped, as editmd writes them', () => {
		expect([
			linkAtSelection('see here', { start: 4, end: 8 }, 'https://e.example/a(b'),
			linkAtSelection('see here', { start: 4, end: 8 }, 'https://e.example/a)b'),
			linkAtSelection('see here', { start: 4, end: 8 }, 'https://e.example/a(b)'),
			linkAtSelection('see a]b now', { start: 4, end: 7 }, 'https://e.example/'),
			linkAtSelection('see a[b now', { start: 4, end: 7 }, 'https://e.example/')
		]).toEqual([
			'see [here](https://e.example/a\\(b)',
			'see [here](https://e.example/a\\)b)',
			'see [here](https://e.example/a\\(b\\))',
			'see [a\\]b](https://e.example/) now',
			'see [a\\[b](https://e.example/) now'
		])
	})
})

describe('urlFromClipboard', () => {
	test.each([
		['https://a.example', 'https://a.example'],
		['  http://a.example/x  \n', 'http://a.example/x'],
		['mailto:a@b.example', 'mailto:a@b.example'],
		['ftp://a.example', null],
		['HTTPS://a.example', null],
		['not a url', null],
		['https://a.example and more', null],
		// Foundation's URL(string:).absoluteString percent-encodes the rest (swift)
		['https://a.example/ä', 'https://a.example/%C3%A4'],
		['https://a.example/a b', 'https://a.example/a%20b'],
		['https://a.example/%41', 'https://a.example/%41'],
		// the rest of what Foundation encodes (swift)
		['https://a.example/a|b', 'https://a.example/a%7Cb'],
		['https://a.example/a<b>', 'https://a.example/a%3Cb%3E'],
		['https://a.example/{x}', 'https://a.example/%7Bx%7D'],
		['https://a.example/a"b', 'https://a.example/a%22b'],
		['https://a.example/a^b', 'https://a.example/a%5Eb'],
		['https://a.example/a`b', 'https://a.example/a%60b'],
		['https://a.example/a\\b', 'https://a.example/a%5Cb'],
		['https://a.example/%zz', 'https://a.example/%25zz'],
		['https://a.example/#a#b', 'https://a.example/#a%23b'],
		['https://a.example/[x]', 'https://a.example/%5Bx%5D'],
		['', null]
	])('%j prefills %j', (text, expected) => {
		expect(urlFromClipboard(text)).toBe(expected)
	})
})
