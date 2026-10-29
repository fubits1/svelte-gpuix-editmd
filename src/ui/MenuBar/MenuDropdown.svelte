<!--
  @component
  The open menu of the in-window menu bar, dropped down at `x`, `y` (window coordinates, under its title): its items in
  a MenuPanel, and beside it the submenu of the enabled item that holds one, opened by a click or the pointer, its
  first row level with that item. Help holds macOS's menu search instead (HelpSearch). Up and Down move the highlight
  over the enabled items, Return runs the highlighted one or opens its submenu, Right and Left open and close the
  submenu, Escape closes the menu. Mount it keyed by the menu, so each starts with nothing highlighted; render it
  inside `Portal`, so it paints over the Document.
-->
<script lang="ts">
	import { type GpuixEvent, on_window_key } from 'gpuix-svelte'
	import { moveSelection } from '../../app/commandPalette.ts'
	import type { MenuBarItem } from '../../app/menu.ts'
	import { documentController } from '../DocumentView/controller.svelte.ts'
	import HelpSearch from './HelpSearch.svelte'
	import MenuPanel, { offsetOf } from './MenuPanel.svelte'

	let {
		index,
		x,
		y
	}: {
		/** the menu's place in `documentController.menus` */
		index: number
		x: number
		y: number
	} = $props()

	const menu = $derived(documentController.menus[index])
	const items = $derived(menu?.items ?? [])
	/** editmd's Help menu has no items; macOS puts its menu search there */
	const isHelp = $derived(menu?.title === 'Help')

	/** the highlighted row and the row whose submenu shows: transient pointer state, so it lives here */
	let highlighted = $state(-1)
	let submenuOf = $state<number | null>(null)
	let submenuHighlighted = $state(-1)

	const submenuItems = $derived.by((): readonly MenuBarItem[] => {
		const item = submenuOf === null ? undefined : items[submenuOf]
		return item?.kind === 'item' ? (item.submenu ?? []) : []
	})

	/** what moveSelection looks at: separators and disabled items never take the highlight */
	const selectable = $derived(
		items.map((item) => ({ enabled: item.kind === 'item' && item.enabled }))
	)

	/**
	 * row `row` takes the highlight, and its submenu shows when it holds one, any other closing; a disabled row
	 * takes no highlight and shows no submenu
	 */
	function highlight(row: number): void {
		const item = items[row]
		if (item?.kind !== 'item') return
		if (!item.enabled) {
			submenuOf = null
			return
		}
		highlighted = row
		if (submenuOf !== row) submenuHighlighted = -1
		submenuOf = item.submenu ? row : null
	}

	/** a click or Return on row `row`: an item with a submenu shows it, any other runs (a disabled one does nothing) */
	function choose(row: number): void {
		const item = items[row]
		if (item?.kind !== 'item') return
		if (item.submenu) highlight(row)
		else documentController.runMenuItem(item)
	}

	function chooseInSubmenu(row: number): void {
		const item = submenuItems[row]
		if (item?.kind === 'item' && !item.submenu) documentController.runMenuItem(item)
	}

	function hoverInSubmenu(row: number): void {
		const item = submenuItems[row]
		if (item?.kind === 'item' && item.enabled) submenuHighlighted = row
	}

	/** Help's search field keeps Up, Down and Return for its matches */
	function pressKey(event: GpuixEvent): void {
		if (event.key === 'escape') documentController.closeOverlay()
		else if (isHelp) return
		else if (event.key === 'down') moveHighlight(1)
		else if (event.key === 'up') moveHighlight(-1)
		else if (event.key === 'right' && highlighted !== -1) highlight(highlighted)
		else if (event.key === 'left') submenuOf = null
		else if (event.key === 'enter' && highlighted !== -1) choose(highlighted)
	}

	/** Up and Down leave any submenu closed, as a keyboard walk down a macOS menu does */
	function moveHighlight(step: 1 | -1): void {
		highlighted = moveSelection(selectable, highlighted, step)
		submenuOf = null
	}

	$effect(() => on_window_key('keydown', pressKey))
</script>

<div class="menu-dropdown" style="left: {x}px; top: {y}px">
	<div class="menu-dropdown-column">
		{#if isHelp}
			<MenuPanel prefix="menu" items={[]} highlighted={-1} onhover={() => {}} onchoose={() => {}}>
				{#snippet header()}
					<HelpSearch />
				{/snippet}
			</MenuPanel>
		{:else}
			<MenuPanel prefix="menu" {items} {highlighted} onhover={highlight} onchoose={choose} />
		{/if}
	</div>
	{#if submenuOf !== null}
		<div class="menu-dropdown-column" style="margin-top: {offsetOf(items, submenuOf)}px">
			<MenuPanel
				prefix="submenu"
				items={submenuItems}
				highlighted={submenuHighlighted}
				onhover={hoverInSubmenu}
				onchoose={chooseInSubmenu}
			/>
		</div>
	{/if}
</div>

<style>
	.menu-dropdown {
		position: absolute;
		display: flex;
		flex-direction: row;
	}
	.menu-dropdown-column {
		display: flex;
		flex-direction: column;
	}
</style>
