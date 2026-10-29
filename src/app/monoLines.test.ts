import { describe, expect, test } from 'vitest'
import { monoLinesSource, monoLinesTheme, monoLinesWidth } from './monoLines.ts'
import { textThemeFor } from './palette.ts'

describe('monoLinesSource', () => {
	test('each line is a paragraph of one code span, so native <markdown> paints it as written and wraps it', () => {
		expect(monoLinesSource('---\ntitle: A\n---')).toBe('`---`\n\n`title: A`\n\n`---`')
	})

	test('a line keeps its leading spaces: a code span strips one space only when both ends have one', () => {
		expect(monoLinesSource('  - item')).toBe('`  - item`')
		expect(monoLinesSource(' both ')).toBe('`  both  `')
	})

	test('a line holding backticks takes a longer fence, padded where it starts or ends with one', () => {
		expect(monoLinesSource('a `tick` inside')).toBe('``a `tick` inside``')
		expect(monoLinesSource('`edge`')).toBe('`` `edge` ``')
		expect(monoLinesSource('run ``` of three')).toBe('````run ``` of three````')
	})

	// a tab painted zero-width in native inline code; editmd's `white-space: pre-wrap` stops a tab at the
	// next multiple of 8 columns (CSS `tab-size` 8)
	test('a tab becomes the spaces to the next stop of 8 columns', () => {
		expect([
			monoLinesSource('ab:\tT'),
			monoLinesSource('\tx'),
			monoLinesWidth('ab:\tT', 16)
		]).toEqual(['`ab:     T`', '`        x`', monoLinesWidth('ab:     T', 16)])
	})

	test('an empty line is a code span of one space, so it keeps its row', () => {
		expect(monoLinesSource('a\n\nb')).toBe('`a`\n\n` `\n\n`b`')
	})
})

describe('monoLinesWidth', () => {
	test('the longest line in SF Mono advances (98.90625px for ten at 16px, measured headless), rounded up, plus 1px', () => {
		expect(monoLinesWidth('iiiiiiiiii', 16)).toBe(100)
		expect(monoLinesWidth('Empty diagram\nab', 12.5)).toBe(
			Math.ceil((13 * 12.5 * 98.90625) / 160) + 1
		)
	})
})

describe('monoLinesTheme', () => {
	test('the inline code paints in `colour` on no fill, at `size` in a `lineHeight` line, with no gap between lines', () => {
		const theme = textThemeFor('dark')
		expect(monoLinesTheme(theme, '#9198a1', 13.76, 22.704)).toEqual({
			...theme,
			codeWash: '#00000000',
			codeText: '#9198a1',
			metrics: { ...theme.metrics, mdTextSize: 13.76, mdLineHeight: 22.704, mdBlockGap: 0 }
		})
	})
})
