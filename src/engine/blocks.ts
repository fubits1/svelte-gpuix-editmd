import { markdownToMdast, type MdastNode } from 'satteri'
import { headingSlugs } from '../core/anchors.ts'

export type BlockKind =
	| 'frontmatter'
	| 'heading'
	| 'paragraph'
	| 'list'
	| 'blockquote'
	| 'code'
	| 'mermaid'
	| 'table'
	| 'thematicBreak'
	| 'html'
	| 'definition'
	| 'footnoteDefinition'
	| 'other'

/** `mark` is the offset of the character between the task's brackets */
export type Task = { mark: number; checked: boolean }

export type Block = {
	kind: BlockKind
	start: number
	end: number
	heading?: { level: number; slug: string }
	/** the fence's info-string language, null for a bare fence */
	lang?: string | null
	/** task items in document order, nested ones included */
	tasks?: Task[]
	/** for a list holding tasks: every item flat in document order, so each can render with its own checkbox */
	items?: ListItem[]
	/** for a paragraph of nothing but images: each one, since native <markdown> paints images as link text */
	images?: Image[]
	/** for a paragraph mixing text and images: its text runs and its images in order, so each image paints as one */
	segments?: Segment[]
	/** every `[^label]` in the Block, since native <markdown> paints footnote references literally */
	footnoteReferences?: FootnoteReference[]
	/** every link with no text, which native <markdown> paints as nothing and editmd shows as its source */
	emptyLinks?: EmptyLink[]
	/** the Block paints a link (inline, reference, autolink or bare URL), which ⌘ turns the cursor to a pointer over */
	links?: true
	/** for a footnote definition: its label as written, the identifier it is matched by, and where the content after `[^label]:` starts */
	footnote?: { label: string; identifier: string; contentStart: number }
}

/** `href` is the link around the image, as on a README badge */
export type Image = { src: string; alt: string; href?: string }

/** `start`/`end` are offsets into the Document text; a text run is painted from that Slice */
export type Segment =
	| { kind: 'text'; start: number; end: number }
	| ({ kind: 'image'; start: number; end: number } & Image)

/**
 * `start`/`end` bound the whole `[^label]`; `identifier` is the label as GFM normalizes it to match
 * a definition (mdast `identifier`), `label` as written for display
 */
export type FootnoteReference = { start: number; end: number; label: string; identifier: string }

/** `start`/`end` bound the whole `[](url)` */
export type EmptyLink = { start: number; end: number; url: string }

/** what mdast gives a footnote reference or definition */
const footnoteName = (node: { label?: string | null; identifier: string }) => ({
	label: node.label ?? node.identifier,
	identifier: node.identifier
})

/**
 * `contentStart`/`contentEnd` bound the item's own text: after marker and checkbox, before any nested list. a
 * `continuation` row is what follows a nested list inside the same item (a paragraph, code, a quote): it has no
 * marker and sits at its item's depth, after the nested items
 */
export type ListItem = {
	depth: number
	marker: string
	contentStart: number
	contentEnd: number
	task?: Task
	continuation?: true
}

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff)

const ITEM_MARKER = /[ \t]*([-+*]|\d+[.)])[ \t]+(\[[ xX]\][ \t]?)?/y

const PASSTHROUGH_KINDS = new Set<string>([
	'heading',
	'paragraph',
	'list',
	'blockquote',
	'code',
	'table',
	'thematicBreak',
	'html',
	'definition',
	'footnoteDefinition'
])

function kindOf(node: MdastNode): BlockKind {
	if (node.type === 'yaml' || node.type === 'toml') return 'frontmatter'
	if (node.type === 'code' && node.lang === 'mermaid') return 'mermaid'
	return PASSTHROUGH_KINDS.has(node.type) ? (node.type as BlockKind) : 'other'
}

/**
 * a heading's text as editmd's anchors read it, ProseMirror's textContent: inline HTML is an atom there and adds
 * nothing (its editor gives `linebreak-html` for `# Line<br>break <b>html</b>`)
 */
function headingText(node: MdastNode): string {
	if (node.type === 'html') return ''
	if ('value' in node && typeof node.value === 'string') return node.value
	return 'children' in node
		? node.children.map((child) => headingText(child as MdastNode)).join('')
		: ''
}

/** items only sit on lists, so the walk never descends into paragraphs or inline content */
function itemsIn(
	node: MdastNode,
	source: string,
	offset: (sourceOffset: number) => number,
	depth = -1,
	found: ListItem[] = []
): ListItem[] {
	if (node.type === 'listItem') {
		ITEM_MARKER.lastIndex = node.position?.start.offset ?? 0
		const marker = ITEM_MARKER.exec(source)
		if (marker) {
			const nested = node.children.find((child) => child.type === 'list')
			let contentEnd =
				nested?.position?.start.offset ?? node.position?.end.offset ?? ITEM_MARKER.lastIndex
			while (contentEnd > ITEM_MARKER.lastIndex && /\s/.test(source[contentEnd - 1]!)) contentEnd--

			const item: ListItem = {
				depth,
				marker: marker[1]!,
				contentStart: offset(ITEM_MARKER.lastIndex),
				contentEnd: offset(contentEnd)
			}
			if (marker[2] && typeof node.checked === 'boolean') {
				item.task = {
					mark: offset(marker.index + marker[0].indexOf('[') + 1),
					checked: node.checked
				}
			}
			found.push(item)
		}
	}
	if (node.type === 'list') {
		for (const child of node.children) itemsIn(child as MdastNode, source, offset, depth + 1, found)
	}
	if (node.type === 'listItem') {
		let afterNested = false
		for (const child of node.children as MdastNode[]) {
			if (child.type === 'list') {
				afterNested = true
				itemsIn(child, source, offset, depth, found)
			} else if (afterNested) {
				// the item's own text before its first nested list is the item's row; what comes after a nested
				// list is painted as a row of its own at the item's depth
				found.push({
					depth,
					marker: '',
					contentStart: offset(child.position?.start.offset ?? 0),
					contentEnd: offset(child.position?.end.offset ?? 0),
					continuation: true
				})
			}
		}
	}
	return found
}

function footnoteReferencesIn(
	node: MdastNode,
	offset: (sourceOffset: number) => number,
	found: FootnoteReference[] = []
): FootnoteReference[] {
	if (node.type === 'footnoteReference') {
		found.push({
			start: offset(node.position?.start.offset ?? 0),
			end: offset(node.position?.end.offset ?? 0),
			...footnoteName(node)
		})
	}
	if ('children' in node) {
		for (const child of node.children) footnoteReferencesIn(child as MdastNode, offset, found)
	}
	return found
}

/** the Document's link reference definitions, by their identifier: what reference-style images and links name */
type Definitions = ReadonlyMap<string, string>

/** an image, inline or by reference, with its source; null for a reference no definition names */
function plainImageOf(node: MdastNode, definitions: Definitions): Image | null {
	if (node.type === 'image') return { src: node.url, alt: node.alt ?? '' }
	if (node.type !== 'imageReference') return null
	const src = definitions.get(node.identifier.toLowerCase())
	return src === undefined ? null : { src, alt: node.alt ?? '' }
}

/**
 * an image, or a link whose only content is an image (editmd keeps the link, `links.ts:194-232`); either may be
 * written by reference, as editmd paints the image its definition names
 */
function imageOf(node: MdastNode, definitions: Definitions): Image | null {
	const image = plainImageOf(node, definitions)
	if (image) return image
	if (node.type !== 'link' && node.type !== 'linkReference') return null
	const href = node.type === 'link' ? node.url : definitions.get(node.identifier.toLowerCase())
	if (href === undefined) return null
	const parts = node.children.filter(
		(child) => !(child.type === 'text' && child.value.trim() === '')
	)
	const [only] = parts
	const inner = parts.length === 1 && only ? plainImageOf(only as MdastNode, definitions) : null
	return inner ? { ...inner, href } : null
}

function emptyLinksIn(
	node: MdastNode,
	offset: (sourceOffset: number) => number,
	found: EmptyLink[] = []
): EmptyLink[] {
	if (node.type === 'link' && node.children.length === 0) {
		found.push({
			start: offset(node.position?.start.offset ?? 0),
			end: offset(node.position?.end.offset ?? 0),
			url: node.url
		})
	}
	if ('children' in node) {
		for (const child of node.children) emptyLinksIn(child as MdastNode, offset, found)
	}
	return found
}

/** whether `node` holds a link or a reference to one; a definition line only defines one */
function holdsLink(node: MdastNode): boolean {
	if (node.type === 'link' || node.type === 'linkReference') return true
	return 'children' in node && node.children.some((child) => holdsLink(child as MdastNode))
}

/**
 * a paragraph's top-level images (linked ones included) and the text runs between them; an image
 * inside emphasis stays in its text run, which native <markdown> paints as link text
 */
function segmentsOf(
	children: readonly MdastNode[],
	block: Block,
	offset: (sourceOffset: number) => number,
	definitions: Definitions
): Segment[] {
	const segments: Segment[] = []
	let at = block.start
	for (const child of children) {
		const image = imageOf(child, definitions)
		if (!image) continue
		const start = offset(child.position?.start.offset ?? 0)
		const end = offset(child.position?.end.offset ?? 0)
		if (start > at) segments.push({ kind: 'text', start: at, end: start })
		segments.push({ kind: 'image', start, end, ...image })
		at = end
	}
	if (block.end > at) segments.push({ kind: 'text', start: at, end: block.end })
	return segments
}

/** the nodes a heading can sit inside; paragraphs, tables and the rest hold none, so a keystroke skips them */
const HOLDS_HEADINGS = new Set(['blockquote', 'list', 'listItem', 'footnoteDefinition'])

/** every heading among `nodes` and inside quotes, lists and footnotes, in document order */
function headingsIn(nodes: readonly MdastNode[]): MdastNode[] {
	return nodes.flatMap((node) => {
		if (node.type === 'heading') return [node]
		return HOLDS_HEADINGS.has(node.type) && 'children' in node
			? headingsIn(node.children as MdastNode[])
			: []
	})
}

/** the Document's top-level Blocks, with their UTF-16 offsets into `text` */
export function parseBlocks(text: string): Block[] {
	// Sätteri drops a leading U+FEFF and counts offsets without it; TextFile keeps one as content
	const shift = text.startsWith(BYTE_ORDER_MARK) ? 1 : 0
	const offset = (sourceOffset: number) => sourceOffset + shift
	const source = text.slice(shift)
	const root = markdownToMdast(source, { position: true })
	const children = 'children' in root ? (root.children as MdastNode[]) : []
	// a repeated anchor counts every heading in document order, those in quotes and lists too, as editmd's
	// `headingSlugs` over `doc.descendants` does (anchors.ts:66-69); only top-level ones are Blocks to scroll to
	const headings = headingsIn(children)
	const slugs = new Map(
		headingSlugs(headings.map(headingText)).map((slug, index) => [headings[index]!, slug])
	)
	// every reference is spelled `[^`, so most documents skip the walk over every node
	const mayHaveFootnotes = source.includes('[^')
	// likewise every link with no text is spelled `[](` (a reference one is `[][label]`, which resolves to text)
	const mayHaveEmptyLinks = source.includes('[](')
	// every link is spelled with `[`, `<`, `://`, `www.` or an email's `@`, so plain prose skips that walk too
	const mayHaveLinks = /[[<@]|:\/\/|www\./.test(source)
	// the first definition of a label wins, as CommonMark's
	const definitions = new Map<string, string>()
	for (const node of children) {
		if (node.type !== 'definition') continue
		const key = node.identifier.toLowerCase()
		if (!definitions.has(key)) definitions.set(key, node.url)
	}

	return children.map((node) => {
		const block: Block = {
			kind: kindOf(node),
			start: offset(node.position?.start.offset ?? 0),
			end: offset(node.position?.end.offset ?? 0)
		}
		if (node.type === 'heading') block.heading = { level: node.depth, slug: slugs.get(node)! }
		if (node.type === 'code') block.lang = node.lang ?? null
		if (node.type === 'footnoteDefinition') {
			const contentStart = node.children[0]?.position?.start.offset
			block.footnote = {
				...footnoteName(node),
				contentStart: contentStart === undefined ? block.end : offset(contentStart)
			}
		}
		if (node.type === 'paragraph') {
			const parts = node.children.filter(
				(child) => !(child.type === 'text' && child.value.trim() === '')
			)
			const images = parts.map((part) => imageOf(part, definitions))
			if (parts.length > 0 && images.every((image) => image !== null)) {
				block.images = images
			} else if (images.some((image) => image !== null)) {
				block.segments = segmentsOf(node.children, block, offset, definitions)
			}
		}
		if (node.type === 'list') {
			const items = itemsIn(node, source, offset)
			const tasks = items.flatMap((item) => (item.task ? [item.task] : []))
			// every list paints its own rows, a task list with its checkboxes
			if (items.length > 0) block.items = items
			if (tasks.length > 0) block.tasks = tasks
		}
		const footnoteReferences = mayHaveFootnotes ? footnoteReferencesIn(node, offset) : []
		if (footnoteReferences.length > 0) block.footnoteReferences = footnoteReferences
		const emptyLinks = mayHaveEmptyLinks ? emptyLinksIn(node, offset) : []
		if (emptyLinks.length > 0) block.emptyLinks = emptyLinks
		if (mayHaveLinks && holdsLink(node)) block.links = true
		return block
	})
}
