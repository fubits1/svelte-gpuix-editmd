import { execFile } from 'node:child_process'

/**
 * how macOS shows scroll bars, as AppKit's `NSScroller.preferredScrollerStyle` says: `overlay` only while the view
 * scrolls, as editmd's web view shows its page's with a trackpad and "Show scroll bars: Automatically", `legacy`
 * always
 */
export type ScrollerStyle = 'overlay' | 'legacy'

/** the style from what `preferredScrollerStyle` prints: 0 legacy, 1 overlay; anything else reads as overlay */
export function scrollerStyleFrom(output: string): ScrollerStyle {
	return output.trim() === '0' ? 'legacy' : 'overlay'
}

/** runs a program and hands back what it printed, as node's `execFile` does */
type Run = (
	file: string,
	args: readonly string[],
	done: (error: Error | null, stdout: string) => void
) => void

const run: Run = (file, args, done) =>
	execFile(file, args, { encoding: 'utf8' }, (error, stdout) => done(error, stdout))

/** the system's scroller style, asked of AppKit through osascript (about 40ms, so never on the window's thread) */
export function readScrollerStyle(runner: Run = run): Promise<ScrollerStyle> {
	return new Promise((resolve) => {
		runner(
			'osascript',
			['-l', 'JavaScript', '-e', "ObjC.import('AppKit'); $.NSScroller.preferredScrollerStyle"],
			(error, stdout) => resolve(scrollerStyleFrom(error ? '' : stdout))
		)
	})
}
