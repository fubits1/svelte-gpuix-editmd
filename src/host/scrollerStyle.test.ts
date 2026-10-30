import { describe, expect, test } from 'vitest'
import { readScrollerStyle, scrollerStyleFrom } from './scrollerStyle.ts'

// NSScroller.preferredScrollerStyle: 0 legacy (always shown), 1 overlay (shown while scrolling); macOS's
// "Show scroll bars: Automatically" gives overlay with a trackpad, which this Mac printed (1)
describe('scrollerStyle', () => {
	test('AppKit’s preferred style: 0 is legacy, 1 is overlay, and anything else reads as overlay', () => {
		expect([scrollerStyleFrom('0\n'), scrollerStyleFrom('1\n'), scrollerStyleFrom('')]).toEqual([
			'legacy',
			'overlay',
			'overlay'
		])
	})

	test('reads the style through osascript without blocking, and a failed run reads as overlay', async () => {
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
			await readScrollerStyle(answering('0\n', false)),
			await readScrollerStyle(answering('', true))
		]).toEqual(['legacy', 'overlay'])
		expect(calls[0]?.slice(0, 3)).toEqual(['osascript', '-l', 'JavaScript'])
	})
})
