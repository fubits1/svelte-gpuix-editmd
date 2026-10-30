<!--
  @component
  A GFM table as editmd's `.markdown-body table` (style.css:316-342): sized to its content and scrolling sideways when
  wider than the column, 0.94em text, every cell `padding: 0.4em 0.85em` inside 1px borders, the header row bold on
  the surface fill, each column aligned as its delimiter cell says. A cell's inline markdown paints through native
  <markdown>. Columns are laid out side by side, each a stack of its cells, so every column takes its widest cell's
  width as `width: max-content` gives it; a click anywhere opens the Block, as any other Block's does.
-->
<script module lang="ts">
	import { blockLines } from '../../../app/blockLines.ts'

	type CellAlign = 'left' | 'center' | 'right'

	/** a cell's text as Document offsets, trimmed */
	type Cell = { start: number; end: number }

	/** a table's rows of cells, header first, and each column's alignment */
	type Table = { rows: Cell[][]; align: CellAlign[] }

	/**
	 * the cells of the row `line`, which starts at Document offset `at`: split on every pipe that is not escaped, one
	 * inside a code span too, as GFM splits a row before its inline parse (measured headless: satteri gives "`x" and "y`" for
	 * "| `x|y` |"), without the row's outer pipes, each cell trimmed
	 */
	function cellsOf(line: string, at: number): Cell[] {
		const bounds: number[] = []
		for (let i = 0; i < line.length; i++) {
			const character = line[i]
			if (character === '\\') i++
			else if (character === '|') bounds.push(i)
		}
		const first = line.trimStart().startsWith('|') ? bounds.shift() : undefined
		const lastPipe = bounds.at(-1)
		const closed = lastPipe !== undefined && line.slice(lastPipe + 1).trim() === ''
		if (closed) bounds.pop()
		const starts = [first === undefined ? 0 : first + 1, ...bounds.map((pipe) => pipe + 1)]
		const ends = [...bounds, closed ? lastPipe : line.length]
		return starts.map((start, column) => {
			let from = start
			let to = ends[column] ?? line.length
			while (from < to && /\s/.test(line[from]!)) from++
			while (to > from && /\s/.test(line[to - 1]!)) to--
			return { start: at + from, end: at + to }
		})
	}

	/** a delimiter cell's alignment: `:--` left, `--:` right, `:-:` centre, `---` left as the browser's default */
	function alignOf(delimiter: string): CellAlign {
		const text = delimiter.trim()
		if (text.startsWith(':') && text.endsWith(':') && text.length > 1) return 'center'
		if (text.endsWith(':')) return 'right'
		return 'left'
	}

	/**
	 * `source`, a table Block's text starting at Document offset `start`, as rows of cells: the header row, then the
	 * body rows after the delimiter row; a body row's missing cells are empty, its extra ones dropped, as GFM does. a
	 * table inside a quote or a list item reads its lines without what its container puts in front of them (`prefix`)
	 */
	function tableOf(source: string, start: number, prefix?: string): Table {
		const lines = blockLines(source, start, prefix).filter(({ text }) => text.trim() !== '')
		const [header, delimiter, ...body] = lines
		if (!header || !delimiter) return { rows: [], align: [] }
		const headerCells = cellsOf(header.text, header.at)
		const align = cellsOf(delimiter.text, delimiter.at).map((cell) =>
			alignOf(source.slice(cell.start - start, cell.end - start))
		)
		const width = headerCells.length
		const rows = [
			headerCells,
			...body.map(({ text, at: lineAt }) => {
				const cells = cellsOf(text, lineAt).slice(0, width)
				const end = lineAt + text.length
				while (cells.length < width) cells.push({ start: end, end })
				return cells
			})
		]
		return {
			rows,
			align: Array.from({ length: width }, (_value, column) => align[column] ?? 'left')
		}
	}
</script>

<script lang="ts">
	import { cellSizing } from '../../../app/cellSizing.ts'
	import { monoLinesWidth } from '../../../app/monoLines.ts'
	import { linkThemeFor, tableThemeFor } from '../../../app/palette.ts'
	import { useCommandHeld, useQuoteColour, useTheme } from '../../../app/theme.svelte.ts'
	import { documentController } from '../controller.svelte.ts'
	import { dropFiles } from '../fileDrop.ts'
	import type { BlockViewProps } from '../DocumentView.model.ts'

	let { block, index, testKey }: BlockViewProps = $props()

	const theme = useTheme()
	const commandHeld = useCommandHeld()
	const quoteColour = useQuoteColour()

	const table = $derived(tableOf(documentController.sliceOf(block), block.start, block.prefix))
	const columns = $derived(table.align.map((align, column) => ({ align, column })))
	/**
	 * `font-size: 0.94em` for every cell; a table with a link underlines it in the accent at 35%, the accent while ⌘ is
	 * held (`linkThemeFor`, style.css:170-181)
	 */
	const cellTheme = $derived.by(() => {
		const sized = tableThemeFor(quoteColour(theme().textTheme), theme().zoom)
		return block.links ? linkThemeFor(sized, commandHeld()) : sized
	})

	/**
	 * a cell's `\|` as the pipe GFM takes it for before the inline parse, so a code span shows it bare too; any other
	 * escape stays for native <markdown>, and an escaped backslash keeps the pipe after it as it was
	 */
	function unescapedPipes(source: string): string {
		let out = ''
		for (let i = 0; i < source.length; i++) {
			const character = source[i]
			const next = source[i + 1]
			if (character === '\\' && next !== undefined) {
				out += next === '|' ? '|' : `\\${next}`
				i++
			} else out += character
		}
		return out
	}

	/** a no-break space: a paragraph of it paints one empty line, where a blank cell would paint none */
	const EMPTY_LINE = '\u00a0'

	/**
	 * what a cell paints: its own text as native <markdown> paints it (`paintedSliceOf`), its `\|` as pipes, a header's
	 * in `**` since `th` is bold (600; native <markdown> has bold only). an empty cell paints one empty line, as editmd's
	 * holds an empty paragraph, so a row mixing empty and filled cells keeps its cells one height
	 */
	function sourceOf(cell: Cell, header: boolean): string {
		const painted = unescapedPipes(documentController.paintedSliceOf(block, cell.start, cell.end))
		if (painted === '') return EMPTY_LINE
		return header ? `**${painted}**` : painted
	}

	/** a cell's text as its width is measured (`cellSizing`): its sans text, and its code spans in SF Mono */
	function sizingOf(cell: Cell) {
		return cellSizing(unescapedPipes(documentController.text.slice(cell.start, cell.end)))
	}

	/**
	 * how wide a cell's code spans paint: native inline code is SF Mono at the cell's text size
	 * (measured headless), each span in a pill, given editmd's `code { padding: 0.35em }` either side so its
	 * glyphs never wrap
	 */
	function codeWidthOf(code: readonly string[]): number {
		const size = cellTheme.metrics?.mdTextSize ?? 16
		return code.reduce((width, span) => width + monoLinesWidth(span, size) + 0.7 * size, 0)
	}

	/**
	 * each cell's painted text height by `row-column`, as its layout event last reported it: the text's own box is
	 * measured, not the cell, which its row's height stretches
	 */
	const textHeights = $state<Record<string, number>>({})

	/**
	 * every row's height, the tallest of its cells' painted text, so a cell whose text wraps taller takes its whole row
	 * with it, as a table row does in WebKit: each column is a stack of its own, which lines up across only when every
	 * row's cells are one height. 0 for a row not yet painted
	 */
	const rowHeights = $derived(
		table.rows.map((row, rowIndex) =>
			Math.max(0, ...row.map((_cell, column) => textHeights[`${rowIndex}-${column}`] ?? 0))
		)
	)

	const ALIGN_CLASS: Record<CellAlign, string> = {
		left: 'align-left',
		center: 'align-center',
		right: 'align-right'
	}
</script>

<!--
  the scroll box takes the wheel, and with it the click, which opens the Block as the Block's own click would, and a
  drop, which GPUI would otherwise hand to that click
-->
<div
	class="scroll"
	testid={`table-${testKey}`}
	onclick={(event) => documentController.clickBlock(index, { cmd: event.modifiers?.cmd === true })}
	onfiledrop={dropFiles}
>
	<div class="grid">
		{#each columns as { align, column } (column)}
			<div class="column">
				{#each table.rows as row, rowIndex (rowIndex)}
					{@const cell = row[column]}
					{#if cell}
						{@const sizing = sizingOf(cell)}
						<div
							class={['cell', ALIGN_CLASS[align], rowIndex === 0 && 'header']}
							testid={`table-cell-${testKey}-${rowIndex}-${column}`}
						>
							<!--
							  native <markdown> has no width of its own (it wraps to one character a line in a box sized
							  to content), so the cell's text as one hidden line gives this box its width, as
							  `width: max-content` measures it, and the <markdown> stretches across it; the cell places
							  the box as its column's alignment says. the box is at least its row's height, so the
							  columns' stacks line up row by row (`rowHeights`); a <markdown> reports no layout, so a
							  div around it does
							-->
							<div
								class="content"
								style:min-height={rowHeights[rowIndex] ? `${rowHeights[rowIndex]}px` : null}
							>
								<div
									class="text"
									onlayout={(event) => (textHeights[`${rowIndex}-${column}`] = event.height ?? 0)}
								>
									<markdown
										source={documentController.renderSource(sourceOf(cell, rowIndex === 0))}
										theme={cellTheme}
										onlinkclick={(event) => documentController.linkClicked(event.value)}
									></markdown>
								</div>
								<div class="sizer">
									<text class={['sizer-text', rowIndex === 0 && 'sizer-bold']}>{sizing.plain}</text>
									{#if sizing.code.length > 0}
										<div class="sizer-code" style:width={`${codeWidthOf(sizing.code)}px`}></div>
									{/if}
								</div>
							</div>
						</div>
					{/if}
				{/each}
			</div>
		{/each}
	</div>
</div>

<style>
	/* `display: block; width: max-content; max-width: 100%; overflow: auto` */
	.scroll {
		align-self: flex-start;
		max-width: 100%;
		overflow-x: scroll;
	}
	/* `border-collapse: collapse`: the grid draws the outer left and top edges, each cell its right and bottom */
	.grid {
		display: flex;
		flex-direction: row;
		border-left-width: 1px;
		border-top-width: 1px;
		border-color: var(--border);
	}
	.column {
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
	}
	/* `th, td { padding: 0.4em 0.85em; border: 1px solid var(--border) }` of the 0.94em text */
	.cell {
		display: flex;
		flex-direction: column;
		padding: var(--size-table-cell-padding-y) var(--size-table-cell-padding-x);
		border-right-width: 1px;
		border-bottom-width: 1px;
		border-color: var(--border);
	}
	.content {
		display: flex;
		flex-direction: column;
	}
	/* as tall as the cell's text, which the row's height leaves unstretched */
	.text {
		display: flex;
		flex-direction: column;
	}
	/* one line of the cell's text at the cell's size, laid out for its width only: its sans text, then its code's room */
	.sizer {
		display: flex;
		flex-direction: row;
		height: 0;
		overflow: hidden;
		visibility: hidden;
	}
	.sizer-text {
		flex-shrink: 0;
		white-space: nowrap;
		font-size: var(--size-table-text);
	}
	.sizer-code {
		flex-shrink: 0;
	}
	/* native <markdown>'s bold, which a header cell's text paints in */
	.sizer-bold {
		font-weight: bold;
	}
	/* `th { font-weight: 600; background: var(--surface) }` */
	.header {
		background-color: var(--surface);
	}
	.align-left {
		align-items: flex-start;
	}
	.align-center {
		align-items: center;
	}
	.align-right {
		align-items: flex-end;
	}
</style>
