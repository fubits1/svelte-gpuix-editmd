/**
 * `source`, a Block's text from Document offset `start`, as its lines, each with the Document offset it starts at. a
 * Block inside a quote or a list item (`prefix`, engine/blocks.ts) leaves out what its container puts in front of each
 * line after its first, so a view reads it line by line as a top-level Block's
 */
export function blockLines(
	source: string,
	start: number,
	prefix?: string
): { text: string; at: number }[] {
	const container = prefix === undefined ? null : new RegExp(`^${prefix}`)
	let at = start
	return source.split('\n').map((line, index) => {
		const cut = index === 0 ? 0 : (container?.exec(line)?.[0].length ?? 0)
		const entry = { text: line.slice(cut), at: at + cut }
		at += line.length + 1
		return entry
	})
}
