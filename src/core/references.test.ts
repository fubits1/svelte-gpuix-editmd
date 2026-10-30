/**
 * editmd writes a reference inline once its definition is gone or says something else
 * (web/src/markdown/references.ts:32-60); expected values are what editmd 9e889e6 saved for the same
 * edit, run through its own MarkdownEditor
 */

import { describe, expect, test } from 'vitest'
import { settleReferences } from './references.ts'

const BEFORE = 'see [docs][d] and [d] here\n\n[d]: https://x.example "T"\n\nlast\n'

describe('settleReferences', () => {
	test('deleting a definition writes its references inline with the URL and title they had', () => {
		expect(settleReferences(BEFORE, 'see [docs][d] and [d] here\n\nlast\n')).toBe(
			'see [docs](https://x.example "T") and [d](https://x.example "T") here\n\nlast\n'
		)
	})

	// TextFile keeps a leading U+FEFF as content, which the parser drops from its offsets
	test('a text starting with a byte order mark writes its references inline at their own offsets', () => {
		expect(
			settleReferences(`\u{FEFF}${BEFORE}`, '\u{FEFF}see [docs][d] and [d] here\n\nlast\n')
		).toBe(
			'\u{FEFF}see [docs](https://x.example "T") and [d](https://x.example "T") here\n\nlast\n'
		)
	})

	test('an image reference becomes an inline image', () => {
		expect(settleReferences('![pic][p]\n\n[p]: pic.png\n\nlast\n', '![pic][p]\n\nlast\n')).toBe(
			'![pic](pic.png)\n\nlast\n'
		)
	})

	test('a definition changed to another URL leaves its references pointing where they did', () => {
		expect(
			settleReferences(
				'a [x][d] b\n\n[d]: https://old.example\n',
				'a [x][d] b\n\n[d]: https://new.example\n'
			)
		).toBe('a [x](https://old.example) b\n\n[d]: https://new.example\n')
	})

	test('a collapsed reference keeps its label as the text; a destination with a space goes in brackets', () => {
		expect(settleReferences('a [D][] b\n\n[d]: <a b.png>\n', 'a [D][] b\n')).toBe(
			'a [D](<a b.png>) b\n'
		)
	})

	test('an edit that leaves the definitions as they were changes nothing', () => {
		const after = BEFORE.replace('last', 'last changed')
		expect(settleReferences(BEFORE, after)).toBe(after)
	})

	test('a reference that had no definition stays as written', () => {
		expect(settleReferences('a [x][nope] b\n', 'a [x][nope] b, typed\n')).toBe(
			'a [x][nope] b, typed\n'
		)
	})
})

// the port's own rules, not compared with editmd's output: CommonMark's first definition wins, a reference the edit
// itself touched is left as typed, and mdast-util-to-markdown escapes a title's quotes
describe('settleReferences, by its own rules', () => {
	test('a label defined twice resolves to its first definition', () => {
		expect(settleReferences('see [x]\n\n[x]: /one\n[x]: /two\n', 'see [x]\n')).toBe(
			'see [x](/one)\n'
		)
	})

	test('a reference the edit itself touched stays as typed', () => {
		expect(settleReferences('see [x] here\n\n[x]: /one\n', 'see [xy] here\n')).toBe(
			'see [xy] here\n'
		)
	})

	test('a title holding quotes keeps them escaped', () => {
		expect(settleReferences('see [x]\n\n[x]: /one "say \\"hi\\""\n', 'see [x]\n')).toBe(
			'see [x](/one "say \\"hi\\"")\n'
		)
	})
})
