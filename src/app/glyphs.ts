/**
 * NSSearchField's magnifying glass (SF Symbols `magnifyingglass`), which the find field and the Help menu's search
 * field show inside their left edge. GPUI paints an svg as a mask in its element's `color`, so the stroke colour here
 * only matters where something reads the source
 */
export function magnifierGlyph(colour: string | undefined): string {
	const paint = colour ?? '#808080'
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><circle cx="5" cy="5" r="3.6" fill="none" stroke="${paint}" stroke-width="1.3"/><path d="M7.7 7.7 10.6 10.6" stroke="${paint}" stroke-width="1.4" stroke-linecap="round"/></svg>`
}
