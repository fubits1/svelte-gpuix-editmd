import { describe, expect, it } from 'vitest'
import { codeText } from './codeText.ts'

describe('codeText', () => {
	it('gives a fenced block’s lines between its fences, without the info string', () => {
		expect(codeText('```js\nconst x = 1;\n\nreturn x\n```')).toBe('const x = 1;\n\nreturn x')
		expect(codeText('~~~~ python\nx\n~~~~')).toBe('x')
	})

	it('takes the opening fence’s indent off each line, no more', () => {
		expect(codeText('  ```\n  a\n    b\n c\n  ```')).toBe('a\n  b\nc')
	})

	it('closes only on a fence of the same character at least as long', () => {
		expect(codeText('````\n```\nx\n````')).toBe('```\nx')
		expect(codeText('```\n~~~\n```')).toBe('~~~')
	})

	it('runs a fence left open to the end', () => {
		expect(codeText('```\nopen\nstill')).toBe('open\nstill')
	})

	it('takes four spaces or a tab off an indented block’s lines', () => {
		expect(codeText('    a\n\tb\n      c')).toBe('a\nb\n  c')
	})
})
