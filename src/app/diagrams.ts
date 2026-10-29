import { type MermaidResult, type Palette, renderMermaid } from '../core/mermaid.ts'

/**
 * editmd's diagrams.ts: the first render is immediate, and a re-render while the source is edited waits for
 * this pause in typing (`setTimeout(run, 300)`)
 */
export const DIAGRAM_RERENDER_DELAY = 300

/** what a mermaid Block shows: its diagram, the reason it could not be drawn, or editmd's note for no source */
export type Diagram = MermaidResult | { kind: 'empty'; message: string }

/** the diagram source inside a mermaid Block's Slice: the lines between its fences */
export function diagramSource(slice: string): string {
	const lines = slice.split('\n')
	// the slice may end on the closing fence or on the newline after it
	while (lines.length > 1 && lines.at(-1)?.trim() === '') lines.pop()
	// GFM: the closing fence is the opening's character, at least as many of it, and nothing after but spaces
	const opening = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0] ?? '')?.[1] ?? '```'
	const closing = new RegExp(`^ {0,3}${opening[0] === '`' ? '`' : '~'}{${opening.length},}[ \\t]*$`)
	const closed = lines.length > 1 && closing.test(lines.at(-1) ?? '')
	return lines.slice(1, closed ? -1 : undefined).join('\n')
}

/**
 * `source` drawn as editmd draws it: a blank one is "Empty diagram", and an error keeps only its first four
 * non-blank lines (`errorText`)
 */
export function diagramOf(source: string, palette: Palette): Diagram {
	if (!source.trim()) return { kind: 'empty', message: 'Empty diagram' }
	const result = renderMermaid(source, palette)
	if (result.kind === 'diagram') return result
	return { kind: 'error', message: errorText(result.message) }
}

/** editmd's `errorText`: the first four non-blank lines of a render error */
export function errorText(message: string): string {
	return message
		.split('\n')
		.filter((line) => line.trim())
		.slice(0, 4)
		.join('\n')
}
