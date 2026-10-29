/**
 * Find's matches as native painted them. TextSearch counts matches through `onhighlight`, whose `matchCount`
 * leaves out native text: over a column of <markdown> it reports 0 while every match paints and takes its
 * `activeIndex` in tree order. so the matches are read back from the painted washes
 * (`getPaintedHighlights`), which also name the element each one is in, and the Block with it
 */

/** one painted wash: the part of `text`, a run of element `elementId`, from `start` to `end` */
export type Wash = { elementId: number; text: string; start: number; end: number }

/** one match, where its first wash starts */
export type Match = { elementId: number; start: number }

export type Direction = 'next' | 'previous'

/**
 * the matches the washes paint for `query`, in paint order, which is native's `activeIndex` order; null while
 * the washes still show an earlier query, since the paint lags the query by a frame. a match split across
 * runs paints a wash per run, each shorter than the query, so pieces add up until they spell it
 */
export function matchesFrom(washes: readonly Wash[], query: string): Match[] | null {
	if (query.length === 0) return []
	const needle = query.toLowerCase()
	const matches: Match[] = []
	let spelled = ''
	let first: Match | null = null
	for (const { elementId, text, start, end } of washes) {
		first ??= { elementId, start }
		spelled += text.slice(start, end).toLowerCase()
		if (!needle.startsWith(spelled)) return null
		if (spelled.length < needle.length) continue
		matches.push(first)
		spelled = ''
		first = null
	}
	return spelled === '' ? matches : null
}

/**
 * the match typing lands on: the first at or after `anchor`, the match active before the query changed, so the
 * match grows with the query instead of jumping ahead (editmd searches again from the current match's start).
 * past the anchor's element its next element's first match follows; nothing after it wraps to the first
 */
export function anchoredIndex(matches: readonly Match[], anchor: Match | null): number {
	if (!anchor) return 0
	let inAnchorElement = false
	for (const [index, { elementId, start }] of matches.entries()) {
		if (elementId === anchor.elementId) {
			inAnchorElement = true
			if (start >= anchor.start) return index
		} else if (inAnchorElement) return index
	}
	return 0
}

/** the next or previous match of `total`, wrapping around like editmd's find (`wraps = true`) */
export function steppedIndex(active: number, total: number, direction: Direction): number {
	if (total === 0) return 0
	return (active + (direction === 'next' ? 1 : total - 1)) % total
}
