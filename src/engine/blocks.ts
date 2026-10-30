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
type Task = { mark: number; checked: boolean }

export type Block = {
	kind: BlockKind
	start: number
	end: number
	heading?: { level: number; slug: string }
	/** for a quote, list or footnote: the anchors of the headings inside it, which a `#fragment` link scrolls to */
	anchors?: string[]
	/** for a quote: the Blocks inside it, each painted as a top-level one is */
	children?: Block[]
	/**
	 * for a Block inside a quote or a list item: what its container puts in front of each of its lines after the first
	 * (`> `, an item's indent), as a regular expression's source, which its painted text leaves out
	 */
	prefix?: string
	/** the fence's info-string language, null for a bare fence */
	lang?: string | null
	/** task items in document order, nested ones included */
	tasks?: Task[]
	/** for a list: every item flat in document order, so each renders as its own row, a task with its checkbox */
	items?: ListItem[]
	/** for a paragraph of nothing but images: each one, since native <markdown> paints images as link text */
	images?: Image[]
	/** for a paragraph mixing text and images: its text runs and its images in order, so each image paints as one */
	segments?: Segment[]
	/** every `[^label]` in the Block, since native <markdown> paints footnote references literally */
	footnoteReferences?: FootnoteReference[]
	/** every link with no text, which native <markdown> paints as nothing and editmd shows as its source */
	emptyLinks?: EmptyLink[]
	/** every inline HTML tag, which editmd shows as its source in muted mono */
	inlineHtml?: Span[]
	/** the Block paints a link (inline, reference, autolink or bare URL), which ⌘ turns the cursor to a pointer over */
	links?: true
	/** for a footnote definition: its label as written, the identifier it is matched by, and where the content after `[^label]:` starts */
	footnote?: { label: string; identifier: string; contentStart: number }
}

/** `href` is the link around the image, as on a README badge */
export type Image = { src: string; alt: string; href?: string }

/** `start`/`end` are offsets into the Document text; a text run is painted from that Slice */
type Segment =
	| { kind: 'text'; start: number; end: number }
	| ({ kind: 'image'; start: number; end: number } & Image)

/**
 * `start`/`end` bound the whole `[^label]`; `identifier` is the label as GFM normalizes it to match
 * a definition (mdast `identifier`), `label` as written for display
 */
export type FootnoteReference = { start: number; end: number; label: string; identifier: string }

/** `start`/`end` bound the whole `[](url)` */
type Span = { start: number; end: number }
type EmptyLink = Span & { url: string }

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
	/** the item's own Blocks, before any nested list, each painted as a top-level one is */
	children?: Block[]
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
	blocksOf: (nodes: MdastNode[], prefix: string) => Block[],
	prefix = '',
	depth = -1,
	found: ListItem[] = []
): ListItem[] {
	// the item's lines after its first carry its content's indent after what its container puts in front of them
	let indented = prefix
	if (node.type === 'listItem') {
		ITEM_MARKER.lastIndex = node.position?.start.offset ?? 0
		const marker = ITEM_MARKER.exec(source)
		if (marker) {
			const nested = node.children.find((child) => child.type === 'list')
			let contentEnd =
				nested?.position?.start.offset ?? node.position?.end.offset ?? ITEM_MARKER.lastIndex
			while (contentEnd > ITEM_MARKER.lastIndex && /\s/.test(source[contentEnd - 1]!)) contentEnd--
			const lineStart = source.lastIndexOf('\n', marker.index - 1) + 1
			const outer = new RegExp(`^${prefix}`).exec(source.slice(lineStart))?.[0].length ?? 0
			indented = `${prefix} {0,${ITEM_MARKER.lastIndex - lineStart - outer}}`

			const own = node.children.slice(
				0,
				nested ? node.children.indexOf(nested) : node.children.length
			) as MdastNode[]
			const item: ListItem = {
				depth,
				marker: marker[1]!,
				contentStart: offset(ITEM_MARKER.lastIndex),
				contentEnd: offset(contentEnd),
				children: blocksOf(own, indented)
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
		for (const child of node.children) {
			itemsIn(child as MdastNode, source, offset, blocksOf, prefix, depth + 1, found)
		}
	} else if (node.type === 'listItem') {
		let afterNested = false
		for (const child of node.children as MdastNode[]) {
			if (child.type === 'list') {
				afterNested = true
				itemsIn(child, source, offset, blocksOf, indented, depth, found)
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

/** visits `node` and every node inside it, in document order */
export function walk(node: MdastNode, visit: (node: MdastNode) => void): void {
	visit(node)
	if ('children' in node) for (const child of node.children) walk(child as MdastNode, visit)
}

/**
 * `text` parsed with positions, and `offset`, which maps the parser's offsets to the text's: Sätteri drops a leading
 * U+FEFF and counts offsets without it, while TextFile keeps one as content
 */
export function parsedWithOffsets(text: string): {
	root: MdastNode
	offset: (sourceOffset: number) => number
} {
	const shift = text.startsWith(BYTE_ORDER_MARK) ? 1 : 0
	return {
		root: markdownToMdast(text.slice(shift), { position: true }),
		offset: (sourceOffset) => sourceOffset + shift
	}
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

/** `children` without the text nodes that hold only whitespace */
const meaningful = (children: readonly MdastNode[]) =>
	children.filter((child) => !(child.type === 'text' && child.value.trim() === ''))

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
	const parts = meaningful(node.children as MdastNode[])
	const [only] = parts
	const inner = parts.length === 1 && only ? plainImageOf(only, definitions) : null
	return inner ? { ...inner, href } : null
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

/** the kind of the Block `source` holds, a paragraph when it is empty */
export const blockKindOf = (source: string): BlockKind =>
	parseBlocks(source)[0]?.kind ?? 'paragraph'

/** the Document's top-level Blocks, with their UTF-16 offsets into `text` */
export function parseBlocks(text: string): Block[] {
	const { root, offset } = parsedWithOffsets(text)
	const source = text.slice(offset(0))
	const children = 'children' in root ? (root.children as MdastNode[]) : []
	const span = (node: MdastNode) => ({
		start: offset(node.position?.start.offset ?? 0),
		end: offset(node.position?.end.offset ?? 0)
	})
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
	// and every HTML tag with `<`
	const mayHaveHtml = source.includes('<')
	// every link is spelled with `[`, `<`, `://`, `www.` or an email's `@`, so plain prose skips that walk too
	const mayHaveLinks = /[[<@]|:\/\/|www\./.test(source)
	// the first definition of a label wins, as CommonMark's
	const definitions = new Map<string, string>()
	for (const node of children) {
		if (node.type !== 'definition') continue
		const key = node.identifier.toLowerCase()
		if (!definitions.has(key)) definitions.set(key, node.url)
	}

	/**
	 * the Block `node` is; `prefix` is what its container puts in front of each of its lines after the first, '' at the
	 * top. a quote's and a list item's own nodes are Blocks of their own too, painted as top-level ones are
	 */
	const blockOf = (node: MdastNode, prefix: string): Block => {
		const block: Block = { kind: kindOf(node), ...span(node) }
		if (prefix !== '') block.prefix = prefix
		if (node.type === 'blockquote') {
			// lazy lines carry no `>`, so the quote's mark is optional on each line; a tab may follow it, as a space may
			const quoted = `${prefix}(?: {0,3}>[ \\t]?)?`
			block.children = (node.children as MdastNode[]).map((child) => blockOf(child, quoted))
			// the tasks of the lists inside it, so their boxes take the click on the page
			const tasks = block.children.flatMap((child) => child.tasks ?? [])
			if (tasks.length > 0) block.tasks = tasks
		}
		if (node.type === 'heading') block.heading = { level: node.depth, slug: slugs.get(node)! }
		else if (HOLDS_HEADINGS.has(node.type)) {
			const anchors = headingsIn([node]).map((heading) => slugs.get(heading)!)
			if (anchors.length > 0) block.anchors = anchors
		}
		if (node.type === 'code') block.lang = node.lang ?? null
		if (node.type === 'footnoteDefinition') {
			const contentStart = node.children[0]?.position?.start.offset
			block.footnote = {
				...footnoteName(node),
				contentStart: contentStart === undefined ? block.end : offset(contentStart)
			}
		}
		if (node.type === 'paragraph') {
			const parts = meaningful(node.children as MdastNode[])
			const images = parts.map((part) => imageOf(part, definitions))
			if (parts.length > 0 && images.every((image) => image !== null)) {
				block.images = images
			} else if (images.some((image) => image !== null)) {
				block.segments = segmentsOf(node.children, block, offset, definitions)
			}
		}
		if (node.type === 'list') {
			const items = itemsIn(
				node,
				source,
				offset,
				(nodes, inner) => nodes.map((child) => blockOf(child, inner)),
				prefix
			)
			const tasks = items.flatMap((item) => (item.task ? [item.task] : []))
			// every list paints its own rows, a task list with its checkboxes
			if (items.length > 0) block.items = items
			if (tasks.length > 0) block.tasks = tasks
		}
		const footnoteReferences: FootnoteReference[] = []
		const emptyLinks: EmptyLink[] = []
		const inlineHtml: Span[] = []
		if (mayHaveFootnotes || mayHaveEmptyLinks || mayHaveHtml) {
			walk(node, (inner) => {
				if (mayHaveFootnotes && inner.type === 'footnoteReference') {
					footnoteReferences.push({ ...span(inner), ...footnoteName(inner) })
				} else if (mayHaveEmptyLinks && inner.type === 'link' && inner.children.length === 0) {
					emptyLinks.push({ ...span(inner), url: inner.url })
				} else if (inner.type === 'html' && inner !== node) {
					inlineHtml.push(span(inner))
				}
			})
		}
		if (footnoteReferences.length > 0) block.footnoteReferences = footnoteReferences
		if (emptyLinks.length > 0) block.emptyLinks = emptyLinks
		if (inlineHtml.length > 0) block.inlineHtml = inlineHtml
		if (mayHaveLinks && holdsLink(node)) block.links = true
		return block
	}
	return children.map((node) => blockOf(node, ''))
}
