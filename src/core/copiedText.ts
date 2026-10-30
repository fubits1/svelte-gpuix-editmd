import type { MdastNode } from 'satteri'
import { parsedWithOffsets } from '../engine/blocks.ts'
import { footnoteMark } from './footnotes.ts'

/**
 * one character the window paints: the source it comes from (`start` to `end`), the leaf node it paints from and
 * that leaf's parents from the top-level Block down; a row break between painted rows has no source and no leaf
 */
type Painted = {
	character: string
	start: number
	end: number
	leaf: MdastNode | null
	parents: readonly MdastNode[]
}

/** the inline nodes that mark their text, whose delimiters a copy cut inside one closes around its part */
const MARKS = new Set(['strong', 'emphasis', 'delete', 'link', 'linkReference'])

/** the top-level Blocks whose text the window can select: a code card, table, front matter or definition has none */
const SELECTABLE = new Set(['paragraph', 'heading', 'list', 'blockquote'])

/** a character reference at the start of the text, which the parser decodes to one character */
const ENTITY = /^&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i

const childrenOf = (node: MdastNode) => ('children' in node ? (node.children as MdastNode[]) : [])

/** an inline code span's backticks, with the space inside them that its value drops */
function codeDelimiters(text: string, start: number, end: number, value: string) {
	const ticks = /^`+/.exec(text.slice(start))?.[0] ?? ''
	const padded = text.slice(start + ticks.length, end - ticks.length) === ` ${value} `
	return { open: padded ? `${ticks} ` : ticks, close: padded ? ` ${ticks}` : ticks }
}

/**
 * every character the window paints for `text`, in reading order with its source, as GPUI reports a selection: rows
 * (paragraphs, headings, list items, quote paragraphs) one line each, a soft break a space, a hard break a line, a
 * footnote reference its raised label, inline HTML as written; null when a text node's value cannot be traced back
 * to its source. `startOf`/`endOf` give a node's offsets in `text`
 */
function paintedOf(text: string): {
	painted: Painted[] | null
	startOf: (node: MdastNode) => number
	endOf: (node: MdastNode) => number
} {
	const { root, offset } = parsedWithOffsets(text)
	const startOf = (node: MdastNode) => offset(node.position!.start.offset!)
	const endOf = (node: MdastNode) => offset(node.position!.end.offset!)
	const painted: Painted[] = []
	let newRow = false
	const paint = (
		character: string,
		start: number,
		end: number,
		leaf: MdastNode,
		parents: readonly MdastNode[]
	) => {
		if (newRow && painted.length > 0) {
			painted.push({ character: '\n', start: -1, end: -1, leaf: null, parents: [] })
		}
		newRow = false
		painted.push({ character, start, end, leaf, parents })
	}

	/** a text node's characters, each traced to its source past escapes, entities and the next line's prefix */
	const paintText = (node: MdastNode & { value: string }, parents: readonly MdastNode[]) => {
		const { value } = node
		const end = endOf(node)
		let at = startOf(node)
		for (let index = 0; index < value.length; index++) {
			const unit = value[index]!
			const entity = ENTITY.exec(text.slice(at, end))?.[0]
			if (entity) {
				paint(unit, at, (at += entity.length), node, parents)
			} else if (unit === '\n') {
				const lineEnd = text.indexOf('\n', at)
				if (lineEnd < 0 || lineEnd >= end) return false
				paint(' ', lineEnd, lineEnd + 1, node, parents)
				at = lineEnd + 1
				// the next line's indent and quote marks, which the value leaves out
				while (at < end && text[at] !== value[index + 1] && /[ \t>]/.test(text[at]!)) at++
			} else if (text[at] === unit) {
				paint(unit, at, ++at, node, parents)
			} else if (text[at] === '\\' && text[at + 1] === unit) {
				paint(unit, at, (at += 2), node, parents)
			} else {
				return false
			}
		}
		return true
	}

	const visit = (node: MdastNode, parents: readonly MdastNode[]): boolean => {
		const inside = [...parents, node]
		const visitChildren = () => childrenOf(node).every((child) => visit(child, inside))
		switch (node.type) {
			case 'paragraph':
			case 'heading':
				newRow = true
				return visitChildren()
			case 'list':
			case 'listItem':
			case 'blockquote':
				return visitChildren()
			case 'text':
				return paintText(node, parents)
			case 'inlineCode': {
				const start = startOf(node)
				const { open } = codeDelimiters(text, start, endOf(node), node.value)
				const from = start + open.length
				if (text.slice(from, from + node.value.length) !== node.value) return false
				for (let index = 0; index < node.value.length; index++) {
					paint(node.value[index]!, from + index, from + index + 1, node, parents)
				}
				return true
			}
			case 'html': {
				// inline HTML paints as written; an HTML Block inside a list item or quote paints no selectable text
				const parent = parents.at(-1)?.type ?? ''
				if (parent === 'listItem' || parent === 'blockquote') return true
				const start = startOf(node)
				for (let index = 0; index < node.value.length; index++) {
					paint(node.value[index]!, start + index, start + index + 1, node, parents)
				}
				return true
			}
			case 'break':
				paint('\n', startOf(node), endOf(node), node, parents)
				return true
			case 'footnoteReference': {
				const [start, end] = [startOf(node), endOf(node)]
				const label = node.label ?? node.identifier
				const mark = footnoteMark({ start, end, label, identifier: node.identifier })
				for (const character of mark.replace(/\\(.)/g, '$1'))
					paint(character, start, end, node, parents)
				return true
			}
			default:
				return MARKS.has(node.type) ? visitChildren() : true
		}
	}

	const blocks = childrenOf(root).filter((node) => SELECTABLE.has(node.type))
	return { painted: blocks.every((block) => visit(block, [])) ? painted : null, startOf, endOf }
}

/**
 * what Copy writes for `selected`, the text the window holds selected in the painted Document `text`, as editmd's
 * clipboardTextSerializer (plugin-clipboard/src/index.ts:135-149) over the selection with its parents
 * (`Selection.content()`): text inside one text node as it reads; anything more as the markdown it was written as,
 * with the markers of the Blocks, list items and quotes it starts inside, a mark cut by either end closed around its
 * part, and a final newline. `selected` as it reads when it is found nowhere in the painted text, or in more than one
 * place
 */
export function copiedText(text: string, selected: string): string {
	const { painted, startOf, endOf } = paintedOf(text)
	const reading = painted?.map(({ character }) => character).join('') ?? ''
	const at = reading.indexOf(selected)
	if (!painted || at < 0 || reading.includes(selected, at + 1)) return selected
	const traced = painted.slice(at, at + selected.length).filter(({ leaf }) => leaf !== null)
	const first = traced[0]
	const last = traced.at(-1)
	if (!first?.leaf || !last?.leaf) return selected
	const source = text.slice(first.start, last.end)
	const leafType = first.leaf.type
	const oneText = first.leaf === last.leaf && (leafType === 'text' || leafType === 'inlineCode')
	if (oneText && !source.includes('\n')) return selected

	// what each parent writes before its first child: a heading's hashes, a quote's `>`, an item's marker and task
	// box, a mark's opening delimiter; nothing for a list or a paragraph
	const opening = first.parents.map((parent) =>
		text.slice(startOf(parent), startOf(childrenOf(parent)[0]!))
	)
	const closing = last.parents
		.filter((parent) => MARKS.has(parent.type) && endOf(parent) > last.end)
		.map((parent) => text.slice(endOf(childrenOf(parent).at(-1)!), endOf(parent)))
		.reverse()
	const code = (painted: Painted) =>
		painted.leaf?.type === 'inlineCode'
			? codeDelimiters(text, startOf(painted.leaf), endOf(painted.leaf), painted.leaf.value)
			: null
	return `${opening.join('')}${code(first)?.open ?? ''}${source}${code(last)?.close ?? ''}${closing.join('')}\n`
}
