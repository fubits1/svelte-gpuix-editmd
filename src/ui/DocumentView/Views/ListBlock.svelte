<!--
  @component
  A list without tasks, one row per item, as editmd's browser lays out `ul` and `ol` (style.css:230-240): each level
  1.75em further in, the marker muted in the gutter before the text (ListMarker), the item's own text through native
  <markdown>, rows 0.2em apart. The Block's own click opens it, as any other Block's does.
-->
<script lang="ts">
	import {
		emptyLinkThemeFor,
		heldLinkThemeFor,
		LIST_INDENT,
		listItemThemeFor
	} from '../../../app/palette.ts'
	import { useCommandHeld, useTheme } from '../../../app/theme.svelte.ts'
	import { documentController } from '../controller.svelte.ts'
	import type { BlockViewProps } from '../DocumentView.model.ts'
	import ListMarker, { markersOf } from './ListMarker.svelte'

	let { block, index }: BlockViewProps = $props()

	const theme = useTheme()
	const commandHeld = useCommandHeld()

	/**
	 * an item's paragraphs with no gap between them (`listItemThemeFor`); while ⌘ is held a link's underline takes its
	 * own colour (`heldLinkThemeFor`)
	 */
	const itemTheme = $derived.by(() => {
		const item = listItemThemeFor(theme().textTheme)
		return commandHeld() && block.links ? heldLinkThemeFor(item) : item
	})

	const items = $derived(block.items ?? [])
	const markers = $derived(markersOf(items))

	/**
	 * an item holding a link with no text paints its source as editmd does, in the accent with no fill
	 * (`emptyLinkThemeFor`); every other item the Blocks' theme
	 */
	function themeOf(start: number, end: number) {
		const holdsEmptyLink = block.emptyLinks?.some((link) => link.start >= start && link.end <= end)
		if (!holdsEmptyLink) return itemTheme
		return emptyLinkThemeFor(itemTheme, documentController.text.slice(start, end).includes('`'))
	}
</script>

<div class="list" testid={`list-${index}`}>
	{#each items as item, n (item.contentStart)}
		<div
			class="row"
			testid={`list-row-${item.contentStart}`}
			style:padding-left={`${theme().scaled(item.depth * LIST_INDENT)}px`}
		>
			<ListMarker
				marker={markers[n] ?? { kind: 'disc' }}
				testid={`list-marker-${item.contentStart}`}
			/>
			<div class="text" testid={`list-text-${item.contentStart}`}>
				<markdown
					source={documentController.renderSource(
						documentController.paintedSliceOf(block, item.contentStart, item.contentEnd)
					)}
					theme={themeOf(item.contentStart, item.contentEnd)}
					onlinkclick={(event) => documentController.linkClicked(event.value)}
				></markdown>
			</div>
		</div>
	{/each}
</div>

<style>
	/* `li + li { margin-top: 0.2em }`, and a nested list's `margin: 0.2em 0 0` before its first item */
	.list {
		display: flex;
		flex-direction: column;
		gap: var(--size-list-gap);
	}
	.row {
		display: flex;
		flex-direction: row;
		align-items: flex-start;
	}
	.text {
		flex-grow: 1;
		min-width: 0;
	}
</style>
