import { describe, expect, test } from 'vitest'
import { appearanceFrom, readSystemAppearance, systemAppearance } from './appearance.ts'

describe('appearance', () => {
	test('"Dark" from defaults means dark; anything else (light mode exits with an error) means light', () => {
		expect(appearanceFrom('Dark\n')).toBe('dark')
		expect(appearanceFrom('')).toBe('light')
	})

	test('reads this machine without throwing', () => {
		expect(['dark', 'light']).toContain(systemAppearance())
	})

	test('the async read gives the same answer without blocking the thread on `defaults`', async () => {
		const reading = readSystemAppearance()
		expect(reading).toBeInstanceOf(Promise)
		expect(await reading).toBe(systemAppearance())
	})
})
