/** a stretch of a Block's source */
type CellRange = { from: number; to: number }

/** a table's delimiter row, `| - | :-: |` */
const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/**
 * where each cell's text lies in a table row `line` starting at `lineStart`: between unescaped pipes, trimmed; an
 * empty cell is an empty range one space in, where a caret in it sits
 */
function cellsOf(line: string, lineStart: number): CellRange[] {
	const pipes = [...line.matchAll(/(?<!\\)\|/g)].map((pipe) => pipe.index)
	// a row may leave out its outer pipes
	const edges = [
		...(line.trimStart().startsWith('|') ? [] : [-1]),
		...pipes,
		...(line.trimEnd().endsWith('|') ? [] : [line.length])
	]
	const cells: CellRange[] = []
	for (let i = 0; i + 1 < edges.length; i++) {
		const cell = line.slice(edges[i]! + 1, edges[i + 1])
		const text = cell.trim()
		const lead = text === '' ? Math.min(1, cell.length) : cell.length - cell.trimStart().length
		const from = lineStart + edges[i]! + 1 + lead
		cells.push({ from, to: from + text.length })
	}
	return cells
}

/** every cell of the table `source`, row by row, its delimiter row left out */
export function tableCells(source: string): CellRange[] {
	const cells: CellRange[] = []
	let lineStart = 0
	for (const line of source.split('\n')) {
		if (!DELIMITER_ROW.test(line)) cells.push(...cellsOf(line, lineStart))
		lineStart += line.length + 1
	}
	return cells
}
