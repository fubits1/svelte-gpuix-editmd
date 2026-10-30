import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineHastPlugin, defineMdastPlugin, markdownToHtml } from 'satteri'
import { folderUrl } from '../core/fileUrls.ts'
import { splitFrontmatter } from '../core/frontmatter.ts'
import { renderMermaid } from '../core/mermaid.ts'

const escapeHtml = (text: string) =>
	text.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`)

const STYLE =
	'body{font:15px/1.6 -apple-system,Helvetica,sans-serif;max-width:46em;margin:2em auto;color:#111}' +
	// editmd's `--font-mono` (style.css:14): a browser resolves ui-monospace, where GPUI does not
	'pre,code{font-family:ui-monospace,"SF Mono",Menlo,monospace}pre{background:#f4f4f4;padding:12px;border-radius:6px}' +
	'table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:1em;color:#444}' +
	// the footnotes section's "Footnotes" heading is a screen reader's label; editmd's page shows none
	'.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}' +
	// editmd's `.markdown-body a` (style.css:170-173), for a link with no href as much as with one
	'a{color:#0969da;text-decoration:underline;text-decoration-color:#0969da59}' +
	// editmd's `.frontmatter` box (style.css:73-86)
	'.frontmatter{font-size:12.5px;line-height:1.55;color:#656d76;background:#f6f8fa;padding:12px 16px;border-radius:8px}'

/** link schemes the page may keep as links: the ones editmd opens without asking (LinkPolicy.swift:49) */
const SAFE_LINK = /^(https?:|mailto:)/i

/**
 * a markdown file can come from anywhere, and editmd's page runs none of its HTML and loads nothing
 * (RemoteContentBlocker.swift; raw HTML shows as its source, style.css:344-349): raw HTML prints as its text. a
 * diagram prints as its drawing, an inline SVG image, as editmd's page shows it
 */
const inert = defineMdastPlugin({
	name: 'editmd-gpuix-inert-print',
	html: (node) => ({ type: 'text', value: node.value }),
	code: (node) => {
		if (node.lang !== 'mermaid') return undefined
		const diagram = renderMermaid(node.value, {})
		if (diagram.kind !== 'diagram') return undefined
		const url = `data:image/svg+xml;base64,${Buffer.from(diagram.svg).toString('base64')}`
		return { type: 'paragraph', children: [{ type: 'image', url, alt: 'diagram' }] }
	}
})

/** a link the page keeps: a scheme editmd opens without asking, or a page anchor */
const keepsLink = (url: string) => SAFE_LINK.test(url) || url.startsWith('#')

/**
 * an image source the page may keep: a path, an inline image, or a web image the policy blocks; not `//host/…`, which
 * a page opened from a file loads from that host, and not a written `file:` URL, which the window blocks as editmd's
 * page does (core/remote.ts, editmd web/src/remote.ts:15)
 */
const SAFE_IMAGE = /^(https?:|data:image\/|(?!\/\/)[^:]*$)/i

/**
 * at the HTML stage, where reference links and images have their definitions' URLs: an `a` of any other scheme keeps
 * its text with no href, as editmd's page keeps it (Milkdown's sanitizeLinkHref), an `img` of any other scheme is
 * dropped for its alt text, and a footnote's back link goes, as editmd's footnotes carry none
 */
const inertElements = defineHastPlugin({
	name: 'editmd-gpuix-inert-print-elements',
	element: {
		filter: ['a', 'img'],
		visit: (node) => {
			if (node.tagName === 'a') {
				if (node.properties?.dataFootnoteBackref !== undefined) return { type: 'text', value: '' }
				const href = String(node.properties?.href ?? '')
				if (keepsLink(href)) return undefined
				return { type: 'element', tagName: 'a', properties: {}, children: node.children }
			}
			const src = String(node.properties?.src ?? '')
			if (SAFE_IMAGE.test(src)) return undefined
			return { type: 'text', value: String(node.properties?.alt ?? '') }
		}
	}
})

/** nothing but the page's own styles and local or inline images may load, and no script may run */
const POLICY = `default-src 'none'; style-src 'unsafe-inline'; img-src data: file:`

/**
 * File > Print as a standalone HTML page (gap G5: GPUI cannot print), rendered by the one markdown engine; relative
 * images resolve against the document's `folder`, as in editmd's page (none for an untitled document)
 */
export function printablePage(text: string, title: string, folder: string | null = null): string {
	const { frontmatter, body } = splitFrontmatter(text)
	const box = frontmatter === '' ? '' : `<pre class="frontmatter">${escapeHtml(frontmatter)}</pre>`
	const rendered = markdownToHtml(body, { mdastPlugins: [inert], hastPlugins: [inertElements] })
	const html = box + rendered.html
	const base = folder === null ? '' : `<base href="${escapeHtml(folderUrl(folder))}">`
	return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${POLICY}">${base}<title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>${html}</body></html>`
}

/** the most of a title kept in the page's file name, in bytes: a name may hold 255, and `.html` follows */
const NAME_BYTES = 200

/** the folders this process wrote pages into, removed when it ends (`removePrintedPages`) */
const printed: string[] = []

/** `title` as a file name: no slashes, cut to whole characters within NAME_BYTES */
function fileNameOf(title: string): string {
	let name = ''
	for (const character of title.replace(/[/\\]/g, '_')) {
		if (Buffer.byteLength(name + character) > NAME_BYTES) break
		name += character
	}
	return `${name || 'page'}.html`
}

/**
 * writes the printable page to a temporary file and returns its path, for `open` to hand to the browser. the page
 * holds the whole document, so the folder goes when this process ends, by when the browser has loaded it
 */
export function writePrintablePage(
	text: string,
	title: string,
	documentFolder: string | null = null
): string {
	const folder = mkdtempSync(join(tmpdir(), 'editmd-gpuix-print-'))
	if (printed.length === 0) process.once('exit', removePrintedPages)
	printed.push(folder)
	const path = join(folder, fileNameOf(title))
	writeFileSync(path, printablePage(text, title, documentFolder))
	return path
}

/** removes every page this process wrote */
export function removePrintedPages(): void {
	for (const folder of printed.splice(0)) rmSync(folder, { recursive: true, force: true })
}
