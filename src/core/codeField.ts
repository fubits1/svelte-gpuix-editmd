/** a fenced code Block's opening line with its newline, its code, and its closing line with the newline before it */
export type FenceParts = { open: string; code: string; close: string }

/** an opening fence: up to three spaces, three or more backticks or tildes, an info string, its line's end */
const OPENING = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/

/**
 * the parts of the fenced code Block `source`, which editmd edits as its code alone (its code block node holds the code;
 * the fences are no text of its editor); null for an indented code block, which has no fences. a fence left open has
 * no closing part
 */
export function fenceParts(source: string): FenceParts | null {
	const opening = OPENING.exec(source)
	if (!opening) return null
	const fence = opening[1]!
	const rest = source.slice(opening[0].length)
	// a closing fence is a line of the same character, at least as long, up to three spaces in
	const closing = new RegExp(`(?:^|\\n) {0,3}\\${fence[0]}{${fence.length},}[ \\t]*$`).exec(rest)
	if (!closing) return { open: opening[0], code: rest, close: '' }
	return { open: opening[0], code: rest.slice(0, closing.index), close: rest.slice(closing.index) }
}

/** the Block's source with `code` back between the fences of `parts`, the closing fence on a line of its own */
export function withFences({ open, close }: FenceParts, code: string): string {
	const lineBreak = close !== '' && !close.startsWith('\n') && code !== '' ? '\n' : ''
	return `${open}${code}${lineBreak}${close}`
}
