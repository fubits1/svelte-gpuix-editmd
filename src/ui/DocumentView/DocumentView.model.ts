import type { HighlightSpec } from 'gpuix-svelte'
import type { Block } from '../../engine/blocks.ts'

/** what every Block view receives */
export type BlockViewProps = {
	block: Block
	/** the top-level Block's index, which a click opens: a Block inside a quote or a list item opens its container */
	index: number
	/**
	 * what the view's test ids end in: the index for a top-level Block, `<container's key>.<n>` for the nth Block inside
	 * a quote or a list item, so a nested one's never collide with a top-level one's
	 */
	testKey: string
}

/**
 * a code card's language label, `pre[data-language]::before { top: 0.35rem }` (5.6px), less the 2px GPUI sets 11px
 * text lower in its line than WebKit: editmd's ink starts 8px below the card's top, the port's started 10px below it
 * at 5.6px (both apps' screenshots, device rows at 2x). px at actual size, scaled by the zoom
 */
export const CODE_LABEL_TOP = 0.35 * 16 - 2

/**
 * the `highlight` of text editmd paints as CSS generated content (a code block's `::before` language label), which its
 * find never matches: a spec of its own that matches nothing replaces Find's container spec in it, so the text paints
 * no wash and the matches are numbered without it (measured headless)
 */
export const NO_FIND: HighlightSpec = { ranges: [] }

/**
 * an open mermaid Block's source card above its live diagram, `.code-block.mermaid.editing > pre { margin-bottom:
 * 0.5em }` of the pre's 13.5px (style.css:417-419). px at actual size, scaled by the zoom
 */
export const PREVIEW_GAP = 0.5 * 13.5

/**
 * CSS `line-height: normal` of SF Mono per px of its text, the line box WebKit gives it: the font's hhea ascender 1980
 * and descender 432 of its 2048 units, no line gap (/System/Library/Fonts/SFNSMono.ttf). editmd's definition line is
 * that tall, 16.21px of its 13.76px text, since its `font:` shorthand resets the line height (style.css:353-357)
 */
export const SF_MONO_LINE_BOX = (1980 + 432) / 2048

/**
 * how far a block of HTML moves its mono source down, so its ink sits where editmd's does: measured with native
 * <markdown> inline code in SF Mono against editmd's screenshot of HTML, its text 1px high without it; a definition in
 * its own line box needs none. px at actual size, scaled by the zoom
 */
export const HTML_INK_SHIFT = 1
