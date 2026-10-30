<!--
  @component
  The Blocks inside a quote or a list item, one under the other, each painted through Content as a top-level Block is,
  since editmd's style.css applies to every element of `.markdown-body`, and spaced as their margins collapse there. A
  list item hands its text paragraphs to `paragraph`, which paints them as its row's text, with no margin (`li > p`);
  a paragraph with images paints its images through Content, as at the top level.
-->
<script lang="ts">
	import type { Snippet } from 'svelte'
	import { spaceAbove, spaceInItem } from '../../app/blockSpacing.ts'
	import type { Block } from '../../engine/blocks.ts'
	import ChangedRow from './ChangedRow.svelte'
	import Content from './Content.svelte'
	import GapLines from './GapLines.svelte'

	let {
		blocks,
		index,
		testKey,
		paragraph
	}: {
		blocks: Block[]
		/** the top-level Block's index, which a click inside opens whole */
		index: number
		/** the container's test id key; its nth Block's is `<testKey>.<n>` */
		testKey: string
		/** a list item's text paragraph, painted as the item's text; a quote's paint as top-level ones */
		paragraph?: Snippet<[Block]>
	} = $props()
</script>

<div class="nested">
	{#each blocks as block, n (block.start)}
		{@const margin = paragraph
			? spaceInItem(blocks[n - 1], block)
			: spaceAbove(blocks[n - 1], block)}
		<!--
		  a quote's child is a row an Agent's change marks, unless it is a list or quote, whose own rows are; a list
		  item's Blocks belong to the item's row
		-->
		{@const row = !paragraph && !block.items && block.kind !== 'blockquote'}
		{#if row}
			<GapLines place={{ start: block.start, end: block.end }} />
		{/if}
		<div class="child" style:margin-top={margin && `var(--size-${margin})`}>
			{#if paragraph && block.kind === 'paragraph' && !block.images && !block.segments}
				{@render paragraph(block)}
			{:else if row}
				<ChangedRow start={block.start} end={block.end}>
					<Content {block} {index} testKey={`${testKey}.${n}`} />
				</ChangedRow>
			{:else}
				<Content {block} {index} testKey={`${testKey}.${n}`} />
			{/if}
		</div>
	{/each}
</div>

<style>
	.nested {
		display: flex;
		flex-direction: column;
		width: 100%;
	}
	.child {
		width: 100%;
	}
</style>
