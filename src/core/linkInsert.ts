import { parseBlocks } from '../engine/blocks.ts'

/** what mdast-util-to-markdown writes as an autolink: a protocol, and nothing an autolink cannot hold */
const AUTOLINKABLE = /^[a-z][a-z+.-]+:[^\0- <>\u007F]*$/i

/**
 * a link's destination as editmd's serializer writes it: in angle brackets when it holds a space or `<`/`>`, else
 * with its parentheses escaped, so none of them ends the link early (measured in editmd's own editor)
 */
const destinationOf = (url: string) =>
	/\s/.test(url)
		? `<${url.replace(/[<>]/g, (bracket) => `\\${bracket}`)}>`
		: url.replace(/[()]/g, (paren) => `\\${paren}`)

/**
 * a link's text with its brackets escaped, and a `<` that could open a tag or an autolink, as editmd's serializer
 * writes it; ones already escaped stay
 */
const linkTextOf = (text: string) =>
	text.replace(/(?<!\\)(?:[[\]]|<(?=[A-Za-z/!?]))/g, (character) => `\\${character}`)

/** a link whose text is its own URL, as editmd's serializer writes one */
function linkOf(url: string): string {
	if (AUTOLINKABLE.test(url)) return `<${url}>`
	return `[${linkTextOf(url)}](${destinationOf(url)})`
}

const CLOSING_FENCE = /\n( {0,3}(`{3,}|~{3,})[ \t]*)$/

/**
 * Add Link with nothing selected (editmd editor.ts:387-396): the URL goes in at the caret as its own link
 * text. the gpuix text field reports no caret (gap G1), so it goes in at the end of the Block, where the
 * field puts its caret; in code, which takes no links, as plain text; in a table, into its last cell.
 * null for an empty URL, which editmd refuses with nothing selected, and for Blocks with no text to
 * hold a link (front matter, definitions, rules)
 */
export function insertLink(source: string, url: string): string | null {
	const href = url.trim()
	if (href === '') return null
	const kind = parseBlocks(source)[0]?.kind ?? 'paragraph'

	switch (kind) {
		case 'code':
		case 'mermaid': {
			const fence = CLOSING_FENCE.exec(source)
			// an indented code block ends with its text
			if (!fence) return `${source}${href}`
			return `${source.slice(0, fence.index)}${href}\n${fence[1]}`
		}
		case 'table': {
			const lastPipe = source.lastIndexOf('|')
			const cellEnd = source.slice(0, lastPipe).trimEnd().length
			return `${source.slice(0, cellEnd)}${linkOf(href)}${source.slice(cellEnd)}`
		}
		case 'frontmatter':
		case 'definition':
		case 'thematicBreak':
			return null
		default:
			return `${source}${linkOf(href)}`
	}
}

/**
 * an inline link `[text](destination "title")` or an autolink `<url>`, and where its destination is; a backslash
 * escapes the character after it in the text and the destination
 */
const LINKS =
	/\[((?:\\.|[^\]\n\\])*)\]\((<(?:\\.|[^>\n\\])*>|(?:\\.|[^)\s\\])*)((?:\s+"[^"\n]*")?)\)|<([a-z][a-z+.-]+:[^\0- <>\u007F]*)>/gi

/**
 * Add Link at the field's selection, as editmd's `toggleLink` (editor.ts:374-399): a caret inside a link gives it
 * the new URL (Edit Link); a selection becomes the link's text; a caret takes the URL as its own link text where it
 * is; in code, which takes no links, the URL goes in as text. `range` is the selection in `source`, learnt by
 * the sentinel probe (core/fieldSelection.ts). an empty URL takes the link off at the caret or across the
 * selection, as editmd's Add with nothing in the field does (EditorWindowController.swift:133-134, editor.ts:380-385);
 * null when that changes nothing
 */
export function linkAtSelection(
	source: string,
	range: { start: number; end: number },
	url: string
): string | null {
	const href = url.trim()
	const { start, end } = range
	if (href === '') return unlinked(source, start, end)
	const kind = parseBlocks(source)[0]?.kind ?? 'paragraph'
	if (kind === 'code' || kind === 'mermaid') {
		// editmd refuses a selection in code; a caret takes the URL as text
		return start === end ? `${source.slice(0, start)}${href}${source.slice(end)}` : null
	}
	// no text to hold a link, as for insertLink
	if (kind === 'frontmatter' || kind === 'definition' || kind === 'thematicBreak') return null
	if (source.slice(start, end).includes('\n')) {
		return kind === 'table'
			? linkEachCell(source, start, end, href)
			: linkEachLine(source, start, end, href)
	}
	if (start === end) {
		for (const link of source.matchAll(LINKS)) {
			const from = link.index
			const to = from + link[0].length
			if (start <= from || start >= to) continue
			const text = link[4] === undefined ? link[1] : linkTextOf(link[4])
			const replaced = `[${text}](${destinationOf(href)}${link[3] ?? ''})`
			return `${source.slice(0, from)}${replaced}${source.slice(to)}`
		}
		return `${source.slice(0, start)}${linkOf(href)}${source.slice(start)}`
	}
	const selected = source.slice(start, end)
	const link =
		selected === href && AUTOLINKABLE.test(href)
			? `<${href}>`
			: `[${linkTextOf(selected)}](${destinationOf(href)})`
	return `${source.slice(0, start)}${link}${source.slice(end)}`
}

/** what opens a line before its text: indentation, quote marks, a list marker, a task box, heading marks */
const LINE_PREFIX =
	/^[ \t]*(?:(?:>[ \t]?)|(?:[-*+][ \t]+)|(?:\d{1,9}[.)][ \t]+))*(?:\[[ xX]\][ \t]+)?(?:#{1,6}[ \t]+)?/

/**
 * a selection over several lines: editmd's link mark covers the text of each textblock it reaches, so each line's
 * selected text becomes its own link, its prefix left out (measured in editmd's own editor)
 */
function linkEachLine(source: string, start: number, end: number, href: string): string {
	let out = ''
	let lineStart = 0
	for (const line of source.split('\n')) {
		const lineEnd = lineStart + line.length
		const from = Math.max(start, lineStart + (LINE_PREFIX.exec(line)?.[0].length ?? 0))
		const to = Math.min(end, lineEnd)
		out +=
			from < to
				? `${source.slice(lineStart, from)}[${linkTextOf(source.slice(from, to))}](${destinationOf(href)})${source.slice(to, lineEnd)}`
				: line
		if (lineEnd < source.length) out += '\n'
		lineStart = lineEnd + 1
	}
	return out
}

/**
 * `source` with the links at a caret `start === end`, or across `[start, end)`, written as their text alone; null when
 * no link is there
 */
function unlinked(source: string, start: number, end: number): string | null {
	let out = ''
	let at = 0
	for (const link of source.matchAll(LINKS)) {
		const from = link.index
		const to = from + link[0].length
		const reached = start === end ? start > from && start < to : start < to && end > from
		if (!reached) continue
		out += source.slice(at, from) + (link[4] ?? link[1] ?? '')
		at = to
	}
	return at === 0 ? null : out + source.slice(at)
}

/** where each cell's text lies in a table row `line` starting at `lineStart`: between unescaped pipes, trimmed */
function cellTexts(line: string, lineStart: number): { from: number; to: number }[] {
	const pipes = [...line.matchAll(/(?<!\\)\|/g)].map((pipe) => pipe.index)
	// a row may leave out its outer pipes
	const edges = [
		...(line.trimStart().startsWith('|') ? [] : [-1]),
		...pipes,
		...(line.trimEnd().endsWith('|') ? [] : [line.length])
	]
	const cells: { from: number; to: number }[] = []
	for (let i = 0; i + 1 < edges.length; i++) {
		const cell = line.slice(edges[i]! + 1, edges[i + 1])
		const lead = cell.length - cell.trimStart().length
		const text = cell.trim()
		if (text === '') continue
		const from = lineStart + edges[i]! + 1 + lead
		cells.push({ from, to: from + text.length })
	}
	return cells
}

/** a table's delimiter row, `| - | :-: |` */
const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/**
 * a selection across table rows: editmd's link mark covers the text of each cell it reaches, so each cell's selected
 * text becomes its own link and the pipes stay as they are (run in editmd's own editor)
 */
function linkEachCell(source: string, start: number, end: number, href: string): string {
	const pieces: { from: number; to: number }[] = []
	let lineStart = 0
	for (const line of source.split('\n')) {
		if (!DELIMITER_ROW.test(line)) {
			for (const cell of cellTexts(line, lineStart)) {
				const from = Math.max(start, cell.from)
				const to = Math.min(end, cell.to)
				if (from < to) pieces.push({ from, to })
			}
		}
		lineStart += line.length + 1
	}
	let out = ''
	let at = 0
	for (const { from, to } of pieces) {
		out += `${source.slice(at, from)}[${linkTextOf(source.slice(from, to))}](${destinationOf(href)})`
		at = to
	}
	return out + source.slice(at)
}

/** the pasteboard's text as the sheet's URL when it is a web or mail address (EditorWindowController.swift:144-150) */
export function urlFromClipboard(text: string): string | null {
	const trimmed = text.trim()
	if (!/^(https?|mailto):/.test(trimmed)) return null
	// as Foundation's URL(string:).absoluteString: past the host, what a URL cannot hold as written is percent-encoded
	// (spaces, non-ASCII, `| < > { } " ^ \` \\ [ ]`, a `%` with no two hex digits after it, a second `#`), escapes kept
	const authority = /^[a-z]+:\/\/[^/?#]*/i.exec(trimmed)?.[0] ?? /^[a-z]+:/i.exec(trimmed)![0]
	let fragment = false
	const rest = trimmed
		.slice(authority.length)
		.replace(/%(?![0-9a-f]{2})|#|[^\x21-\x7E]|[|<>{}"^`\\[\]]/giu, (character) => {
			if (character === '#') {
				if (fragment) return '%23'
				fragment = true
				return '#'
			}
			if (character === '%') return '%25'
			return [...new TextEncoder().encode(character)]
				.map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
				.join('')
		})
	const encoded = `${authority.replace(/[^\x21-\x7E]/gu, (character) => encodeURIComponent(character))}${rest}`
	// a space in the host makes no URL either way (`%20` is no host character)
	return URL.canParse(encoded) ? encoded : null
}
