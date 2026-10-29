import { describe, expect, test } from 'vitest'
import { readVisibleScreen } from './screen.ts'

describe('readVisibleScreen', () => {
	test('asks AppKit through osascript for the main screen’s visible frame and reads its size', () => {
		const calls: [string, readonly string[]][] = []
		const screen = readVisibleScreen((file, args) => {
			calls.push([file, args])
			return '{"width":1470,"height":923}\n'
		})

		expect(screen).toEqual({ width: 1470, height: 923 })
		expect(calls).toHaveLength(1)
		expect(calls[0]?.[0]).toBe('/usr/bin/osascript')
		expect(calls[0]?.[1].slice(0, 2)).toEqual(['-l', 'JavaScript'])
		expect(calls[0]?.[1].join(' ')).toContain('visibleFrame')
	})

	test('a failed or odd answer is no screen, so the window keeps editmd’s uncapped size', () => {
		expect(
			readVisibleScreen(() => {
				throw new Error('osascript: not found')
			})
		).toBeNull()
		expect(readVisibleScreen(() => 'nothing')).toBeNull()
		expect(readVisibleScreen(() => '{"width":"wide","height":923}')).toBeNull()
	})
})
