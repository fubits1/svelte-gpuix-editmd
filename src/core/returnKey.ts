import { type BlockKind, blockKindOf } from '../engine/blocks.ts'
import { commonEnds } from './diff.ts'

/**
 * Return placed where it was pressed. `base` is the field's text when Return was pressed, `before` the field's last
 * report before the newline typed for Return landed, and `field` the report that brought it: keys the user typed
 * after Return reach the field first, so what changed from `base` to `before` came after Return. `at` is where Return
 * was in `base`, `typed` the text typed after it and `deleted` how many characters Backspaces took before it. null
 * when `field` is not `before` with one newline put in, as when the newline replaced a selection
 */
export function returnAfterTyping(
	base: string,
	before: string,
	field: string
): { at: number; typed: string; deleted: number } | null {
	const landed = commonEnds(before, field)
	if (landed.aEnd !== landed.start || field.slice(landed.start, landed.bEnd) !== '\n') return null
	if (before === base) return { at: landed.start, typed: '', deleted: 0 }
	const { start, aEnd, bEnd } = commonEnds(base, before)
	return { at: aEnd, typed: before.slice(start, bEnd), deleted: aEnd - start }
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

/** a list item's marker line: indent, bullet or number with its delimiter, the space after it, a task box, its text */
const ITEM_LINE = /^(\s*)(?:([-+*])|(\d+)([.)]))(\s+)(\[[ xX]\]\s)?(.*)$/

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
	const marker = ITEM_LINE.exec(previous)!
	const indent = ' '.repeat(previous.length - marker[7]!.length - (marker[6]?.length ?? 0))
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
		const continued = item
			? ' '.repeat(markerLine!.length - item[7]!.length - (item[6]?.length ?? 0))
			: (quote?.[1] ?? '')
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

	// splitBlock keeps the node's type for a split inside it, so the rest of a heading is a heading of its level
	const hashes =
		kind === 'heading' && tail.trim() !== '' ? /^(#{1,6})[ \t]/.exec(head)?.[1] : undefined
	return { kind: 'split', head, tail: hashes ? `${hashes} ${tail.trimStart()}` : tail }
}
