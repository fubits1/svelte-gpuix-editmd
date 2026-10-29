export type Row = { top: number; height: number }

/**
 * the Block a drop at height `y` goes after, -1 for before the first: editmd inserts dropped images
 * at the drop point (ProseMirror's posAtCoords), and without text hit testing the nearest boundary
 * between Blocks stands in for it. `rows` are the Blocks' painted bounds in document order
 */
export function insertAfterIndexAt(y: number, rows: readonly Row[]): number {
	return rows.findLastIndex((row) => row.top + row.height / 2 <= y)
}
