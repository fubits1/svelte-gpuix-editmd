import type { FootnoteReference } from '../engine/blocks.ts'

/** links a footnote reference paints as; `footnoteIdentifierOf` reads them back when one is clicked */
const FOOTNOTE_SCHEME = 'footnote:'

/** a markdown escape on every ASCII punctuation character, so a label paints as written */
const escapeMarkdown = (text: string) => text.replace(/[!-/:-@[-`{-~]/g, '\\$&')

/**
 * the link run one footnote reference paints as: native <markdown> paints `[^label]` literally, while
 * editmd shows the label small in the accent colour. a link run sets the label apart and makes it clickable, but
 * paints in the text colour, not the accent (gap G9, ADR-0005)
 */
export function footnoteLink(reference: FootnoteReference): string {
	const label = `\\[${escapeMarkdown(reference.label)}\\]`
	return `[${label}](${FOOTNOTE_SCHEME}${encodeURIComponent(reference.identifier)})`
}

/**
 * the identifier of the footnote a clicked link points at, or null for any other link; a broken percent-escape is
 * taken as written, as editmd's `findHeading` takes a fragment (anchors.ts:49-55)
 */
export function footnoteIdentifierOf(href: string): string | null {
	if (!href.startsWith(FOOTNOTE_SCHEME)) return null
	const written = href.slice(FOOTNOTE_SCHEME.length)
	try {
		return decodeURIComponent(written)
	} catch {
		return written
	}
}

/** a definition's content as markdown of its own: continuation lines are indented four spaces under `[^label]:` */
export function footnoteContent(content: string): string {
	return content.replace(/\n {1,4}/g, '\n')
}
