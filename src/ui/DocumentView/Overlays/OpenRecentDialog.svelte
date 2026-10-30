<!--
  @component
  File > Open Recent in place of editmd's submenu, which needs the menu bar gpuix cannot extend (gap G2): the recent
  files, newest first, each by name with its folder, and Clear Menu below them, as the submenu ends. A click on a file
  opens it, Up and Down move the highlight over the files and Clear Menu and Return chooses the highlighted one, as in
  the submenu, and Escape closes the list. AppKit chrome in editmd, so it does not zoom; render it inside `Portal`, so
  it paints over the Document.
-->
<script lang="ts">
	import { type GpuixEvent, on_window_key } from 'gpuix-svelte'
	import { basename, dirname } from 'node:path'
	import { moveSelection } from '../../../app/commandPalette.ts'

	let {
		paths,
		onopen,
		onclear,
		close
	}: {
		/** the recent files, newest first */
		paths: readonly string[]
		/** a file's entry: opens it */
		onopen: (path: string) => void
		/** Clear Menu: empties the list */
		onclear: () => void
		/** Escape */
		close: () => void
	} = $props()

	/** the highlighted row, the files then Clear Menu, -1 for none: transient key state, so it lives here */
	let highlighted = $state(-1)
	/** every row takes the highlight, Clear Menu last */
	const rows = $derived(Array.from({ length: paths.length + 1 }, () => ({ enabled: true })))

	/** Return on the highlighted row: a file opens, Clear Menu empties the list */
	function chooseHighlighted(): void {
		const path = paths[highlighted]
		if (path !== undefined) onopen(path)
		else if (highlighted === paths.length) onclear()
	}

	function pressKey(event: GpuixEvent): void {
		if (event.key === 'escape') close()
		else if (event.key === 'down') highlighted = moveSelection(rows, highlighted, 1)
		else if (event.key === 'up') highlighted = moveSelection(rows, highlighted, -1)
		else if (event.key === 'enter') chooseHighlighted()
	}

	$effect(() => on_window_key('keydown', pressKey))
</script>

<!-- the backdrop takes every click beside the list, so the Document under it stays untouched while it shows -->
<div class="open-recent-backdrop">
	<div class="open-recent" testid="open-recent" role="menu" aria-label="Open Recent">
		<text class="open-recent-title">Open Recent</text>
		{#each paths as path, index (path)}
			<div
				class={['open-recent-item', index === highlighted && 'open-recent-item-highlighted']}
				testid={`open-recent-${index}`}
				role="menuitem"
				tabindex={0}
				onclick={() => onopen(path)}
			>
				<text class="open-recent-name" testid={`open-recent-name-${index}`}>{basename(path)}</text>
				<text class="open-recent-folder">{dirname(path)}</text>
			</div>
		{/each}
		<div class="open-recent-separator"></div>
		<div
			class={['open-recent-item', highlighted === paths.length && 'open-recent-item-highlighted']}
			testid="open-recent-clear"
			role="menuitem"
			tabindex={0}
			onclick={onclear}
		>
			<text>Clear Menu</text>
		</div>
	</div>
</div>

<style>
	.open-recent-backdrop {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.open-recent {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 420px;
		padding: 12px;
		border-width: 1px;
		border-color: var(--border);
		border-radius: 10px;
		background-color: var(--surface);
		color: var(--text);
		font-size: 13px;
	}
	.open-recent-title {
		padding: 0 8px 6px;
		font-weight: 600;
	}
	.open-recent-item {
		display: flex;
		flex-direction: row;
		align-items: baseline;
		gap: 8px;
		padding: 4px 8px;
		border-radius: 5px;
		cursor: pointer;
	}
	.open-recent-item:hover,
	.open-recent-item-highlighted {
		background-color: var(--background);
	}
	.open-recent-name {
		flex-shrink: 0;
	}
	.open-recent-folder {
		flex-grow: 1;
		min-width: 0;
		color: var(--muted);
		font-size: 11px;
	}
	.open-recent-separator {
		height: 1px;
		margin: 4px 8px;
		background-color: var(--border);
	}
</style>
