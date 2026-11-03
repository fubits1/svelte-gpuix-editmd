import { describe, expect, test } from 'vitest'
import { codeBorderBox } from './codeBorders.ts'

type Box = ReturnType<typeof codeBorderBox>

/** `box` to the hundredth of a px, as the measured lengths are written */
const hundredths = (box: Box): Box => ({
	x: Math.round(box.x * 100) / 100,
	y: Math.round(box.y * 100) / 100,
	width: Math.round(box.width * 100) / 100,
	height: Math.round(box.height * 100) / 100
})

// the wash rects and native pills here were read headless at 2x, each pill from the surface colour's pixels
describe('codeBorderBox', () => {
	const block = { x: 40, y: 72, width: 656, height: 26.5 }

	test('the border sits on native’s pill: the wash rect 2px wider each side and 2px shorter at top and bottom', () => {
		const box = codeBorderBox({ x: 84.7, y: 72, width: 39.56, height: 26.5 }, block)
		expect(hundredths(box)).toEqual({ x: 42.7, y: 2, width: 43.56, height: 22.5 })
	})

	test('the pill keeps its 2px at any zoom: a zoom 2 heading’s wash gives its pill', () => {
		const box = codeBorderBox(
			{ x: 129.45, y: 120, width: 166.16, height: 84 },
			{ x: 80, y: 120, width: 640, height: 84 }
		)
		expect(hundredths(box)).toEqual({ x: 47.45, y: 2, width: 170.16, height: 80 })
	})

	test('the row of a wrapped span that starts at the Block’s left edge keeps its border inside the Block', () => {
		const box = codeBorderBox({ x: 40, y: 125, width: 138.47, height: 26.5 }, { ...block, y: 98.5 })
		expect(hundredths(box)).toEqual({ x: 0, y: 28.5, width: 140.47, height: 22.5 })
	})

	test('a span ending at the Block’s right edge keeps its border inside the Block', () => {
		const box = codeBorderBox({ x: 680, y: 72, width: 16, height: 26.5 }, block)
		expect(hundredths(box)).toEqual({ x: 638, y: 2, width: 18, height: 22.5 })
	})
})
