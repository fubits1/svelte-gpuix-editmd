<!--
  @component
  The dashed lines for children an Agent took away from a list or a quote, as editmd's `between` line (changes.ts:41-44,
  highlights.ts:189-196): those above the row painting the Document from `start` to `end`, or with `index` those after
  the last row of that top-level Block.
-->
<script lang="ts">
	import { documentController } from './controller.svelte.ts'
	import DeletedLine from './DeletedLine.svelte'

	let { place }: { place: { start: number; end: number } | { index: number } } = $props()

	const gaps = $derived(documentController.gapsAt(place))
	/** the lines' test id key: the row's start, or `end-<index>` after a Block's last row */
	const key = $derived('index' in place ? `end-${place.index}` : `${place.start}`)
</script>

{#snippet lines()}
	{#each gaps as gap, n (n)}
		<DeletedLine
			colour={gap.colour}
			tooltip={gap.tooltip}
			testid={`gap-${key}-${n}`}
			tooltipTestid={`gap-tooltip-${key}-${n}`}
		/>
	{/each}
{/snippet}

{#if 'index' in place && gaps.length > 0}
	<div class="after-last">
		{@render lines()}
	</div>
{:else}
	{@render lines()}
{/if}

<style>
	/*
	 * the lines' `margin: 0.2rem 0` (style.css:494-498), collapsed between adjacent ones: 0.2rem after the last row and
	 * between the lines; between rows the list's own gap spaces them
	 */
	.after-last {
		display: flex;
		flex-direction: column;
		width: 100%;
		gap: var(--size-list-gap);
		padding-top: var(--size-list-gap);
	}
</style>
