import { describe, expect, test } from 'vitest'
import { anchoredIndex, matchesFrom, steppedIndex, type Wash } from './findMatches.ts'

/** one painted wash over `text` from `start`, `length` long */
function wash(elementId: number, text: string, start: number, length: number): Wash {
	return { elementId, text, start, end: start + length }
}

describe('matchesFrom', () => {
	test('each wash that spells the query is one match, in paint order', () => {
		const washes = [
			wash(9, 'Be bold, be brave.', 0, 2),
			wash(9, 'Be bold, be brave.', 9, 2),
			wash(40, 'Last one to be here.', 12, 2)
		]

		expect(matchesFrom(washes, 'be')).toEqual([
			{ elementId: 9, start: 0 },
			{ elementId: 9, start: 9 },
			{ elementId: 40, start: 12 }
		])
	})

	test('a match split across runs is one match, at its first piece', () => {
		const washes = [wash(3, 'Hello', 3, 2), wash(4, 'world', 0, 3), wash(7, 'low', 0, 3)]

		// the last wash starts a match no later wash finishes
		expect(matchesFrom(washes, 'lowor')).toBeNull()
		expect(matchesFrom(washes.slice(0, 2), 'lowor')).toEqual([{ elementId: 3, start: 3 }])
	})

	test('washes painted for an earlier query are stale, so there is nothing to count yet', () => {
		// `b` was painted; the query is already `be`
		expect(matchesFrom([wash(9, 'Be bold', 0, 1), wash(9, 'Be bold', 3, 1)], 'be')).toBeNull()
		expect(matchesFrom([wash(9, 'Be bold', 3, 2)], 'be')).toBeNull()
	})

	test('no wash is no match, and an empty query has none', () => {
		expect(matchesFrom([], 'be')).toEqual([])
		expect(matchesFrom([wash(9, 'Be', 0, 2)], '')).toEqual([])
	})
})

describe('anchoredIndex', () => {
	const matches = [
		{ elementId: 9, start: 0 },
		{ elementId: 9, start: 9 },
		{ elementId: 40, start: 12 }
	]

	test('typing on keeps the match that grows from the current one, as editmd searches from its start', () => {
		expect(anchoredIndex(matches, { elementId: 9, start: 9 })).toBe(1)
		expect(anchoredIndex(matches, { elementId: 9, start: 5 })).toBe(1)
	})

	test('past the anchor’s last match in its element, the next element’s first match follows', () => {
		expect(anchoredIndex(matches, { elementId: 9, start: 10 })).toBe(2)
	})

	test('wraps to the first match when nothing follows the anchor, or when there is no anchor', () => {
		expect(anchoredIndex(matches, { elementId: 40, start: 13 })).toBe(0)
		expect(anchoredIndex(matches, { elementId: 77, start: 0 })).toBe(0)
		expect(anchoredIndex(matches, null)).toBe(0)
	})
})

describe('steppedIndex', () => {
	test('next and previous wrap around, as editmd’s find (`wraps = true`)', () => {
		expect(steppedIndex(0, 3, 'next')).toBe(1)
		expect(steppedIndex(2, 3, 'next')).toBe(0)
		expect(steppedIndex(0, 3, 'previous')).toBe(2)
		expect(steppedIndex(1, 3, 'previous')).toBe(0)
	})

	test('with no match there is nowhere to step', () => {
		expect(steppedIndex(0, 0, 'next')).toBe(0)
	})
})
