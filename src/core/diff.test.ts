import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { diff, lines, type Hunk } from './diff.ts'

function apply<T>(a: readonly T[], b: readonly T[], hunks: Hunk[]): T[] {
	const out: T[] = []
	let at = 0
	for (const h of hunks) {
		out.push(...a.slice(at, h.aStart), ...b.slice(h.bStart, h.bEnd))
		at = h.aEnd
	}
	return out.concat(a.slice(at))
}

const small = fc.array(fc.integer({ min: 0, max: 4 }), { maxLength: 30 })

describe('diff', () => {
	test('applying the hunks to a gives b', () => {
		fc.assert(
			fc.property(small, small, (a, b) => {
				expect(apply(a, b, diff(a, b))).toEqual(b)
			})
		)
	})

	test('hunks are ordered, non-empty and separated by unchanged items', () => {
		fc.assert(
			fc.property(small, small, (a, b) => {
				const hunks = diff(a, b)
				hunks.forEach((h, i) => {
					expect(h.aEnd - h.aStart + h.bEnd - h.bStart).toBeGreaterThan(0)
					const prev = hunks[i - 1]
					if (prev) {
						expect(h.aStart).toBeGreaterThan(prev.aEnd)
						expect(h.bStart - prev.bEnd).toBe(h.aStart - prev.aEnd)
					}
				})
			})
		)
	})

	test('what it keeps is a longest common subsequence', () => {
		const lcs = (a: number[], b: number[]): number => {
			const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
			for (let i = a.length - 1; i >= 0; i--) {
				for (let j = b.length - 1; j >= 0; j--) {
					t[i]![j] = a[i] === b[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!)
				}
			}
			return t[0]![0]!
		}
		fc.assert(
			fc.property(small, small, (a, b) => {
				const removed = diff(a, b).reduce((n, h) => n + h.aEnd - h.aStart, 0)
				expect(a.length - removed).toBe(lcs(a, b))
			})
		)
	})

	test('identical sequences have no hunks', () => {
		// block body: vitest's toEqual returns a value fast-check reads as a failed property, bun:test's returned undefined
		fc.assert(
			fc.property(small, (a) => {
				expect(diff(a, [...a])).toEqual([])
			})
		)
	})

	test('lines keep their breaks', () => {
		fc.assert(
			fc.property(fc.string({ unit: fc.constantFrom('a', 'b', '\n', '\r') }), (text) => {
				expect(lines(text).join('')).toBe(text)
				expect(
					lines(text)
						.slice(0, -1)
						.every((line) => line.endsWith('\n'))
				).toBe(true)
			})
		)
	})
})
