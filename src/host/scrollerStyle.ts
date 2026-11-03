import { readJxa, type Run } from './jxa.ts'

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

/** the system's scroller style, asked of AppKit */
export async function readScrollerStyle(runner?: Run): Promise<ScrollerStyle> {
	return scrollerStyleFrom(
		await readJxa("ObjC.import('AppKit'); $.NSScroller.preferredScrollerStyle", runner)
	)
}
