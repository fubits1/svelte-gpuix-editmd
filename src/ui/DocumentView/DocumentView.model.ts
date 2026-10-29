import type { HighlightSpec } from 'gpuix-svelte'
import type { Block } from '../../engine/blocks.ts'

/** what every Block view receives */
export type BlockViewProps = { block: Block; index: number }

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
 * how far a definition and a block of HTML move their mono source up (negative) or down, so its ink sits where
 * editmd's does: measured with native <code> in SF Mono against editmd's screenshots of a definition and of HTML, a
 * definition's text 3.5px low and raw HTML's 1px high without it. px at actual size, scaled by the zoom
 */
export const DEFINITION_INK_SHIFT = -3.5
export const HTML_INK_SHIFT = 1
