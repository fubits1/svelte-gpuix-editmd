import type { Block } from '../engine/blocks.ts'
import { findSlug } from './anchors.ts'
import { linkBase } from './fileUrls.ts'
import { footnoteIdentifierOf } from './footnotes.ts'

export type LinkDestination =
	/** a place in this Document: the Block to scroll to */
	| { kind: 'block'; index: number }
	/** somewhere else, as an absolute URL for `linkAction` */
	| { kind: 'url'; href: string }
	| { kind: 'none' }

const NONE: LinkDestination = { kind: 'none' }

const toBlock = (index: number): LinkDestination => (index < 0 ? NONE : { kind: 'block', index })

/** the schemes editmd's page keeps a link's href for (Milkdown preset-commonmark `sanitize-href.ts` SAFE_PROTOCOLS) */
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'ftp'])

/** what a browser drops while it reads a URL's scheme: C0/C1 controls, space, zero-width marks, U+2028/9, the BOM */
const isIgnoredInScheme = (code: number) =>
	code <= 0x20 ||
	(code >= 0x7f && code <= 0xa0) ||
	(code >= 0x200b && code <= 0x200d) ||
	code === 0x2028 ||
	code === 0x2029 ||
	code === 0xfeff

/**
 * `href` as editmd's page keeps it, trimmed, or '' when its scheme is not one it allows (Milkdown's
 * `sanitizeLinkHref`): a link with no scheme (relative, `#fragment`, `?query`) is kept
 */
function sanitizedHref(href: string): string {
	const trimmed = href.trim()
	const normalized = [...trimmed]
		.filter((character) => !isIgnoredInScheme(character.codePointAt(0)!))
		.join('')
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalized)?.[1]
	return !scheme || SAFE_SCHEMES.has(scheme.toLowerCase()) ? trimmed : ''
}

/**
 * where a Cmd-clicked link goes, as editmd's `openLink` (web/src/main.ts) decides: `#fragment` scrolls
 * to the heading with that GitHub anchor, a footnote link to its definition, a link of a scheme editmd's
 * page strips (anything but http, https, mailto, tel, ftp) nowhere, and anything else is resolved against
 * the document's folder (null when untitled, where a relative link goes nowhere)
 */
export function linkDestination(
	link: string,
	blocks: readonly Block[],
	folder: string | null
): LinkDestination {
	// footnote links are the port's own, made by withFootnoteLinks, never written in the document
	const identifier = footnoteIdentifierOf(link)
	if (identifier !== null) {
		return toBlock(blocks.findIndex((block) => block.footnote?.identifier === identifier))
	}

	const href = sanitizedHref(link)
	if (href === '') return NONE

	if (href.startsWith('#')) {
		const headings = blocks.flatMap((block, index) =>
			block.heading ? [{ index, slug: block.heading.slug }] : []
		)
		const found = findSlug(
			href,
			headings.map(({ slug }) => slug)
		)
		return toBlock(headings[found]?.index ?? -1)
	}

	const base = linkBase(folder)
	return URL.canParse(href, base) ? { kind: 'url', href: new URL(href, base).href } : NONE
}
