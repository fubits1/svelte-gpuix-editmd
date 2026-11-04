<!--
  @component
  The content of one row of a list or a quote (a list item's text, a quote's child), painting the Document from `start`
  to `end`, in its Agent's tint and bar when an Agent made that child new or another node (a ticked task): editmd marks
  such a child as a block (changes.ts:38-40, 49-50), with the tint and bar a Block marked whole takes (style.css:474-479),
  titled with its highlight's tooltip line over that row alone.
-->
<script lang="ts">
	import type { Snippet } from 'svelte'
	import PointerTip from '../PointerTip.svelte'
	import { documentController } from './controller.svelte.ts'

	let {
		start,
		end,
		children: content
	}: { start: number; end: number; children: Snippet } = $props()

	const mark = $derived(documentController.rowMarkOf(start, end))
</script>

{#if mark}
	<PointerTip text={mark.tooltip} testid={`row-tooltip-${start}`}>
		{#snippet children(pointer)}
			<div
				class="agent"
				testid={`agent-row-${start}`}
				style:border-color={`var(--${mark.agentClass})`}
				style:background-color={`var(--${mark.agentClass}-tint)`}
				{...pointer}
			>
				{@render content()}
			</div>
		{/snippet}
	</PointerTip>
{:else}
	{@render content()}
{/if}

<style>
	/*
	 * editmd's box-shadows as the box itself, as DocumentView's `.agent`: 8px left of the row with an 8px bar, so its
	 * text stays where an unmarked row's does
	 */
	.agent {
		width: auto;
		margin-left: var(--size-agent-outset);
		border-left-width: var(--size-agent-rail);
		padding-left: var(--size-agent-inset);
	}
</style>
