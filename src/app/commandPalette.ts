/** what the palette's selection looks at in a row: a disabled entry is listed but never selected */
type Row = { enabled: boolean }

/** the first enabled row's index, -1 when none is: the palette's selection after each query */
export function firstEnabled(rows: readonly Row[]): number {
	return rows.findIndex(({ enabled }) => enabled)
}

/**
 * Down (`step` 1) or Up (-1) from row `selected`: the nearest enabled row that way, skipping disabled ones, or
 * `selected` itself when there is none. from no selection (-1), Down picks the first enabled row and Up the last
 */
export function moveSelection(rows: readonly Row[], selected: number, step: 1 | -1): number {
	const start = selected === -1 && step === -1 ? rows.length : selected
	for (let index = start + step; index >= 0 && index < rows.length; index += step) {
		if (rows[index]?.enabled) return index
	}
	return selected
}
