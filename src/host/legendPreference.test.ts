import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { LegendPreference } from './legendPreference.ts'

const directory = mkdtempSync(join(tmpdir(), 'editmd-gpuix-legend-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

describe('LegendPreference', () => {
	// editmd keeps the legend's minimized state in localStorage, so every window and launch shares it (highlights.ts:221-229)
	test('minimized is kept across instances, and shown again once undone', () => {
		const store = join(directory, 'nested', 'legend.json')
		new LegendPreference(store).setMinimized(true)
		const minimizedLater = new LegendPreference(store).minimized()
		new LegendPreference(store).setMinimized(false)

		expect([minimizedLater, new LegendPreference(store).minimized()]).toEqual([true, false])
	})

	// editmd's `remember` catches a storage error (highlights.ts:318-322); a store that cannot be written must not make the click throw
	test('a store that cannot be written is ignored, and the store is replaced whole', () => {
		const blocked = join(directory, 'file-not-folder')
		writeFileSync(blocked, '')
		const store = join(directory, 'whole.json')
		new LegendPreference(store).setMinimized(true)
		const before = statSync(store).ino
		new LegendPreference(store).setMinimized(false)

		expect(
			[
				() => new LegendPreference(join(blocked, 'legend.json')).setMinimized(true),
				statSync(store).ino === before
			].map((value) =>
				typeof value === 'function'
					? (() => {
							try {
								value()
								return 'ok'
							} catch {
								return 'threw'
							}
						})()
					: value
			)
		).toEqual(['ok', false])
	})

	test('a missing or broken store reads as shown, as editmd’s `remembered` does', () => {
		const broken = join(directory, 'broken.json')
		writeFileSync(broken, '{not json')

		expect([
			new LegendPreference(join(directory, 'missing.json')).minimized(),
			new LegendPreference(broken).minimized()
		]).toEqual([false, false])
	})
})
