import { markdownToMdast, type MdastNode } from 'satteri'
import { parseBlocks } from '../engine/blocks.ts'

/** editmd's block commands in its Format menu (MainMenu.swift:86-98, editor.ts:95-109) */
export type BlockFormat =
	| 'body'
	| 'heading1'
	| 'heading2'
	| 'heading3'
	| 'heading4'
	| 'heading5'
	| 'heading6'
	| 'bulletList'
	| 'numberedList'
	| 'indent'
	| 'outdent'
	| 'quote'
	| 'codeBlock'

const LEVELS: Partial<Record<BlockFormat, number>> = {
	body: 0,
	heading1: 1,
	heading2: 2,
	heading3: 3,
	heading4: 4,
	heading5: 5,
	heading6: 6
}

/**
 * a Format command on one Block's source, written as editmd writes it: editmd runs Milkdown's command at
 * its caret and serializes the result. `caret` is the field's caret offset in `source` (learnt by the
 * probe in core/fieldSelection.ts); without one it is taken to be at the end of the Block, where the field puts
 * it. in a list or a quote the command acts on the item or paragraph the caret is in. null where editmd's
 * command refuses (lists for all but Indent and Outdent, tables, definitions, front matter, rules) or changes
 * nothing
 */
export function formatBlock(
	format: BlockFormat,
	source: string,
	caret: number = source.length
): string | null {
	const result = formatted(format, source, caret)
	return result === source ? null : result
}

/** the nodes whose text a caret goes in, as ProseMirror's textblocks; editmd shows raw HTML as a paragraph */
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'tableCell', 'code', 'html'])

/** the first textblock in `nodes`, depth first */
function firstTextblock(nodes: readonly MdastNode[]): MdastNode | null {
	for (const node of nodes) {
		if (TEXTBLOCKS.has(node.type)) return node
		const inner = 'children' in node ? firstTextblock(node.children as MdastNode[]) : null
		if (inner) return inner
	}
	return null
}

/**
 * where a loaded document's caret is in a Block's `source`: ProseMirror's first cursor spot, the start of its first
 * textblock's text, past the Block's markers (`## `, `- `, `- [ ] `, `> `, a fence line, a table's `| `); editmd
 * focuses its editor on load (main.ts:80-84), so a command run with no field open acts there
 */
export function firstTextOffset(source: string): number | null {
	const root = markdownToMdast(source, { position: true })
	const block = firstTextblock('children' in root ? (root.children as MdastNode[]) : [])
	// a rule, a definition or front matter holds no caret: editmd's caret starts in the next textblock
	if (!block) return null
	const start = block.position?.start.offset ?? 0
	if (block.type === 'html') return start
	if (block.type === 'code') {
		// a fenced block's text starts on the line after its fence; an indented one after its four spaces
		if (/^ {0,3}(`{3,}|~{3,})/.test(source.slice(start))) {
			const newline = source.indexOf('\n', start)
			return newline < 0 ? source.length : newline + 1
		}
		return start + source.slice(start).match(/^ {0,4}/)![0].length
	}
	const first = 'children' in block ? (block.children as MdastNode[])[0] : undefined
	return first?.position?.start.offset ?? block.position?.end.offset ?? start
}

/** the line of `source` that offset `caret` is on, counting from 0 */
const lineAt = (source: string, caret: number) => source.slice(0, caret).split('\n').length - 1

function formatted(format: BlockFormat, source: string, caret: number): string | null {
	const block = parseBlocks(source)[0]
	switch (block?.kind ?? 'paragraph') {
		case 'paragraph':
		case 'html':
			return paragraph(format, source)
		case 'heading':
			return heading(format, source, block?.heading?.level ?? 0)
		case 'code':
		case 'mermaid':
			return code(format, source)
		case 'list':
			return list(format, source, lineAt(source, caret))
		case 'blockquote':
			return quoted(format, source, lineAt(source, caret))
		case 'footnoteDefinition':
			return footnote(format, source)
		default:
			return null
	}
}

/** a paragraph's lines as its text holds them: remark drops each line's leading whitespace */
const linesOf = (text: string) => text.split('\n').map((line) => line.trimStart())

/** a fence of backticks longer than any run inside `content`, as editmd's serializer picks it */
function fenced(content: string, lang = ''): string {
	const longestRun = Math.max(2, ...[...content.matchAll(/`+/g)].map(([run]) => run.length))
	const fence = '`'.repeat(longestRun + 1)
	return `${fence}${lang}\n${content}\n${fence}`
}

/**
 * a heading holding `text`: past one line it is written setext up to level 2, underlined as long as its
 * last line; from level 3 the line breaks stay in the text, which leaves only the first line a heading
 */
function headingOf(text: string, level: number): string {
	const lines = linesOf(text)
	if (lines.length > 1 && level <= 2) {
		return `${lines.join('\n')}\n${(level === 1 ? '=' : '-').repeat(lines.at(-1)!.length)}`
	}
	return `${'#'.repeat(level)} ${lines.join('\n')}`
}

function paragraph(format: BlockFormat, text: string): string | null {
	const level = LEVELS[format]
	if (level !== undefined) return level === 0 ? null : headingOf(text, level)

	const [first = '', ...rest] = linesOf(text)
	switch (format) {
		case 'bulletList':
			return [`- ${first}`, ...rest.map((line) => `  ${line}`)].join('\n')
		case 'numberedList':
			return [`1. ${first}`, ...rest.map((line) => `   ${line}`)].join('\n')
		case 'quote':
			return quote(text)
		// editmd's code block takes the paragraph's text, without its marks and line breaks
		case 'codeBlock':
			return fenced(plainText(linesOf(text).join('\n')))
		default:
			return null
	}
}

const ATX = /^ {0,3}#{1,6}(?:[ \t]+|$)/
const ATX_CLOSING = /[ \t]+#+[ \t]*$/
const SETEXT_UNDERLINE = /\n {0,3}(?:=+|-+)[ \t]*$/

/** the heading text of an ATX or setext heading */
function headingText(source: string): string {
	if (SETEXT_UNDERLINE.test(source)) return source.replace(SETEXT_UNDERLINE, '').trim()
	return source.replace(ATX, '').replace(ATX_CLOSING, '').trim()
}

function heading(format: BlockFormat, source: string, current: number): string | null {
	const text = headingText(source)
	const level = LEVELS[format]
	if (level !== undefined) {
		if (level === current) return null
		return level === 0 ? linesOf(text).join('\n') : headingOf(text, level)
	}
	if (format === 'quote') return quote(source)
	if (format === 'codeBlock') return fenced(plainText(linesOf(text).join('\n')))
	return null
}

type InlineNode = { type: string; value?: string; children?: InlineNode[] }

/**
 * the text of `markdown`'s inline content as a code block takes it: ProseMirror's code block holds no marks, so editmd
 * keeps the text of emphasis, links and inline code and drops the marks; atoms (images, inline HTML) and line breaks
 * add nothing
 */
function plainText(markdown: string): string {
	const root = markdownToMdast(markdown) as InlineNode
	const textOf = (node: InlineNode): string => {
		if (node.type === 'text' || node.type === 'inlineCode')
			return (node.value ?? '').replaceAll('\n', '')
		if (node.type === 'html' || node.type === 'image' || node.type === 'break') return ''
		return (node.children ?? []).map(textOf).join('')
	}
	return (root.children ?? []).map(textOf).join('')
}

const FENCE = /^ {0,3}(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n? {0,3}\1[ \t]*$/

/** a code block's content and info string; an indented block has no info string */
function codeOf(source: string): { content: string; info: string } {
	const fence = FENCE.exec(source)
	if (fence) return { content: fence[3]!, info: fence[2]!.trim() }
	return { content: source.replace(/^ {4}/gm, ''), info: '' }
}

function code(format: BlockFormat, source: string): string | null {
	const { content, info } = codeOf(source)
	const level = LEVELS[format]
	// a code block's text turns into one line of text, its line breaks spaces
	if (level !== undefined) {
		const text = content.split('\n').join(' ')
		return level === 0 ? text : `${'#'.repeat(level)} ${text}`
	}
	if (format === 'quote') return quote(source)
	// Code Block on a code block drops its language, and does nothing to one without
	if (format === 'codeBlock') return info === '' ? null : fenced(content)
	return null
}

/** `> ` before every line, a bare `>` on blank ones */
const quote = (source: string) =>
	source
		.split('\n')
		.map((line) => (line.trim() === '' ? '>' : `> ${line}`))
		.join('\n')

const QUOTE_MARKER = /^ {0,3}> ?/

/** a command in a quote acts on the paragraph the caret is in, on line `caretLine` */
function quoted(format: BlockFormat, source: string, caretLine: number): string | null {
	const inner = source.split('\n').map((line) => line.replace(QUOTE_MARKER, ''))
	const blank = (line: string) => line.trim() === ''
	const start = inner.slice(0, caretLine + 1).findLastIndex(blank) + 1
	const after = inner.slice(caretLine + 1).findIndex(blank)
	const end = after < 0 ? inner.length : caretLine + 1 + after
	const result = formatBlock(format, inner.slice(start, end).join('\n'))
	if (result === null) return null
	return quote([...inner.slice(0, start), result, ...inner.slice(end)].join('\n'))
}

const FOOTNOTE_LABEL = /^(\[\^[^\]\n]+\]:)[ \t]*/

/** a command in a footnote definition acts on its text; one of more than one paragraph is left alone */
function footnote(format: BlockFormat, source: string): string | null {
	const label = FOOTNOTE_LABEL.exec(source)
	if (!label) return null
	const text = linesOf(source.slice(label[0].length)).join('\n')
	if (/\n\s*\n/.test(text)) return null
	const result = formatBlock(format, text)
	if (result === null) return null
	const [first, ...rest] = result.split('\n')
	return [`${label[1]} ${first}`, ...rest.map((line) => (line === '' ? line : `    ${line}`))].join(
		'\n'
	)
}

const ITEM = /^( *)([-+*]|(\d+)([.)]))( +)(\[[ xX]\] +)?/

type Item = { line: number; indent: number; content: number; marker: RegExpExecArray }

/** the items whose marker starts a line, in order */
function itemsOf(lines: readonly string[]): Item[] {
	return lines.flatMap((text, line) => {
		const marker = ITEM.exec(text)
		if (!marker) return []
		const indent = marker[1]!.length
		return [{ line, indent, content: indent + marker[2]!.length + marker[5]!.length, marker }]
	})
}

/**
 * `lines` with the ordered items at `indent` from line `from` on, up to the first item less indented, numbered on
 * from `next`, as editmd's serializer numbers a list (`incrementListMarker`); bullets and other levels kept
 */
function renumbered(lines: string[], from: number, indent: number, next: number): string[] {
	let number = next
	return lines.map((line, index) => {
		if (index < from) return line
		const item = ITEM.exec(line)
		if (!item || item[1]!.length < indent) {
			if (item) number = Number.NaN
			return line
		}
		if (item[1]!.length !== indent || item[3] === undefined || Number.isNaN(number)) return line
		return line.replace(/\d+/, String(number++))
	})
}

/** in a list only Indent and Outdent act, on the item the caret is in, on line `caretLine` */
function list(format: BlockFormat, source: string, caretLine: number): string | null {
	if (format !== 'indent' && format !== 'outdent') return null
	const lines = source.split('\n')
	const items = itemsOf(lines)
	const index = items.findLastIndex((item) => item.line <= caretLine)
	const target = items[index]
	if (!target) return null
	// the item's own lines: its text, its continuation lines and its own nested items
	const next = items.slice(index + 1).find((item) => item.indent <= target.indent)
	const end = next?.line ?? lines.length
	const before = items.slice(0, index).reverse()
	const parent = before.find((item) => item.indent < target.indent)
	const head = lines.slice(0, target.line)
	const body = lines.slice(target.line, end)
	const tail = lines.slice(end)
	const text = body[0]!.slice(target.marker[0].length - (target.marker[6]?.length ?? 0))

	if (format === 'indent') {
		const sibling = before.find((item) => item.indent <= target.indent)
		if (!sibling || sibling.indent < target.indent) return null
		const shift = sibling.content - target.indent
		const marker = target.marker[3] === undefined ? target.marker[2]! : `1${target.marker[4]}`
		const moved = [
			`${' '.repeat(sibling.content)}${marker} ${text}`,
			...body.slice(1).map((line) => (line.trim() === '' ? line : `${' '.repeat(shift)}${line}`))
		]
		// a loose list keeps its blank line before the item
		const loose = head.some((line) => line.trim() === '') && head.at(-1)!.trim() !== ''
		const result = [...head, ...(loose ? [''] : []), ...moved, ...tail]
		// the items after it on its old level count on from the sibling it went under
		const from = result.length - tail.length
		return sibling.marker[3] === undefined
			? result.join('\n')
			: renumbered(result, from, target.indent, Number(sibling.marker[3]) + 1).join('\n')
	}

	const rest = body.slice(1)
	if (parent) {
		// the item joins its parent's list, numbered after the parent; the items after it on its old level stay
		// where they are, now its own nested list
		const marker =
			parent.marker[3] === undefined
				? parent.marker[2]!
				: `${Number(parent.marker[3]) + 1}${parent.marker[4]}`
		const shift = target.indent - parent.indent
		const unshift = new RegExp(`^ {0,${shift}}`)
		return [
			...head,
			`${' '.repeat(parent.indent)}${marker} ${text}`,
			...rest.map((line) => line.replace(unshift, '')),
			...tail
		].join('\n')
	}
	// out of a top-level list it becomes a paragraph between the items before and after it, without its checkbox; its
	// own nested items stay a list after it, and the items after it count on from its number
	const nestedAt = rest.findIndex((line) => ITEM.test(line))
	const continuation = nestedAt < 0 ? rest : rest.slice(0, nestedAt)
	const unindent = new RegExp(`^ {0,${target.content}}`)
	const nested = nestedAt < 0 ? [] : rest.slice(nestedAt).map((line) => line.replace(unindent, ''))
	const paragraphText = [
		body[0]!.slice(target.marker[0].length),
		...continuation.map((line) => line.trimStart())
	].filter((line, index) => index === 0 || line !== '')
	const gapBefore = head.length > 0 && head.at(-1)!.trim() !== '' ? [''] : []
	const gapAfter = tail.length > 0 && tail[0]!.trim() !== '' ? [''] : []
	const after =
		target.marker[3] === undefined
			? tail
			: renumbered(tail, 0, target.indent, Number(target.marker[3]))
	return [
		...head,
		...gapBefore,
		...paragraphText,
		...(nested.length > 0 ? ['', ...nested] : []),
		...gapAfter,
		...after
	].join('\n')
}
