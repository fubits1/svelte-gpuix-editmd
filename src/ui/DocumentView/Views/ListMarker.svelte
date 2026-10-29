<!--
  @component
  One list item's marker in its gutter, as editmd's browser draws `li::marker` in the muted colour (style.css:240):
  a filled disc at the top level, a hollow circle one level down and a filled square below that, or an `ol`'s number
  right-aligned one space before the text. `markersOf` works out which, for a list's items in order.
-->
<script module lang="ts">
	import type { ListItem } from '../../../engine/blocks.ts'

	/** `none` for a continuation row, which belongs to the item above it and draws no marker of its own */
	export type Marker =
		{ kind: 'disc' | 'circle' | 'square' | 'none' } | { kind: 'number'; text: string }

	/** the browser's bullet for a list nested `depth` lists deep (its UA sheet's `ul ul` and `ul ul ul`) */
	const BULLETS = ['disc', 'circle', 'square'] as const

	/**
	 * each item's marker, items flat in document order as the engine lists them: an ordered item counts on from the
	 * first number of its list, as an `ol` does whatever the later items wrote, and a list nested under another item
	 * starts counting again. a continuation row (what follows an item's nested list) has none and counts nothing
	 */
	export function markersOf(items: readonly ListItem[]): Marker[] {
		/** the next number at each depth, null where that depth's list is a bullet list */
		const next: (number | null | undefined)[] = []
		return items.map((item) => {
			// an item, or its continuation, ends every list nested deeper than itself
			next.length = item.depth + 1
			if (item.continuation) return { kind: 'none' }
			if (!/^\d/.test(item.marker)) {
				next[item.depth] = null
				return { kind: BULLETS[Math.min(item.depth, BULLETS.length - 1)]! }
			}
			const number = next[item.depth] ?? Number.parseInt(item.marker, 10)
			next[item.depth] = number + 1
			return { kind: 'number', text: `${number}.` }
		})
	}
</script>

<script lang="ts">
	let { marker, testid }: { marker: Marker; testid: string } = $props()
</script>

<!-- a continuation row keeps the gutter, so its text sits at its item's content column, and draws nothing in it -->
<div class="gutter">
	{#if marker.kind === 'number'}
		<text class="number" {testid}>{marker.text}</text>
	{:else if marker.kind !== 'none'}
		<div class={['bullet', marker.kind]} {testid}></div>
	{/if}
</div>

<style>
	/* `padding-left: 1.75em` is the gutter the marker sits in, outside the text as `list-style-position: outside` */
	.gutter {
		display: flex;
		flex-direction: row;
		justify-content: flex-end;
		flex-shrink: 0;
		width: var(--size-list-indent);
		padding-right: var(--size-list-number-gap);
	}
	/* the number in one row of the body text, so its baseline meets the item's first line */
	.number {
		flex-shrink: 0;
		white-space: nowrap;
		font-size: var(--size-list-marker);
		line-height: var(--size-list-line-height);
		color: var(--muted);
	}
	.bullet {
		position: absolute;
		left: var(--size-list-bullet-left);
		top: var(--size-list-bullet-top);
		width: var(--size-list-bullet);
		height: var(--size-list-bullet);
	}
	.disc {
		border-radius: var(--size-list-bullet);
		background-color: var(--muted);
	}
	/* a 1px ring, as WebKit draws the circle at 16px */
	.circle {
		border-width: 1px;
		border-color: var(--muted);
		border-radius: var(--size-list-bullet);
	}
	.square {
		background-color: var(--muted);
	}
</style>
