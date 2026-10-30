import type { Block } from '../engine/blocks.ts'
import { findSlug } from './anchors.ts'
import { linkBase } from './fileUrls.ts'

export type LinkDestination =
	/** a place in this Document: the Block to scroll to */
	| { kind: 'block'; index: number }
	/** somewhere else, as an absolute URL for `linkAction` */
	| { kind: 'url'; href: string }
	/** a relative link in an untitled Document, which editmd's LinkPolicy ignores with a beep (LinkPolicy.swift:17-18) */
	| { kind: 'ignore' }
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
 * to the heading with that GitHub anchor, a link of a scheme editmd's page strips (anything but http, https,
 * mailto, tel, ftp) nowhere, and anything else is resolved against the document's folder (null when untitled,
 * where editmd resolves a relative link against its own page, main.ts:44, and ignores it with a beep)
 */
export function linkDestination(
	link: string,
	blocks: readonly Block[],
	folder: string | null
): LinkDestination {
	const href = sanitizedHref(link)
	if (href === '') return NONE

	if (href.startsWith('#')) {
		// editmd's page takes every heading as a target (main.ts:39), those inside quotes and lists too
		const headings = blocks.flatMap((block, index) =>
			[block.heading?.slug ?? [], block.anchors ?? []].flat().map((slug) => ({ index, slug }))
		)
		const found = findSlug(
			href,
			headings.map(({ slug }) => slug)
		)
		return toBlock(headings[found]?.index ?? -1)
	}

	const base = linkBase(folder)
	if (URL.canParse(href, base)) return { kind: 'url', href: new URL(href, base).href }
	return folder === null && !/^[a-z][a-z0-9+.-]*:/i.test(href) ? { kind: 'ignore' } : NONE
}
