import { type BlockKind, blockKindOf } from '../engine/blocks.ts'
import { commonEnds } from './diff.ts'

/**
 * where in `base` Return was pressed. `base` is the field's text when Return was pressed, `before` the field's last
 * report before the newline typed for Return landed, and `field` the report that brought it: keys the user typed
 * after Return reach the field first, so what changed from `base` to `before` came after Return. null when `field` is
 * not `before` with one newline put in, as when the newline replaced a selection
 */
export function returnAfterTyping(base: string, before: string, field: string): number | null {
	const landed = commonEnds(before, field)
	if (landed.aEnd !== landed.start || field.slice(landed.start, landed.bEnd) !== '\n') return null
	return before === base ? landed.start : commonEnds(base, before).aEnd
}

/**
 * what Return does in a Block's field, as editmd's Enter does: `newline` keeps the newline typed (`newlineInCode`, and
 * the Blocks editmd edits as source); `split` ends the Block at the caret and makes the rest a new Block
 * (`splitBlock`, `liftEmptyBlock`); `field` changes the Block's own text, a new list item or quote line, with the
 * caret after its marker (`splitListItem`)
 */
export type ReturnEdit =
	| { kind: 'newline' }
	| { kind: 'split'; head: string; tail: string }
	| { kind: 'field'; field: string; caret: number }

/**
 * an empty paragraph as editmd writes it, all but the last at the document's end (@milkdown/preset-commonmark
 * empty-line-br.ts), which keeps it from folding away
 */
export const EMPTY_PARAGRAPH = '<br />'

/** a Block source that is editmd's empty paragraph: a lone `<br>` in any spelling, which it paints as one blank line */
export const isEmptyParagraph = (source: string): boolean => /^<br\s*\/?\s*>$/i.test(source.trim())

/** a list item's marker line: indent, bullet or number with its delimiter, the space after it, a task box, its text */
const ITEM_LINE = /^(\s*)(?:([-+*])|(\d+)([.)]))(\s+)(\[[ xX]\]\s)?(.*)$/

/** the spaces that indent a line under the text of the item whose marker line is `line`, its task box left out */
const textIndent = (line: string, item: RegExpExecArray) =>
	' '.repeat(line.length - item[7]!.length - (item[6]?.length ?? 0))

/**
 * Backspace typed at a list item's start, which took the space after its marker out of the field (`before` to
 * `after`): editmd's `joinBackward` (preset-commonmark list-item.ts:167-181) joins the item to the one above it as
 * that item's paragraph, indented to its marker, so an empty new bullet goes and its line stays; the list's first
 * item leaves the list as a paragraph (run in editmd's own editor). the field's new text and its caret; null for any
 * other Backspace, which stays the field's own
 */
export function backspaceEdit(
	before: string,
	after: string
): { field: string; caret: number } | null {
	const { start, aEnd, bEnd } = commonEnds(before, after)
	if (aEnd !== start + 1 || bEnd !== start) return null
	const lineStart = before.lastIndexOf('\n', start) + 1
	const lineEnd = before.indexOf('\n', start)
	const line = before.slice(lineStart, lineEnd < 0 ? undefined : lineEnd)
	const item = ITEM_LINE.exec(line)
	if (!item || start + 1 - lineStart !== line.length - item[7]!.length) return null
	const text = item[7]!
	const rest = before.slice(lineStart + line.length)
	const sameDepth = (above: string) => ITEM_LINE.exec(above)?.[1] === item[1]
	const previous = before.slice(0, lineStart).split('\n').slice(0, -1).findLast(sameDepth)
	if (previous === undefined) {
		return { field: before.slice(0, lineStart) + text + rest, caret: lineStart }
	}
	const indent = textIndent(previous, ITEM_LINE.exec(previous)!)
	const field = `${before.slice(0, lineStart)}\n${indent}${text}${rest}`
	return { field, caret: lineStart + 1 + indent.length }
}

/** Blocks whose last line holds text that a paragraph after them joins onto */
const JOINS_ONTO = new Set<BlockKind>(['paragraph', 'heading', 'list', 'blockquote'])

/**
 * Backspace at the start of the Block `block`, a paragraph or heading, after the Block `previous`: editmd's
 * `joinBackward` puts its text, its own heading marks left behind, on the end of `previous`'s last line (run in
 * editmd's own editor). the joined source and the caret where the two meet; null when `previous` has no text line to
 * join onto or `block` is another kind, which Backspace leaves as it is
 */
export function joinedBlocks(
	previous: string,
	block: string
): { source: string; caret: number } | null {
	const kind = blockKindOf(block)
	if ((kind !== 'paragraph' && kind !== 'heading') || !JOINS_ONTO.has(blockKindOf(previous)))
		return null
	const text = kind === 'heading' ? block.replace(/^ {0,3}#{1,6}[ \t]+/, '') : block
	return { source: previous + text, caret: previous.length }
}

/** an ATX heading's first line: its hashes and its text */
const ATX_LINE = /^ {0,3}(#{1,6})[ \t]+(.*)$/

/**
 * the Block `source` its field leaves, with its hard breaks as editmd writes them (run in editmd's own editor): a
 * break with nothing after it in its paragraph, at the Block's end or before a blank line, is no break and goes; an
 * ATX heading's break, which would end the heading, turns the heading setext at levels 1 and 2 (remark's underline,
 * as long as its last line) and becomes a space below them; an empty list item keeps no space after its marker
 */
export function settledBreaks(source: string): string {
	const ended = source
		.replace(/\\\n[ \t>]*$/, '')
		.replace(/\\(?=\n[ \t>]*\n)/g, '')
		// an empty item is written as its marker alone
		.replace(/^([ \t]*(?:[-+*]|\d{1,9}[.)]))[ \t]+$/gm, '$1')
	const lines = ended.split('\n')
	const heading = ATX_LINE.exec(lines[0]!)
	const blank = lines.findIndex((line, index) => index > 0 && line.trim() === '')
	const end = blank < 0 ? lines.length : blank
	if (!heading || !lines[0]!.endsWith('\\') || end < 2) return ended
	const [, hashes, text] = heading
	const body = [text!, ...lines.slice(1, end)]
	const settled =
		hashes!.length <= 2
			? `${body.join('\n')}\n${(hashes === '#' ? '=' : '-').repeat(body.at(-1)!.length)}`
			: `${hashes} ${body.map((line) => line.replace(/\\$/, '').trim()).join(' ')}`
	return [settled, ...lines.slice(end)].join('\n')
}

/** a quote line: its `>` marks and the text after them */
const QUOTE_LINE = /^(\s*>\s?)(.*)$/

/** Blocks whose text keeps Return's newline: code (`newlineInCode`) and the Blocks editmd edits as source */
const KEEPS_NEWLINE = new Set<BlockKind>(['code', 'mermaid', 'frontmatter', 'html'])

/**
 * Return typed into a field: `at` is where its newline sits in `field`. with `shift`, a hard break (hardbreak.ts
 * Shift-Enter), which editmd's serializer writes as a backslash before the line break
 */
export function returnEdit(field: string, at: number, shift = false): ReturnEdit {
	const head = field.slice(0, at)
	const tail = field.slice(at + 1)
	const kind = blockKindOf(head + tail)
	// a code block takes no hard break, so Shift-Return there does nothing
	if (shift && (kind === 'code' || kind === 'mermaid'))
		return { kind: 'field', field: head + tail, caret: at }
	if (KEEPS_NEWLINE.has(kind)) return { kind: 'newline' }
	// a table's Enter is `exitTable` (preset-gfm table/input.ts:247-253): the table stays whole and a paragraph follows;
	// Shift-Return keeps the newline, as before
	if (kind === 'table')
		return shift ? { kind: 'newline' } : { kind: 'split', head: head + tail, tail: '' }

	const lineStart = head.lastIndexOf('\n') + 1
	const line = head.slice(lineStart)
	// the item the caret's line belongs to: its own marker line, or the nearest one above a line after a hard break
	const markerLine =
		kind === 'list' ? head.split('\n').findLast((each) => ITEM_LINE.test(each)) : undefined
	const item = markerLine === undefined ? null : ITEM_LINE.exec(markerLine)
	const quote = kind === 'blockquote' ? QUOTE_LINE.exec(line) : null

	if (shift) {
		// the next line is indented to the item's text, its task box left out, or keeps the quote's marks
		const continued = item ? textIndent(markerLine!, item) : (quote?.[1] ?? '')
		return {
			kind: 'field',
			field: `${head}\\\n${continued}${tail}`,
			caret: at + 2 + continued.length
		}
	}

	// an empty item or quote line ends the list or quote: the line goes, the rest is a new Block
	const leave: ReturnEdit = { kind: 'split', head: head.slice(0, Math.max(0, lineStart - 1)), tail }
	const restOfLine = tail.split('\n')[0]

	if (item) {
		const [, indent, bullet, number, delimiter, space, box, itemText] = item
		const text = markerLine === line ? itemText : line.trim()
		if (text === '' && restOfLine === '') return leave
		const marker = bullet ?? `${Number(number) + 1}${delimiter}`
		const prefix = `${indent}${marker}${space}${box ? '[ ] ' : ''}`
		return { kind: 'field', field: `${head}\n${prefix}${tail}`, caret: at + 1 + prefix.length }
	}

	if (quote) {
		const [, marks, text] = quote
		// the empty paragraph leaves the quote with the blank `>` line that opened it
		if (text === '' && restOfLine === '')
			return { kind: 'split', head: leave.head.replace(/\n[ \t]*>[ \t]*$/, ''), tail }
		// splitBlock makes a new paragraph in the quote: a blank quote line, then the new one
		const blank = marks!.trimEnd()
		const field = `${head}\n${blank}\n${marks}${tail}`
		return { kind: 'field', field, caret: at + 2 + blank.length + marks!.length }
	}

	// splitBlock on an empty paragraph keeps it, written as editmd writes one, and starts another after it
	if (head.trim() === '' && tail.trim() === '')
		return { kind: 'split', head: EMPTY_PARAGRAPH, tail: '' }
	// splitBlock keeps the node's type for a split inside it, so the rest of a heading is a heading of its level
	const hashes =
		kind === 'heading' && tail.trim() !== '' ? /^(#{1,6})[ \t]/.exec(head)?.[1] : undefined
	return { kind: 'split', head, tail: hashes ? `${hashes} ${tail.trimStart()}` : tail }
}
