/**
 * a table cell's text as the width it paints is measured: native <markdown> has no width of its own, so a hidden line
 * of the cell's text sizes its column, as `width: max-content` does. its sans text goes in a <text>; its code spans
 * paint in SF Mono at the cell's size (measured headless), wider than the sans, so they are measured apart
 */
export type CellSizing = { plain: string; code: string[] }

/** the named entities a cell is likely to hold, as the characters they paint */
const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' '
}

/** a code span: a run of backticks, its text, and a closing run of the same length */
const CODE_SPAN = /(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g

/** a code span's text as it paints: one space off each end when both ends have one and it is not all spaces */
function codeText(inner: string): string {
	return inner.startsWith(' ') && inner.endsWith(' ') && inner.trim() !== ''
		? inner.slice(1, -1)
		: inner
}

/**
 * `source`, a cell's markdown, split into the sans text it paints and its code spans: a link, a reference link, a
 * footnote reference and an autolink by the text they show, emphasis and strike marks and escapes taken out, and
 * entities as their characters
 */
export function cellSizing(source: string): CellSizing {
	const code: string[] = []
	const plain = source
		.replace(CODE_SPAN, (_span, _fence: string, inner: string) => {
			code.push(codeText(inner))
			return ''
		})
		.replace(/\[\^([^\]]+)\]/g, '$1')
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
		.replace(/<([a-z][a-z0-9+.-]*:[^\s<>]*)>/gi, '$1')
		.replace(/(?<!\\)(\*\*|__|~~|[*_])/g, '')
		.replace(/\\(.)/g, '$1')
		.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, name: string) => {
			if (name.startsWith('#x') || name.startsWith('#X'))
				return String.fromCodePoint(Number.parseInt(name.slice(2), 16))
			if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10))
			return NAMED_ENTITIES[name.toLowerCase()] ?? entity
		})
	return { plain, code }
}
