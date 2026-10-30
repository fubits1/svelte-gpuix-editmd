/**
 * editmd's code block and diagram show only their code while edited: the fences are no text of its editor (preset-commonmark
 * code-block, a node whose content is the code); the port's field holds the code alone and keeps the fences around it
 */

import { describe, expect, test } from 'vitest'
import { fenceParts, withFences } from './codeField.ts'

describe('fenceParts', () => {
	test('a fenced Block splits into its opening line, its code and its closing line', () => {
		expect([
			fenceParts('```js\nlet a = 1\nlet b = 2\n```'),
			fenceParts('~~~~mermaid\ngraph TD\n~~~~'),
			fenceParts('```\n```')
		]).toEqual([
			{ open: '```js\n', code: 'let a = 1\nlet b = 2', close: '\n```' },
			{ open: '~~~~mermaid\n', code: 'graph TD', close: '\n~~~~' },
			{ open: '```\n', code: '', close: '```' }
		])
	})

	// a fence left open runs to the Block's end, so nothing closes it; an indented code block has no fences at all
	test('a fence with no closing line keeps nothing after the code; indented code has no parts', () => {
		expect([fenceParts('```py\nx = 1'), fenceParts('    indented')]).toEqual([
			{ open: '```py\n', code: 'x = 1', close: '' },
			null
		])
	})

	test('the code goes back between the same fences', () => {
		const parts = fenceParts('```js\nlet a = 1\n```')!
		const empty = fenceParts('```\n```')!
		expect([
			withFences(parts, 'let a = 2\nlet b'),
			withFences(parts, ''),
			withFences(empty, ''),
			withFences(empty, 'x')
		]).toEqual(['```js\nlet a = 2\nlet b\n```', '```js\n\n```', '```\n```', '```\nx\n```'])
	})
})
