// editmd's inline code border (style.css:185-191), drawn over the pill native <markdown> paints a code span in

type Box = { x: number; y: number; width: number; height: number }

/** editmd's `border-radius: 5px`, in px at actual size, scaled by the zoom */
export const CODE_BORDER_RADIUS = 5

/**
 * native paints a code span's pill 2px wider than its wash on each side and 2px inside it at top and bottom, at every
 * zoom (measured headless at 0.75, 1, 1.5 and 2, from the surface colour's pixels)
 */
const PILL_OUTSET_X = 2
const PILL_INSET_Y = 2

/**
 * the border box of one row of a code span, in px from `block`'s top left: native's pill around `rect`, the span's wash
 * in that row, kept inside `block`'s width, as native clips the pill of a row that starts or ends at the Block's edge
 */
export function codeBorderBox(rect: Box, block: Box): Box {
	const left = Math.max(rect.x - PILL_OUTSET_X, block.x)
	const right = Math.min(rect.x + rect.width + PILL_OUTSET_X, block.x + block.width)
	return {
		x: left - block.x,
		y: rect.y + PILL_INSET_Y - block.y,
		width: right - left,
		height: rect.height - 2 * PILL_INSET_Y
	}
}
