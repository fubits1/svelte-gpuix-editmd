/**
 * expected values are editmd 9e889e6's: Add Link with nothing selected (editor.ts:387-396) run by its own
 * `MarkdownEditor` with the caret at the end of the Block, then serialized; its sheet's URL comes from the pasteboard
 * (EditorWindowController.swift:144-150)
 */

import { describe, expect, test } from 'vitest'
import { insertLink, linkAtSelection, urlFromClipboard } from './linkInsert.ts'

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

	// a destination with an escaped parenthesis is one destination (the old URL was cut at `\)`)
	test('a caret in a link whose URL escapes a parenthesis replaces the whole URL', () => {
		const source = 'see [docs](https://e.example/a\\)b) here'
		expect(linkAtSelection(source, { start: 6, end: 6 }, 'https://a.example')).toBe(
			'see [docs](https://a.example) here'
		)
	})

	// across table rows the brackets went round the pipes and the table became a paragraph; editmd links
	// each cell's text (run in editmd's own editor)
	test('a selection across table rows links the text of each cell, the table kept', () => {
		const table = '| a | b |\n| - | - |\n| c | d |'
		expect(linkAtSelection(table, { start: 6, end: 27 }, 'https://a.example')).toBe(
			'| a | [b](https://a.example) |\n| - | - |\n| [c](https://a.example) | [d](https://a.example) |'
		)
	})

	// editmd's Add or Update with an empty URL removes the link (EditorWindowController.swift:133-134, editor.ts:380-385)
	test('an empty URL takes the link off at the caret or across the selection', () => {
		const source = 'see [docs](https://old.example) and <https://b.example> here'
		expect([
			linkAtSelection(source, { start: 6, end: 6 }, ''),
			linkAtSelection(source, { start: 0, end: source.length }, ' '),
			linkAtSelection('see docs', { start: 4, end: 4 }, '')
		]).toEqual([
			'see docs and <https://b.example> here',
			'see docs and https://b.example here',
			null
		])
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
