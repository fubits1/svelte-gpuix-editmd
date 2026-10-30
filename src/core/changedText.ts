import { markdownToMdast, type MdastNode } from 'satteri'
import { commonEnds, diff } from './diff.ts'

/**
 * a stretch of a Block's painted text, as the `index`th occurrence of `text` in it (counting from 0); `whole` when it
 * is a child of a list or quote that is new or became another node, which editmd marks as a block, not inline
 */
export type ChangedRun = { text: string; index: number; whole?: true }

/** children taken away inside a list or quote: their painted text, and the run of the child now after them, if any */
export type Gap = { text: string; before: ChangedRun | null }

/** what the Block's kind is to editmd: its node type and the attributes that make it another node */
function kindOf(node: MdastNode | undefined): string {
	if (!node) return 'empty'
	const { type } = node
	const depth = 'depth' in node ? node.depth : ''
	const ordered = 'ordered' in node ? node.ordered : ''
	const lang = 'lang' in node ? node.lang : ''
	const checked = 'checked' in node ? node.checked : ''
	return `${type}|${depth}|${ordered}|${lang}|${checked}`
}

/**
 * a stretch of painted text and the marks it carries (`strong|emphasis|link:<url>`…), '' for none; `at` is where the
 * node it paints from starts in the source, for a stretch painted from one
 */
type Piece = { text: string; marks: string; at?: number }

/** the mark an inline node puts on its text, as ProseMirror's marks: strong, emphasis, strike, code, a link */
function markOf(node: MdastNode): string | null {
	switch (node.type) {
		case 'strong':
		case 'emphasis':
		case 'delete':
		case 'inlineCode':
			return node.type
		case 'link':
			return `link:${node.url}`
		case 'linkReference':
			return `reference:${node.identifier}`
		default:
			return null
	}
}

/** the text a Block paints with its marks, its blocks and list items on lines of their own */
function pieces(node: MdastNode, marks = ''): Piece[] {
	const mark = markOf(node)
	const inside = mark === null ? marks : `${marks}|${mark}`
	const children = (separator: string) => {
		const out: Piece[] = []
		const list = 'children' in node ? (node.children as MdastNode[]) : []
		list.forEach((child, index) => {
			if (index > 0 && separator) out.push({ text: separator, marks: '' })
			out.push(...pieces(child, inside))
		})
		return out
	}
	switch (node.type) {
		case 'text':
		case 'inlineCode':
		case 'code':
		case 'html':
			return [{ text: node.value, marks: inside, at: node.position?.start.offset }]
		case 'break':
			return [{ text: '\n', marks: '' }]
		case 'image':
		case 'imageReference':
			return []
		case 'footnoteReference':
			return [
				{
					text: `[${node.label ?? node.identifier}]`,
					marks: inside,
					at: node.position?.start.offset
				}
			]
		case 'list':
		case 'listItem':
		case 'blockquote':
		case 'table':
		case 'tableRow':
			return children('\n')
		default:
			return children('')
	}
}

/** each painted character with its marks, so two versions compare as ProseMirror's content does */
const characters = (list: Piece[]) =>
	list.flatMap(({ text, marks }) => [...text].map((character) => `${character}\u0000${marks}`))

const childrenOf = (node: MdastNode) => ('children' in node ? (node.children as MdastNode[]) : [])

/** the top-level nodes of `source`, with their places in it */
const topLevel = (source: string) => childrenOf(markdownToMdast(source, { position: true }))

const textOf = (list: Piece[]) => list.map((piece) => piece.text).join('')

/** the text the Block `source` paints, '' for none */
function paintedText(source: string): string {
	const [node] = topLevel(source)
	return node ? textOf(pieces(node)) : ''
}

/**
 * `runs` of the Block `before` once the user edits it to `after`, as ProseMirror maps editmd's inline decorations
 * through an edit (highlights.ts:94, 186): a run moves with its text, widens with what is typed inside it, keeps out
 * what is typed at its ends, and is gone with its text
 */
export function mappedRuns(
	runs: readonly ChangedRun[],
	before: string,
	after: string
): ChangedRun[] {
	const old = paintedText(before)
	const now = paintedText(after)
	const { start, aEnd, bEnd } = commonEnds(old, now)
	const mapped: ChangedRun[] = []
	for (const run of runs) {
		let from = -1
		for (let count = 0; count <= run.index; count++) from = old.indexOf(run.text, from + 1)
		if (from === -1) continue
		const to = from + run.text.length
		const newFrom = from < start ? from : from > aEnd ? from + bEnd - aEnd : bEnd
		const newTo = to < start ? to : to > aEnd ? to + bEnd - aEnd : start
		const text = now.slice(newFrom, newTo)
		if (text.trim() !== '') mapped.push({ ...run, text, index: occurrence(now, text, newFrom) })
	}
	return mapped
}

/** where `text` starts in `within`, each occurrence counted from 0, for the one starting at `at` */
function occurrence(within: string, text: string, at: number): number {
	let count = 0
	for (
		let found = within.indexOf(text);
		found !== -1 && found < at;
		found = within.indexOf(text, found + 1)
	) {
		count++
	}
	return count
}

/**
 * where `run` starts in the Block `source`: the source offset of its first painted character, counted from where the
 * text it paints from starts (an escape or entity before it in the same text can shift it by a few characters, never
 * out of its row); null when the painted text holds no such occurrence
 */
export function runOffset(source: string, run: ChangedRun): number | null {
	const [node] = topLevel(source)
	if (!node) return null
	const list = pieces(node)
	const text = textOf(list)
	let from = -1
	for (let count = 0; count <= run.index; count++) from = text.indexOf(run.text, from + 1)
	if (from < 0) return null
	let at = 0
	for (const piece of list) {
		if (from < at + piece.text.length) return piece.at === undefined ? null : piece.at + from - at
		at += piece.text.length
	}
	return null
}

/** the link a piece's marks put it in (`link:<url>` or `reference:<identifier>`), null for none */
const linkMarkOf = (marks: string) =>
	marks.split('|').find((mark) => mark.startsWith('link:') || mark.startsWith('reference:')) ?? null

/**
 * each link of the Block `source` as a run of its painted text, in order: what editmd turns the pointer to a hand over
 * while ⌘ is held (style.css:178-181). stretches next to each other in one link are one run
 */
export function linkRunsOf(source: string): ChangedRun[] {
	const [node] = topLevel(source)
	if (!node) return []
	const list = pieces(node)
	const text = textOf(list)
	const spans: { link: string; from: number; to: number }[] = []
	let at = 0
	for (const piece of list) {
		const link = linkMarkOf(piece.marks)
		const last = spans.at(-1)
		if (link !== null && last?.link === link && last.to === at) last.to += piece.text.length
		else if (link !== null) spans.push({ link, from: at, to: at + piece.text.length })
		at += piece.text.length
	}
	return spans.map(({ from, to }) => {
		const linked = text.slice(from, to)
		return { text: linked, index: occurrence(text, linked, from) }
	})
}

/** a node's text as ProseMirror's `textContent` reads it: every text run joined, a hard break a line, an atom nothing */
const textContentOf = (node: MdastNode): string => {
	if (node.type === 'break') return '\n'
	if ('value' in node && node.type !== 'html') return node.value
	return childrenOf(node).map(textContentOf).join('')
}

/** ProseMirror's name for the node a Block is, where it differs from mdast's, with spaces for underscores */
const NODE_NAMES: Record<string, string> = {
	thematicBreak: 'hr',
	code: 'code block',
	footnoteDefinition: 'footnote definition'
}

/**
 * the text standing in for a removed Block in its tooltip, as editmd's `describe` (changes.ts:95-98): its text, or
 * its node type in brackets when it has none, `(hr)`
 */
export function describedText(source: string): string {
	const [node] = topLevel(source)
	if (!node) return ''
	const name =
		node.type === 'list' ? (node.ordered ? 'ordered list' : 'bullet list') : NODE_NAMES[node.type]
	return textContentOf(node) || `(${name ?? node.type})`
}

/** nodes editmd compares child by child (compareChildren); any other Block is one textblock to it */
const CONTAINERS = new Set(['list', 'listItem', 'blockquote'])

/**
 * what changed from `was` to `now`: ranges of `now`'s painted text, which starts at `at`, each `whole` or not (see
 * ChangedRun), text taken away, and where children were taken away, as the painted offset of the child after them
 */
type Changes = {
	ranges: [number, number, boolean][]
	removed: string[]
	gaps: { text: string; at: number }[]
}

/** `was` against `now`, as editmd's compareNode (changes.ts:48-74) */
function compare(was: MdastNode, now: MdastNode, at: number, changes: Changes): void {
	const painted = pieces(now)
	const text = textOf(painted)
	if (kindOf(was) !== kindOf(now)) {
		changes.ranges.push([at, at + text.length, true])
	} else if (CONTAINERS.has(now.type)) {
		const before = childrenOf(was)
		const after = childrenOf(now)
		// a container paints its children on lines of their own (`pieces`)
		let next = at
		const starts = after.map((child) => {
			const start = next
			next += textOf(pieces(child)).length + 1
			return start
		})
		const key = (child: MdastNode) => `${kindOf(child)}\u0001${characters(pieces(child)).join('')}`
		for (const hunk of diff(before.map(key), after.map(key))) {
			const paired = Math.min(hunk.aEnd - hunk.aStart, hunk.bEnd - hunk.bStart)
			for (let i = 0; i < paired; i++) {
				compare(
					before[hunk.aStart + i]!,
					after[hunk.bStart + i]!,
					starts[hunk.bStart + i]!,
					changes
				)
			}
			for (let j = hunk.bStart + paired; j < hunk.bEnd; j++) {
				changes.ranges.push([starts[j]!, starts[j]! + textOf(pieces(after[j]!)).length, true])
			}
			// the children a hunk takes away are one `deleted` change (changes.ts:41-44), at the child after them or past
			// the container's last line
			const removed = before
				.slice(hunk.aStart + paired, hunk.aEnd)
				.map((child) => textOf(pieces(child)))
				.filter((removedText) => removedText.trim() !== '')
			if (removed.length > 0) {
				changes.removed.push(removed.join('\n'))
				changes.gaps.push({ text: removed.join('\n'), at: starts[hunk.bEnd] ?? next })
			}
		}
	} else {
		// compared character by character with each one's marks, as ProseMirror's findDiffStart/findDiffEnd do, so a
		// word that only gained or lost a mark is a change; offsets count characters, the painted text UTF-16 units
		const old = pieces(was)
		const {
			start: first,
			aEnd: endA,
			bEnd: endB
		} = commonEnds(characters(old), characters(painted))
		const units = (count: number) => [...text].slice(0, count).join('').length
		if (endB > first) changes.ranges.push([at + units(first), at + units(endB), false])
		else if (endA > first) changes.removed.push([...textOf(old)].slice(first, endA).join(''))
	}
}

/**
 * how a Block that changed from `before` to `after` (its source) is marked, as editmd's `changes` marks it
 * (web/src/changes.ts:28-74): null when it became another kind of Block, which is marked whole; else `runs`, the
 * runs of painted text from the first difference to the last in each changed item or paragraph, one per painted
 * line, blank ones left out (none when text was only taken away), `removed`, the painted text taken away when
 * the Block only lost text, as editmd reports a `deleted` change (web/src/changes.ts:41-44, 71-73) for its
 * "Deleted by" marker, `changes`, how many changes editmd reports, which its legend counts (highlights.ts:145-150),
 * and `gaps`, where children of a list or quote were taken away, which editmd marks with a line between the children
 * left (highlights.ts:189-196)
 */
export function blockChange(
	before: string,
	after: string
): {
	runs: ChangedRun[]
	removed: string | null
	changes: number
	firsts: number[]
	gaps: Gap[]
} | null {
	const [was] = topLevel(before)
	const [now] = topLevel(after)
	if (!was || !now || kindOf(was) !== kindOf(now)) return null

	const changes: Changes = { ranges: [], removed: [], gaps: [] }
	compare(was, now, 0, changes)
	const count = changes.ranges.length + changes.removed.length
	const text = textOf(pieces(now))
	// the run of the line starting at painted offset `at`, null past the last
	const lineAt = (at: number): ChangedRun | null => {
		if (at >= text.length) return null
		const line = text.slice(at).split('\n', 1)[0]!
		return { text: line, index: occurrence(text, line, at) }
	}
	const gaps = changes.gaps.map(({ text: gone, at }) => ({ text: gone, before: lineAt(at) }))
	if (changes.ranges.length === 0) {
		const removed = changes.removed.length > 0 ? changes.removed.join('\n') : null
		return { runs: [], removed, changes: count, firsts: [], gaps }
	}
	const runs: ChangedRun[] = []
	// where each change's runs start, which editmd's reveal stops at (highlights.ts:131-142)
	const firsts: number[] = []
	for (const [from, to, whole] of changes.ranges) {
		let at = from
		const first = runs.length
		for (const line of text.slice(from, to).split('\n')) {
			if (line.trim() !== '') {
				const run: ChangedRun = { text: line, index: occurrence(text, line, at) }
				runs.push(whole ? { ...run, whole } : run)
			}
			at += line.length + 1
		}
		if (runs.length > first) firsts.push(first)
	}
	return { runs, removed: null, changes: count, firsts, gaps }
}
