import type { FootnoteReference } from '../engine/blocks.ts'

/** a markdown escape on every ASCII punctuation character, so a label paints as written */
const escapeMarkdown = (text: string) => text.replace(/[!-/:-@[-`{-~]/g, '\\$&')

/** Unicode's superscript form of each character that has one */
const SUPERSCRIPTS = new Map(
	[...'0123456789abcdefghijklmnoprstuvwxyz+-=()'].map((character, index) => [
		character,
		[...'⁰¹²³⁴⁵⁶⁷⁸⁹ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻ⁺⁻⁼⁽⁾'][index]!
	])
)

/**
 * what one footnote reference paints as: native <markdown> paints `[^label]` literally, while editmd paints the
 * label alone in a `sup`, small and raised in the accent colour (preset-gfm footnote/reference.ts:33-45,
 * style.css:370-374), and links it nowhere. a run takes no size or colour of its own (gap G9), so the label is raised
 * with Unicode's superscript characters, and a character with none stays as written
 */
export function footnoteMark(reference: FootnoteReference): string {
	return [...reference.label]
		.map((character) => SUPERSCRIPTS.get(character) ?? escapeMarkdown(character))
		.join('')
}

/** a definition's content as markdown of its own: continuation lines are indented four spaces under `[^label]:` */
export function footnoteContent(content: string): string {
	return content.replace(/\n {1,4}/g, '\n')
}
