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

{#each gaps as gap, n (n)}
	<DeletedLine
		colour={gap.colour}
		tooltip={gap.tooltip}
		testid={`gap-${key}-${n}`}
		tooltipTestid={`gap-tooltip-${key}-${n}`}
	/>
{/each}
