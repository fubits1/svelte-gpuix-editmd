import { describe, expect, test } from 'vitest'
import { firstEnabled, moveSelection } from './commandPalette.ts'

const rows = (...enabled: boolean[]) => enabled.map((each) => ({ enabled: each }))

describe('firstEnabled', () => {
	test('the first enabled row, skipping disabled ones before it', () => {
		expect(firstEnabled(rows(false, false, true, true))).toBe(2)
	})

	test('-1 when no row is enabled or there is none', () => {
		expect(firstEnabled(rows(false))).toBe(-1)
		expect(firstEnabled([])).toBe(-1)
	})
})

describe('moveSelection', () => {
	test('Down goes to the next enabled row, skipping disabled ones', () => {
		expect(moveSelection(rows(true, false, false, true), 0, 1)).toBe(3)
	})

	test('Up goes to the previous enabled row, skipping disabled ones', () => {
		expect(moveSelection(rows(true, false, true), 2, -1)).toBe(0)
	})

	test('stays put at either end, and when every row past it is disabled', () => {
		expect(moveSelection(rows(true, true), 1, 1)).toBe(1)
		expect(moveSelection(rows(true, true), 0, -1)).toBe(0)
		expect(moveSelection(rows(true, false), 0, 1)).toBe(0)
	})

	test('from no selection, Down picks the first enabled row and Up the last', () => {
		expect(moveSelection(rows(false, true, true), -1, 1)).toBe(1)
		expect(moveSelection(rows(true, true, false), -1, -1)).toBe(1)
	})
})
