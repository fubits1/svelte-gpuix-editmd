<!--
  @component
  One dropdown panel of the in-window menu bar: its items as rows, each with the title left and the key glyphs right in
  the muted colour, a ▸ on an item that holds a submenu, separators as 1px lines and disabled items in the faint colour.
  Rows and separators are fixed heights (`offsetOf` adds them up), so a submenu can hang level with its item. The
  pointer highlights what it is over; what a click does is the caller's. `header` goes above the rows (Help's search).
-->
<script module lang="ts">
	import type { MenuBarItem } from '../../app/menu.ts'

	/** a row's and a separator's height, kept in step with `.menu-row` and `.menu-separator` */
	const ROW_HEIGHT = 22
	const SEPARATOR_HEIGHT = 11

	/** how far row `index` sits below the panel's first row, for hanging its submenu level with it */
	export function offsetOf(items: readonly MenuBarItem[], index: number): number {
		return items
			.slice(0, index)
			.reduce((sum, item) => sum + (item.kind === 'separator' ? SEPARATOR_HEIGHT : ROW_HEIGHT), 0)
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte'

	let {
		items,
		prefix,
		highlighted,
		onhover,
		onchoose,
		header
	}: {
		items: readonly MenuBarItem[]
		/** names the panel's test ids: `<prefix>-panel`, `<prefix>-row-<index>`, `<prefix>-item-title-<index>` */
		prefix: 'menu' | 'submenu'
		/** the highlighted row, -1 for none */
		highlighted: number
		/** the pointer moved onto row `index` */
		onhover: (index: number) => void
		/** a click on row `index`, enabled or not */
		onchoose: (index: number) => void
		header?: Snippet
	} = $props()
</script>

<div class="menu-panel" testid={`${prefix}-panel`} role="menu">
	{@render header?.()}
	{#each items as item, index (index)}
		{#if item.kind === 'separator'}
			<div class="menu-separator" testid={`${prefix}-row-${index}`} role="separator">
				<div class="menu-separator-line"></div>
			</div>
		{:else}
			<!-- no tab stop: a click on an item leaves the keys with the field that has them, which the item may act on -->
			<div
				class={[
					'menu-row',
					!item.enabled && 'menu-row-disabled',
					index === highlighted && 'menu-row-highlighted'
				]}
				testid={`${prefix}-row-${index}`}
				role="menuitem"
				hitbox="self"
				onmouseenter={() => onhover(index)}
				onclick={() => onchoose(index)}
			>
				<text class="menu-item-title" testid={`${prefix}-item-title-${index}`}>{item.title}</text>
				{#if item.keys !== ''}
					<text
						class={!item.enabled
							? 'menu-item-keys-disabled'
							: index === highlighted
								? 'menu-item-keys-highlighted'
								: 'menu-item-keys'}
						testid={`${prefix}-item-keys-${index}`}>{item.keys}</text
					>
				{/if}
				{#if item.submenu}
					<text class="menu-item-arrow">▸</text>
				{/if}
			</div>
		{/if}
	{/each}
</div>

<style>
	.menu-panel {
		display: flex;
		flex-direction: column;
		min-width: 220px;
		padding: 5px;
		border-width: 1px;
		border-color: var(--border);
		border-radius: 6px;
		background-color: var(--surface);
		color: var(--text);
		font-size: 13px;
	}
	.menu-row {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 24px;
		height: 22px;
		padding: 0 10px;
		border-radius: 4px;
		cursor: default;
	}
	.menu-row-disabled {
		color: var(--faint);
	}
	.menu-row-highlighted {
		background-color: var(--accent);
		color: var(--background);
	}
	.menu-item-title {
		flex-grow: 1;
	}
	.menu-item-keys {
		flex-shrink: 0;
		color: var(--muted);
	}
	.menu-item-keys-disabled {
		flex-shrink: 0;
		color: var(--faint);
	}
	.menu-item-keys-highlighted {
		flex-shrink: 0;
		color: var(--background);
	}
	.menu-item-arrow {
		flex-shrink: 0;
	}
	.menu-separator {
		display: flex;
		flex-direction: column;
		justify-content: center;
		height: 11px;
		padding: 0 10px;
	}
	.menu-separator-line {
		height: 1px;
		background-color: var(--border);
	}
</style>
