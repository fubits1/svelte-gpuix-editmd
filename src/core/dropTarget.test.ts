import { describe, expect, test } from 'vitest'
import { insertAfterIndexAt } from './dropTarget.ts'

/** three Blocks stacked with 10px gaps */
const rows = [
	{ top: 0, height: 40 },
	{ top: 50, height: 20 },
	{ top: 80, height: 60 }
]

describe('insertAfterIndexAt', () => {
	test('a drop on a Block’s lower half goes after it, on its upper half before it', () => {
		expect(insertAfterIndexAt(30, rows)).toBe(0)
		expect(insertAfterIndexAt(52, rows)).toBe(0)
		expect(insertAfterIndexAt(65, rows)).toBe(1)
	})

	test('a drop in a gap goes after the Block above it', () => {
		expect(insertAfterIndexAt(45, rows)).toBe(0)
		expect(insertAfterIndexAt(75, rows)).toBe(1)
	})

	test('above every Block it goes first, below them all last, and into an empty Document first', () => {
		expect(insertAfterIndexAt(-5, rows)).toBe(-1)
		expect(insertAfterIndexAt(10, rows)).toBe(-1)
		expect(insertAfterIndexAt(500, rows)).toBe(2)
		expect(insertAfterIndexAt(10, [])).toBe(-1)
	})
})
