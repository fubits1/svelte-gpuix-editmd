import { describe, expect, test } from 'vitest'
import { cellSizing } from './cellSizing.ts'

describe('cellSizing', () => {
	test('code spans come out of the sans text, to be measured in SF Mono', () => {
		expect(cellSizing('a `long_code` b')).toEqual({ plain: 'a  b', code: ['long_code'] })
		expect(cellSizing('``x ` y``')).toEqual({ plain: '', code: ['x ` y'] })
	})

	// CommonMark strips one space off each end of a code span that has one on both ends, unless it is only spaces
	test('a code span sizes without the space at each end, unless it holds only spaces', () => {
		expect([cellSizing('` a `').code, cellSizing('`  `').code]).toEqual([['a'], ['  ']])
	})

	test('an entity the cell does not know sizes as written', () => {
		expect(cellSizing('&copy; &AMP;').plain).toBe('&copy; &')
	})

	test('a link, a reference link, a footnote reference and an autolink size by what they paint', () => {
		expect(cellSizing('[text](https://x.example) [t][l] [u][] [^1] <https://y.example>')).toEqual({
			plain: 'text t u 1 https://y.example',
			code: []
		})
	})

	test('entities, emphasis marks and escapes size as the characters they paint', () => {
		expect(cellSizing('**a** &amp; _b_ \\* &#65;&#x42; ~~c~~')).toEqual({
			plain: 'a & b * AB c',
			code: []
		})
	})
})
