<!--
  @component
  The command palette in place of editmd's menu bar, which gpuix cannot extend (gap G2): a search field over every menu
  item, as macOS's Help menu search finds menu items, and the matches in menu order, each with its menu and its key
  equivalent. Disabled items are listed greyed and never run. Up and Down move the selection past them, Return or a
  click runs the selected item, Escape closes. AppKit chrome in editmd, so it does not zoom; render it inside `Portal`,
  so it paints over the Document.
-->
<script lang="ts">
	import { get_native, type GpuixEvent, on_window_key, type ShadowNode } from 'gpuix-svelte'
	import Scroller from 'gpuix-svelte/components/Scroller.svelte'
	import { SvelteMap } from 'svelte/reactivity'
	import { firstEnabled, moveSelection } from '../../../app/commandPalette.ts'
	import { filterEntries, type MenuCommand, type MenuEntry } from '../../../app/menu.ts'
	import { useTheme } from '../../../app/theme.svelte.ts'

	let {
		entries,
		onrun,
		close
	}: {
		/** every menu item, titled and enabled for the Document's state (`menuEntries`) */
		entries: readonly MenuEntry[]
		/** Return or a click on an enabled item */
		onrun: (command: MenuCommand) => void
		/** Escape */
		close: () => void
	} = $props()

	const theme = useTheme()

	/**
	 * the rows shown before the list scrolls, each a fixed height (`.palette-row`'s, kept in step), so the list
	 * is exactly as tall as its rows
	 */
	const VISIBLE_ROWS = 12
	const ROW_HEIGHT = 26

	/** the typed query: transient dialog text, so it lives here (ADR-0011) */
	let query = $state('')
	const matches = $derived(filterEntries(query, entries))
	/** the selected row, -1 for none; each new query selects its first enabled match, Up and Down move it */
	let selected = $derived(firstEnabled(matches))

	/** Return: runs the selected item; with none selected (every match disabled) it does nothing */
	function runSelected(): void {
		const entry = matches[selected]
		if (entry?.enabled) onrun(entry.command)
	}

	/**
	 * the palette's own keys. Return arrives once: through the field's `onsubmit` while the field has focus, which
	 * then keeps it from this listener, and through this listener otherwise, as in the Save As dialog
	 */
	function pressKey(event: GpuixEvent): void {
		if (event.key === 'escape') close()
		else if (event.key === 'enter') runSelected()
		else if (event.key === 'down') selected = moveSelection(matches, selected, 1)
		else if (event.key === 'up') selected = moveSelection(matches, selected, -1)
	}

	$effect(() => on_window_key('keydown', pressKey))

	/** each painted row's node by index, for keeping the selected row in view; nothing renders from it */
	const rowNodes = new SvelteMap<number, ShadowNode>()

	function trackRow(index: number, node: ShadowNode) {
		rowNodes.set(index, node)
		return () => {
			if (rowNodes.get(index) === node) rowNodes.delete(index)
		}
	}

	/**
	 * scrolls the list just enough that row `index` shows whole, as a menu keeps its highlighted item in view: the
	 * offset is set on the row's first ancestor that reports one, the Scroller's column, as DocumentView scrolls
	 * a Block. bounds are the last paint's, so a row that has not painted yet is left alone
	 */
	function keepInView(index: number): void {
		const native = get_native()
		const node = rowNodes.get(index)
		const row = node?.nativeId == null ? null : native?.getElementBounds(node.nativeId)
		if (!native || !node || !row) return
		for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
			if (ancestor.nativeId === null) continue
			const offset = native.getScrollOffset(ancestor.nativeId)
			const viewport = native.getElementBounds(ancestor.nativeId)
			if (!offset || !viewport) continue
			const [x = 0, y = 0] = offset
			const above = viewport.y - row.y
			const below = row.y + row.height - (viewport.y + viewport.height)
			if (above > 0) native.scrollTo(ancestor.nativeId, x, y + above)
			else if (below > 0) native.scrollTo(ancestor.nativeId, x, y - below)
			return
		}
	}

	$effect(() => keepInView(selected))
</script>

<!-- the backdrop takes every click beside the palette, so the Document under it stays untouched while it shows -->
<div class="palette-backdrop">
	<div class="palette" testid="command-palette" role="dialog" aria-label="Command Palette">
		<input
			class="palette-field"
			testid="command-palette-field"
			autofocus
			placeholder="Search menus"
			value={query}
			theme={theme().chromeTextTheme}
			onchange={(event) => (query = event.value ?? '')}
			onsubmit={runSelected}
		/>
		{#if matches.length > 0}
			<div
				class="palette-list"
				testid="command-palette-list"
				role="listbox"
				aria-label="Menu Items"
				style="height: {Math.min(matches.length, VISIBLE_ROWS) * ROW_HEIGHT}px"
			>
				<Scroller gap={0}>
					{#each matches as entry, index (entry.command)}
						<!-- the pointer selects what it is over, as in a menu; a disabled item never takes the selection -->
						<div
							class={[
								'palette-row',
								!entry.enabled && 'palette-disabled',
								index === selected && 'palette-selected'
							]}
							testid={`palette-row-${index}`}
							role="option"
							tabindex={-1}
							aria-selected={index === selected}
							hitbox="self"
							onmouseenter={() => {
								if (entry.enabled) selected = index
							}}
							onclick={() => {
								if (entry.enabled) onrun(entry.command)
							}}
							{@attach (node: ShadowNode) => trackRow(index, node)}
						>
							<text class="palette-title" testid={`palette-title-${index}`}>{entry.title}</text>
							<text class={index === selected ? 'palette-menu-selected' : 'palette-menu'}>
								{entry.menu}
							</text>
							<text class="palette-keys">{entry.keys}</text>
						</div>
					{/each}
				</Scroller>
			</div>
		{/if}
	</div>
</div>

<style>
	.palette-backdrop {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding-top: 56px;
	}
	.palette {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 520px;
		padding: 8px;
		border-width: 1px;
		border-color: var(--border);
		border-radius: 10px;
		background-color: var(--surface);
		color: var(--text);
		font-size: 13px;
	}
	.palette-field {
		padding: 4px 8px;
		border-width: 1px;
		border-color: var(--border);
		border-radius: 6px;
		background-color: var(--background);
	}
	.palette-list {
		display: flex;
		flex-direction: column;
	}
	.palette-row {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 8px;
		height: 26px;
		padding: 0 8px;
		border-radius: 5px;
		cursor: default;
	}
	.palette-disabled {
		color: var(--muted);
	}
	.palette-selected {
		background-color: var(--accent);
		color: var(--background);
	}
	.palette-title {
		flex-shrink: 0;
	}
	.palette-menu {
		flex-grow: 1;
		min-width: 0;
		color: var(--muted);
		font-size: 11px;
	}
	.palette-menu-selected {
		flex-grow: 1;
		min-width: 0;
		font-size: 11px;
	}
	.palette-keys {
		flex-shrink: 0;
	}
</style>
