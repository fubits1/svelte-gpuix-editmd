import { type BlockKind, blockKindOf } from '../engine/blocks.ts'
import { tableCells } from './tableCells.ts'

/** Blocks with no text to hold a link */
const HOLDS_NO_LINK = new Set<BlockKind>(['frontmatter', 'definition', 'thematicBreak'])

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
	const kind = blockKindOf(source)
	if (HOLDS_NO_LINK.has(kind)) return null

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
	// editmd's link toggles as a mark (toggleLinkCommand is toggleMark): a selection holding a link loses it
	if (start < end) {
		const toggled = unlinked(source, start, end)
		if (toggled !== null) return toggled
	}
	const kind = blockKindOf(source)
	if (kind === 'code' || kind === 'mermaid') {
		// editmd refuses a selection in code; a caret takes the URL as text
		return start === end ? `${source.slice(0, start)}${href}${source.slice(end)}` : null
	}
	if (HOLDS_NO_LINK.has(kind)) return null
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
			// editmd's Edit Link puts a mark of only the new href on the link (editor.ts:388-390): its title goes
			const text = link[4] === undefined ? link[1] : linkTextOf(link[4])
			return `${source.slice(0, from)}[${text}](${destinationOf(href)})${source.slice(to)}`
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
	const ranges: Range[] = []
	let lineStart = 0
	for (const line of source.split('\n')) {
		const from = Math.max(start, lineStart + (LINE_PREFIX.exec(line)?.[0].length ?? 0))
		const to = Math.min(end, lineStart + line.length)
		if (from < to) ranges.push({ from, to })
		lineStart += line.length + 1
	}
	return linkRanges(source, ranges, href)
}

type Range = { from: number; to: number }

/** `source` with each of `ranges`, in order and apart, written as a link to `href` with its own text */
function linkRanges(source: string, ranges: readonly Range[], href: string): string {
	let out = ''
	let at = 0
	for (const { from, to } of ranges) {
		out += `${source.slice(at, from)}[${linkTextOf(source.slice(from, to))}](${destinationOf(href)})`
		at = to
	}
	return out + source.slice(at)
}

/** a URL GFM links as it stands (an autolink literal), which editmd's editor reads as a link to itself */
const BARE_URL = /(?<![\w<(\\/])https?:\/\/[^\s<]*[^\s<?!.,:*_~'")\]]/gi

/**
 * `source` with the links at a caret `start === end`, or across `[start, end)`, written as their text alone; null when
 * no link is there. a URL left as text gets its colon escaped, as editmd's serializer writes it, or GFM links it again
 */
function unlinked(source: string, start: number, end: number): string | null {
	const links = [...source.matchAll(LINKS), ...source.matchAll(BARE_URL)].sort(
		(a, b) => a.index - b.index
	)
	let out = ''
	let at = 0
	for (const link of links) {
		const from = link.index
		const to = from + link[0].length
		const reached = start === end ? start > from && start < to : start < to && end > from
		if (from < at || !reached) continue
		out +=
			source.slice(at, from) + (link[1] ?? (link[4] ?? link[0]).replace(/^(https?):/i, '$1\\:'))
		at = to
	}
	return at === 0 ? null : out + source.slice(at)
}

/**
 * a selection across table rows: editmd's link mark covers the text of each cell it reaches, so each cell's selected
 * text becomes its own link and the pipes stay as they are (run in editmd's own editor)
 */
function linkEachCell(source: string, start: number, end: number, href: string): string {
	const ranges = tableCells(source)
		.map((cell) => ({ from: Math.max(start, cell.from), to: Math.min(end, cell.to) }))
		.filter(({ from, to }) => from < to)
	return linkRanges(source, ranges, href)
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
