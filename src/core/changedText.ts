import { markdownToMdast, type MdastNode } from 'satteri'

/** a stretch of a Block's painted text, as the `index`th occurrence of `text` in it (counting from 0) */
export type ChangedRun = { text: string; index: number }

/** what the Block's kind is to editmd: its node type and the attributes that make it another node */
function kindOf(node: MdastNode | undefined): string {
	if (!node) return 'empty'
	const { type } = node
	const depth = 'depth' in node ? node.depth : ''
	const ordered = 'ordered' in node ? node.ordered : ''
	const lang = 'lang' in node ? node.lang : ''
	return `${type}|${depth}|${ordered}|${lang}`
}

/** a stretch of painted text and the marks it carries (`strong|emphasis|link:<url>`…), '' for none */
type Piece = { text: string; marks: string }

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
			return [{ text: node.value, marks: inside }]
		case 'break':
			return [{ text: '\n', marks: '' }]
		case 'image':
		case 'imageReference':
			return []
		case 'footnoteReference':
			return [{ text: `[${node.label ?? node.identifier}]`, marks: inside }]
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

/** the top-level nodes of `source` */
function topLevel(source: string): MdastNode[] {
	const root = markdownToMdast(source)
	return 'children' in root ? (root.children as MdastNode[]) : []
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
 * the painted text taken away when a Block that kept its kind only lost text, as editmd's `changes` reports a
 * `deleted` change inside a textblock (web/src/changes.ts:71-73) for its "Deleted by" marker; null when the Block
 * became another kind or text was added or changed too
 */
export function removedText(before: string, after: string): string | null {
	const [was] = topLevel(before)
	const [now] = topLevel(after)
	if (!was || !now || kindOf(was) !== kindOf(now)) return null
	const old = pieces(was)
	const a = characters(old)
	const b = characters(pieces(now))
	let first = 0
	while (first < a.length && first < b.length && a[first] === b[first]) first++
	let endA = a.length
	let endB = b.length
	while (endA > first && endB > first && a[endA - 1] === b[endB - 1]) {
		endA--
		endB--
	}
	if (endB > first || endA <= first) return null
	return [...old.map((piece) => piece.text).join('')].slice(first, endA).join('')
}

/**
 * how a Block that changed from `before` to `after` (its source) is marked, as editmd's `changes` marks it
 * (web/src/changes.ts:48-74): null when it became another kind of Block, which is marked whole; else the runs
 * of painted text from the first difference to the last, one per painted line, blank ones left out (none when
 * text was only taken away)
 */
export function changedText(before: string, after: string): ChangedRun[] | null {
	const [was] = topLevel(before)
	const [now] = topLevel(after)
	if (!was || !now || kindOf(was) !== kindOf(now)) return null

	// compared character by character with each one's marks, as ProseMirror's findDiffStart/findDiffEnd do, so a
	// word that only gained or lost a mark is a change; the runs are then cut from the painted text
	const painted = pieces(now)
	const a = characters(pieces(was))
	const b = characters(painted)
	let first = 0
	while (first < a.length && first < b.length && a[first] === b[first]) first++
	let endA = a.length
	let endB = b.length
	while (endA > first && endB > first && a[endA - 1] === b[endB - 1]) {
		endA--
		endB--
	}
	if (endB <= first) return []

	// offsets so far count characters (code points); the painted text is indexed in UTF-16 units
	const text = painted.map((piece) => piece.text).join('')
	const units = (count: number) => [...text].slice(0, count).join('').length
	const runs: ChangedRun[] = []
	let at = units(first)
	for (const line of text.slice(units(first), units(endB)).split('\n')) {
		if (line.trim() !== '') runs.push({ text: line, index: occurrence(text, line, at) })
		at += line.length + 1
	}
	return runs
}
