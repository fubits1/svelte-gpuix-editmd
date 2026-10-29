<!--
  @component
  A paragraph of only images, one <img> each, since native <markdown> paints images as link text. A local image
  paints at its natural size, scaled down to fit the column; one of unknown size gets a fixed box. Remote images
  show their alt text until View > Load Remote Images allows them.
-->
<script lang="ts">
	import { useTheme } from '../../../app/theme.svelte.ts'
	import type { BlockViewProps } from '../DocumentView.model.ts'
	import ImageView from './ImageView.svelte'

	let { block, index }: BlockViewProps = $props()

	const theme = useTheme()

	/** the space between two images written `![a](a) ![b](b)`: one space of the 16px body text (measured: 4px) */
	const SPACE = 4
</script>

<!--
  WebKit lays a paragraph's images out inline: side by side on their line, one space apart, bottoms on the line, and
  wrapping onto the next line at the column's edge (a README's badge row)
-->
<div class="images" style:column-gap={`${theme().scaled(SPACE)}px`}>
	{#each block.images ?? [] as image, imageIndex (imageIndex)}
		<ImageView {image} testIdSuffix={`${index}-${imageIndex}`} />
	{/each}
</div>

<style>
	.images {
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;
		align-items: flex-end;
	}
</style>
