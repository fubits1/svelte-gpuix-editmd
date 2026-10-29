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
