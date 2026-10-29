<!--
  @component
  A list holding tasks, one row per item: a clickable checkbox for tasks, the item text through native <markdown>,
  a ticked task's muted and struck through. Laid out as editmd's browser does (style.css:230-266): each level 1.75em
  further in, the box drawn in the gutter before the text, an item without a task keeping its list's marker.
-->
<script lang="ts">
	import type { GpuixEvent } from 'gpuix-svelte'
	import {
		heldLinkThemeFor,
		LIST_INDENT,
		listItemThemeFor,
		mutedThemeFor
	} from '../../../app/palette.ts'
	import { useCommandHeld, useTheme } from '../../../app/theme.svelte.ts'
	import { struckThrough } from '../../../core/paintedSlice.ts'
	import { documentController } from '../controller.svelte.ts'
	import { dropFiles } from '../fileDrop.ts'
	import type { BlockViewProps } from '../DocumentView.model.ts'
	import ListMarker, { markersOf } from './ListMarker.svelte'

	let { block, index }: BlockViewProps = $props()

	const theme = useTheme()
	const commandHeld = useCommandHeld()

	/**
	 * an item's paragraphs with no gap between them (`listItemThemeFor`); while ⌘ is held a link's underline takes its
	 * own colour (`heldLinkThemeFor`)
	 */
	const openTheme = $derived.by(() => {
		const item = listItemThemeFor(theme().textTheme)
		return commandHeld() && block.links ? heldLinkThemeFor(item) : item
	})

	/**
	 * a ticked task's text is muted and struck through in the faint colour (editmd `li[data-checked="true"] > p`,
	 * style.css:268-272): native <markdown> ignores CSS, so the muted colour goes in as its theme's `text` and its
	 * inline code's (`mutedThemeFor`), the strike as `~~` in the painted source, and its line's colour as `textMuted`,
	 * which native paints a strike line in, and a link's underline too: while ⌘ is held the underline takes the
	 * task's muted text colour (`heldLinkThemeFor`), and with it, until ⌘ goes, the strike line
	 */
	const doneTheme = $derived.by(() => {
		const done = mutedThemeFor(listItemThemeFor(theme().textTheme))
		return commandHeld() && block.links ? heldLinkThemeFor(done) : done
	})

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

<div class="list" testid={`task-list-${index}`}>
	{#each items as item, n (item.contentStart)}
		{@const painted = documentController.paintedSliceOf(block, item.contentStart, item.contentEnd)}
		<div
			class="item"
			testid={`task-row-${item.contentStart}`}
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
			<div
				class="text"
				testid={`task-text-${item.contentStart}`}
				hitbox="self"
				onmousedown={(event) => documentController.pressBlock(event.x, event.y)}
				onclick={(event) =>
					documentController.clickBlock(index, {
						cmd: event.modifiers?.cmd === true,
						x: event.x,
						y: event.y
					})}
				onfiledrop={dropFiles}
			>
				<markdown
					source={documentController.renderSource(
						item.task?.checked ? struckThrough(painted) : painted
					)}
					theme={item.task?.checked ? doneTheme : openTheme}
					onlinkclick={(event) => documentController.linkClicked(event.value)}
				></markdown>
			</div>
		</div>
	{/each}
</div>

<style>
	/* editmd's `li + li { margin-top: 0.2em }` between the rows */
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
