import type { Block } from '../engine/blocks.ts'
import { BLOCK_MARGINS, type BlockMargin } from './palette.ts'

/** a heading's margin by its level, `heading-<level>-top` or `-bottom` */
function headingMargin(block: Block, side: 'top' | 'bottom'): BlockMargin | null {
	const level = block.heading?.level
	if (level === undefined) return null
	return `heading-${Math.min(Math.max(level, 1), 6)}-${side}` as BlockMargin
}

/** editmd's top margin of `block`: headings and rules have one, every other Block none */
function topOf(block: Block): BlockMargin | null {
	if (block.kind === 'heading') return headingMargin(block, 'top')
	return block.kind === 'thematicBreak' ? 'rule-margin' : null
}

/** editmd's bottom margin of `block`: a link definition line has none, the body Blocks 1em */
function bottomOf(block: Block): BlockMargin | null {
	if (block.kind === 'heading') return headingMargin(block, 'bottom')
	if (block.kind === 'thematicBreak') return 'rule-margin'
	if (block.kind === 'frontmatter') return 'frontmatter-bottom'
	return block.kind === 'definition' ? null : 'block-bottom'
}

const lengthOf = (margin: BlockMargin | null) => (margin === null ? 0 : BLOCK_MARGINS[margin])

/**
 * the space above `block`, after `previous`, as the size token (palette.ts SIZES) of the margin that wins when
 * the two collapse as CSS margins do: the larger of `previous`'s bottom and `block`'s top. null for none: the
 * first Block has no top margin (`.markdown-body > :first-child`), and neither has the Block after front matter,
 * which sits before editmd's `.markdown-body`, so only its 2rem counts
 */
export function spaceAbove(previous: Block | undefined, block: Block): BlockMargin | null {
	if (previous === undefined) return null
	const bottom = bottomOf(previous)
	if (previous.kind === 'frontmatter') return bottom
	const top = topOf(block)
	return lengthOf(top) > lengthOf(bottom) ? top : bottom
}

/** the larger of two collapsing margins, the first on a tie */
const larger = (first: BlockMargin | null, second: BlockMargin | null) =>
	lengthOf(second) > lengthOf(first) ? second : first

/**
 * the space above and below the Deletion lines between `previous` and `next` (undefined at either end), as
 * editmd's `.agent-deleted.between { height: 0; margin: 0.2rem 0 }` collapses with the Blocks around it: above, the
 * larger of `previous`'s bottom and 0.2rem; below, the larger of 0.2rem and `next`'s top. first in the Document it
 * is `.markdown-body`'s first child, with no top margin, and after front matter only the 2rem counts
 */
export function spaceAroundDeletions(
	previous: Block | undefined,
	next: Block | undefined
): { above: BlockMargin | null; below: BlockMargin | null } {
	let above: BlockMargin | null = null
	if (previous?.kind === 'frontmatter') above = bottomOf(previous)
	else if (previous !== undefined) above = larger(bottomOf(previous), 'deleted-margin')
	const below = next === undefined ? null : larger('deleted-margin', topOf(next))
	return { above, below }
}
