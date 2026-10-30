import { type BlockKind, blockKindOf } from '../engine/blocks.ts'

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
	if (KEEPS_NEWLINE.has(kind)) return { kind: 'newline' }
	// a table's Enter is `exitTable` (preset-gfm table/input.ts:247-253): the table stays whole and a paragraph follows;
	// Shift-Return keeps the newline, as before
	if (kind === 'table')
		return shift ? { kind: 'newline' } : { kind: 'split', head: head + tail, tail: '' }
	if (shift) return { kind: 'field', field: `${head}\\\n${tail}`, caret: at + 2 }

	const lineStart = head.lastIndexOf('\n') + 1
	const line = head.slice(lineStart)
	// an empty item or quote line ends the list or quote: the line goes, the rest is a new Block
	const leave: ReturnEdit = { kind: 'split', head: head.slice(0, Math.max(0, lineStart - 1)), tail }
	const restOfLine = tail.split('\n')[0]

	const item = kind === 'list' ? ITEM_LINE.exec(line) : null
	if (item) {
		const [, indent, bullet, number, delimiter, space, box, text] = item
		if (text === '' && restOfLine === '') return leave
		const marker = bullet ?? `${Number(number) + 1}${delimiter}`
		const prefix = `${indent}${marker}${space}${box ? '[ ] ' : ''}`
		return { kind: 'field', field: `${head}\n${prefix}${tail}`, caret: at + 1 + prefix.length }
	}

	const quote = kind === 'blockquote' ? QUOTE_LINE.exec(line) : null
	if (quote) {
		const [, marks, text] = quote
		if (text === '' && restOfLine === '') return leave
		return { kind: 'field', field: `${head}\n${marks}${tail}`, caret: at + 1 + marks!.length }
	}

	// splitBlock keeps the node's type for a split inside it, so the rest of a heading is a heading of its level
	const hashes =
		kind === 'heading' && tail.trim() !== '' ? /^(#{1,6})[ \t]/.exec(head)?.[1] : undefined
	return { kind: 'split', head, tail: hashes ? `${hashes} ${tail.trimStart()}` : tail }
}
