import { describe, expect, test } from 'vitest'
import { focusRingFrom, readFocusRing } from './focusRing.ts'

// NSColor.keyboardFocusIndicatorColor follows the Mac's accent colour; this Mac (purple accent, dark) printed dc78de7f
describe('focusRing', () => {
	test('AppKit’s focus ring colour as `#rrggbbaa`, null for anything else', () => {
		expect([focusRingFrom('dc78de7f\n'), focusRingFrom(''), focusRingFrom('nope')]).toEqual([
			'#dc78de7f',
			null,
			null
		])
	})

	test('is read through osascript without blocking, and a failed run gives none', async () => {
		const calls: string[][] = []
		const answering =
			(stdout: string, failed: boolean) =>
			(
				file: string,
				args: readonly string[],
				done: (error: Error | null, stdout: string) => void
			) => {
				calls.push([file, ...args])
				done(failed ? new Error('no osascript') : null, stdout)
			}
		expect([
			await readFocusRing(answering('8426857f\n', false)),
			await readFocusRing(answering('', true))
		]).toEqual(['#8426857f', null])
		expect(calls[0]?.slice(0, 3)).toEqual(['osascript', '-l', 'JavaScript'])
	})
})
