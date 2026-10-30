// Sequence diffing, used to turn "the document is now X" into small edits.

/** `a[aStart, aEnd)` was replaced by `b[bStart, bEnd)`. */
export type Hunk = {
	aStart: number
	aEnd: number
	bStart: number
	bEnd: number
}

/** Above this many cells the middle of a diff is one replacement, not an LCS. */
const MAX_TABLE = 4_000_000

/**
 * The hunks that turn `a` into `b`, in order and non-overlapping. Unchanged
 * runs are the longest common subsequence under `same`.
 */
export function diff<T>(
	a: readonly T[],
	b: readonly T[],
	same: (x: T, y: T) => boolean = Object.is
): Hunk[] {
	let start = 0
	while (start < a.length && start < b.length && same(a[start]!, b[start]!)) start++
	let aEnd = a.length
	let bEnd = b.length
	while (aEnd > start && bEnd > start && same(a[aEnd - 1]!, b[bEnd - 1]!)) {
		aEnd--
		bEnd--
	}
	const n = aEnd - start
	const m = bEnd - start
	if (n === 0 && m === 0) return []
	if (n === 0 || m === 0 || n * m > MAX_TABLE) return [{ aStart: start, aEnd, bStart: start, bEnd }]

	// lcs[i][j]: LCS length of a[start+i..aEnd) and b[start+j..bEnd).
	const width = m + 1
	const lcs = new Uint32Array((n + 1) * width)
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lcs[i * width + j] = same(a[start + i]!, b[start + j]!)
				? lcs[(i + 1) * width + j + 1]! + 1
				: Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!)
		}
	}

	const hunks: Hunk[] = []
	let open: Hunk | null = null
	let i = 0
	let j = 0
	while (i < n || j < m) {
		if (i < n && j < m && same(a[start + i]!, b[start + j]!)) {
			if (open) hunks.push(open)
			open = null
			i++
			j++
			continue
		}
		open ??= {
			aStart: start + i,
			aEnd: start + i,
			bStart: start + j,
			bEnd: start + j
		}
		if (j < m && (i === n || lcs[i * width + j + 1]! >= lcs[(i + 1) * width + j]!)) {
			j++
			open.bEnd++
		} else {
			i++
			open.aEnd++
		}
	}
	if (open) hunks.push(open)
	return hunks
}

/** The common start and end of `a` and `b`: they differ only in `a[start, aEnd)` and `b[start, bEnd)`. */
export function commonEnds<T>(
	a: ArrayLike<T>,
	b: ArrayLike<T>
): { start: number; aEnd: number; bEnd: number } {
	let start = 0
	while (start < a.length && start < b.length && a[start] === b[start]) start++
	let aEnd = a.length
	let bEnd = b.length
	while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
		aEnd--
		bEnd--
	}
	return { start, aEnd, bEnd }
}

/** Split text into lines, each keeping its line break, so joining restores it. */
export function lines(text: string): string[] {
	return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}
