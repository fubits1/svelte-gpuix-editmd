<!--
  @component
  A list, one row per item, as editmd's browser lays out `ul` and `ol` (style.css:230-266): each level 1.75em further
  in, rows 0.2em apart, the item text through native <markdown>. A task gets a clickable checkbox drawn in the gutter
  before the text, a ticked task's text muted and struck through; an item without a task keeps its list's marker, muted
  in the gutter (ListMarker). In a list without tasks the Block's own click opens it, as any other Block's does.
-->
<script lang="ts">
	import type { GpuixEvent, GpuixTheme } from 'gpuix-svelte'
	import {
		emptyLinkThemeFor,
		heldLinkThemeFor,
		inlineHtmlThemeFor,
		linkThemeFor,
		LIST_INDENT,
		listItemThemeFor,
		mutedThemeFor
	} from '../../../app/palette.ts'
	import { useCommandHeld, useQuoteColour, useTheme } from '../../../app/theme.svelte.ts'
	import { struckThrough } from '../../../core/paintedSlice.ts'
	import type { Block } from '../../../engine/blocks.ts'
	import { documentController } from '../controller.svelte.ts'
	import { dropFiles } from '../fileDrop.ts'
	import type { BlockViewProps } from '../DocumentView.model.ts'
	import ChangedRow from '../ChangedRow.svelte'
	import GapLines from '../GapLines.svelte'
	import NestedBlocks from '../NestedBlocks.svelte'
	import ListMarker, { markersOf } from './ListMarker.svelte'

	let { block, index, testKey }: BlockViewProps = $props()

	const theme = useTheme()
	const commandHeld = useCommandHeld()
	const quoteColour = useQuoteColour()

	/** test.ts finds a list holding tasks by `task-list-…`, `task-row-…` and `task-text-…`, one without by `list-…` */
	const listId = $derived(block.tasks ? 'task-list' : 'list')
	const itemId = $derived(block.tasks ? 'task' : 'list')

	/** an item's paragraphs with no gap between them (`listItemThemeFor`) */
	const itemTheme = $derived(listItemThemeFor(theme().textTheme))

	/** an open item's text, in a quote's muted colour inside one */
	const openTheme = $derived(quoteColour(itemTheme))

	/**
	 * a ticked task's text is muted and struck through in the faint colour (editmd `li[data-checked="true"] > p`,
	 * style.css:268-272), inside a quote too: native <markdown> ignores CSS, so the muted colour goes in as its theme's
	 * `text` and its inline code's (`mutedThemeFor`), the strike as `~~` in the painted source, and its line's colour
	 * as `textMuted`, which native paints a strike line in, and a link's underline too
	 */
	const doneTheme = $derived(mutedThemeFor(itemTheme))

	/**
	 * native draws a strike and a link's underline in `textMuted`: in a list without links an open item strikes in its
	 * text colour, editmd's `currentColor` (style.css has no `del` rule), and a ticked task keeps its faint strike; in a
	 * list with a link every item underlines it in the accent at 35%, the accent while ⌘ is held (`linkThemeFor`,
	 * style.css:170-181), and strikes in that colour too
	 */
	function lined(shown: GpuixTheme, checked: boolean): GpuixTheme {
		if (block.links) return linkThemeFor(shown, commandHeld())
		return checked ? shown : heldLinkThemeFor(shown)
	}

	/**
	 * an item holding a link with no text paints its source as editmd does, in the accent with no fill
	 * (`emptyLinkThemeFor`), and one holding an inline HTML tag its source in the muted colour with no fill
	 * (`inlineHtmlThemeFor`); every other item the Blocks' theme, a ticked task's muted (`doneTheme`)
	 */
	function themeOf(start: number, end: number, checked: boolean): GpuixTheme {
		const itemTheme = checked ? doneTheme : openTheme
		const within = (span: { start: number; end: number }) => span.start >= start && span.end <= end
		const holdsEmptyLink = block.emptyLinks?.some(within)
		const holdsHtml = block.inlineHtml?.some(within)
		if (!holdsEmptyLink && !holdsHtml) return lined(itemTheme, checked)
		const hasCode = documentController.text.slice(start, end).includes('`')
		const html = holdsHtml ? inlineHtmlThemeFor(itemTheme, hasCode) : itemTheme
		return lined(holdsEmptyLink ? emptyLinkThemeFor(html, hasCode) : html, checked)
	}

	/**
	 * editmd's check, the ticked box's background image (style.css:262-266): a path in a 12-unit box stroked white, 1.8
	 * wide with round caps and joins. GPUI paints an svg as a mask in its element's `color`, so the stroke's own white is
	 * the element's colour too
	 */
	const TICK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.6 9.6 3.6" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`

	/**
	 * `background-size: 75%` of the box's padding box: the 1em (16px) box less its 1.5px border on each side, 13px,
	 * makes the check 9.75px
	 */
	const TICK_SIZE = (16 - 2 * 1.5) * 0.75

	/**
	 * the click the box just took, by task and point, so the same click reaching the gutter around it does not tick the
	 * task back: a click on an empty box reaches both (measured headlessly), one on a ticked box, which paints a fill,
	 * only the box. nothing renders from it
	 */
	let boxClick: { mark: number; x: number | undefined; y: number | undefined } | null = null

	function tickFromBox(mark: number, event: GpuixEvent): void {
		boxClick = { mark, x: event.x, y: event.y }
		documentController.toggleTask(mark)
	}

	/** a click anywhere in the gutter left of the item's text, as editmd ticks a task (editor.ts:414-416) */
	function tickFromGutter(mark: number, event: GpuixEvent): void {
		const sameClick = boxClick?.mark === mark && boxClick.x === event.x && boxClick.y === event.y
		boxClick = null
		if (!sameClick) documentController.toggleTask(mark)
	}

	const items = $derived(block.items ?? [])
	/** the marker an item without a task keeps, as the browser draws it beside a task list's other items */
	const markers = $derived(markersOf(items))
</script>

<!-- an item's text from `start` to `end`, a ticked task's struck through -->
{#snippet itemText(start: number, end: number, checked: boolean)}
	{@const painted = documentController.paintedSliceOf(block, start, end)}
	<markdown
		source={documentController.renderSource(checked ? struckThrough(painted) : painted)}
		theme={themeOf(start, end, checked)}
		onlinkclick={(event) => documentController.linkClicked(event.value)}
	></markdown>
{/snippet}

<div class="list" testid={`${listId}-${testKey}`}>
	{#each items as item, n (item.contentStart)}
		{@const checked = item.task?.checked === true}
		<!-- an item's paragraph among Blocks of other kinds paints as its text does when it holds only paragraphs -->
		{#snippet itemParagraph(paragraph: Block)}
			{@render itemText(paragraph.start, paragraph.end, checked)}
		{/snippet}
		<GapLines place={{ start: item.contentStart, end: item.contentEnd }} />
		<div
			class="item"
			testid={`${itemId}-row-${item.contentStart}`}
			style:padding-left={`${theme().scaled(item.depth * LIST_INDENT)}px`}
		>
			{#if item.task}
				{@const mark = item.task.mark}
				<!--
				  `li[data-item-type="task"]::before`: the box sits in the gutter, 1.55em before the text. a click anywhere in
				  the gutter left of the text ticks the task, as editmd's (editor.ts:414-416); the box ticks it too, once
				  (`tickFromBox`)
				-->
				<div
					class="gutter"
					testid={`task-gutter-${mark}`}
					onclick={(event) => tickFromGutter(mark, event)}
					onfiledrop={dropFiles}
				>
					<div
						class={['checkbox', { checked: item.task.checked }]}
						testid={`task-${mark}`}
						role="checkbox"
						tabindex={0}
						aria-selected={item.task.checked}
						onclick={(event) => tickFromBox(mark, event)}
					>
						{#if item.task.checked}
							<svg
								class="tick"
								testid={`task-tick-${mark}`}
								source={TICK}
								style:width={`${theme().scaled(TICK_SIZE)}px`}
								style:height={`${theme().scaled(TICK_SIZE)}px`}
							></svg>
						{/if}
					</div>
				</div>
			{:else}
				<ListMarker
					marker={markers[n] ?? { kind: 'disc' }}
					testid={`list-marker-${item.contentStart}`}
				/>
			{/if}
			<!-- a list without tasks leaves the click, press and drop to the Block around it -->
			<div
				class="text"
				testid={`${itemId}-text-${item.contentStart}`}
				hitbox={block.tasks ? 'self' : null}
				onmousedown={block.tasks
					? (event) => documentController.pressBlock(event.x, event.y)
					: null}
				onclick={block.tasks
					? (event) =>
							documentController.clickBlock(index, {
								cmd: event.modifiers?.cmd === true,
								x: event.x,
								y: event.y
							})
					: null}
				onfiledrop={block.tasks ? dropFiles : null}
			>
				<!-- editmd's `li` box, which its Agent's tint marks, starts where the text does, its marker outside -->
				<ChangedRow start={item.contentStart} end={item.contentEnd}>
					<!--
					  an item holding a code block, a heading, a quote, a paragraph with images or any other Block besides text
					  paragraphs paints each as a top-level one is, as editmd's style.css applies to every element of
					  `.markdown-body`
					-->
					{#if item.children?.some((child) => child.kind !== 'paragraph' || child.images || child.segments)}
						<NestedBlocks
							blocks={item.children ?? []}
							{index}
							testKey={`${testKey}.${n}`}
							paragraph={itemParagraph}
						/>
					{:else}
						{@render itemText(item.contentStart, item.contentEnd, checked)}
					{/if}
				</ChangedRow>
			</div>
		</div>
	{/each}
</div>

<style>
	/*
	 * editmd's `li + li { margin-top: 0.2em }` between the rows, and a nested list's `margin: 0.2em 0 0` before its
	 * first item
	 */
	.list {
		display: flex;
		flex-direction: column;
		gap: var(--size-list-gap);
	}
	.item {
		display: flex;
		flex-direction: row;
		align-items: flex-start;
	}
	/* `ul { padding-left: 1.75em }`: the gutter before the text */
	/* the whole row's height, so a click anywhere left of the text lands in it */
	.gutter {
		flex-shrink: 0;
		align-self: stretch;
		cursor: pointer;
		width: var(--size-list-indent);
		padding-left: var(--size-checkbox-left);
	}
	/* `width: 1em; height: 1em; top: 0.3em; border: 1.5px solid var(--faint); border-radius: 4px` */
	.checkbox {
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--size-checkbox);
		height: var(--size-checkbox);
		margin-top: var(--size-checkbox-offset);
		border-width: 1.5px;
		border-color: var(--faint);
		border-radius: var(--size-checkbox-radius);
		cursor: pointer;
	}
	.checked {
		background-color: var(--accent);
		border-color: var(--accent);
	}
	/* white in both appearances, as editmd's stroke */
	.tick {
		flex-shrink: 0;
		color: #ffffff;
	}
	.text {
		flex-grow: 1;
		min-width: 0;
	}
</style>
