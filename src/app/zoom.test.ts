import { describe, expect, test } from 'vitest'
import { zoomIn, zoomOut } from './zoom.ts'

describe('zoom', () => {
	test('each step is ×1.1, as in editmd', () => {
		// to 10 digits: the default 2 would pass a factor of 1.104
		expect(zoomIn(1)).toBeCloseTo(1.1, 10)
		expect(zoomOut(1)).toBeCloseTo(1 / 1.1, 10)
	})

	test('zoom stays between 0.5 and 3', () => {
		expect(zoomIn(2.9)).toBe(3)
		expect(zoomOut(0.52)).toBe(0.5)
	})
})
