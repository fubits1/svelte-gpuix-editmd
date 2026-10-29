<!--
  @component
  editmd's menu bar (MainMenu.swift) drawn inside the window, since gpuix's native bar holds only its fixed app and
  Window menus (gap G2): a strip across the top with the six titles in a row, a separator line below. A click on a title
  drops its menu down under it, through the controller's overlay handler, so it closes any other dialog and opening
  one closes it; a click on the open title or beside the menu closes it, and while one is open the pointer moving onto
  another title switches to that menu, as macOS does. Window chrome, so it does not zoom.
-->
<script lang="ts">
	import { get_native, type ShadowNode } from 'gpuix-svelte'
	import Portal from 'gpuix-svelte/components/Portal.svelte'
	import { SvelteMap } from 'svelte/reactivity'
	import { documentController } from './DocumentView/controller.svelte.ts'
	import MenuDropdown from './MenuBar/MenuDropdown.svelte'

	const openIndex = $derived(
		documentController.overlay?.kind === 'menu' ? documentController.overlay.index : null
	)

	/** the bar's and each title's node, for hanging a menu under its title; nothing renders from them */
	let barNode: ShadowNode | null = null
	const titleNodes = new SvelteMap<number, ShadowNode>()

	function trackBar(node: ShadowNode) {
		barNode = node
		return () => {
			if (barNode === node) barNode = null
		}
	}

	function trackTitle(index: number, node: ShadowNode) {
		titleNodes.set(index, node)
		return () => {
			if (titleNodes.get(index) === node) titleNodes.delete(index)
		}
	}

	/** `node`'s box as last painted, null before its first paint */
	function boxOf(node: ShadowNode | null | undefined) {
		return node?.nativeId == null ? null : (get_native()?.getElementBounds(node.nativeId) ?? null)
	}

	/** where the open menu hangs, in window coordinates: under its title, at the bar's bottom edge */
	const placement = $derived.by(() => {
		if (openIndex === null) return null
		const bar = boxOf(barNode)
		return { x: boxOf(titleNodes.get(openIndex))?.x ?? 0, y: bar ? bar.y + bar.height : 0 }
	})

	function clickTitle(index: number): void {
		if (openIndex === index) documentController.closeOverlay()
		else documentController.openMenu(index)
	}

	function enterTitle(index: number): void {
		if (openIndex !== null && openIndex !== index) documentController.openMenu(index)
	}
</script>

<div class="menu-bar" testid="menu-bar" role="menubar" {@attach trackBar}>
	{#each documentController.menus as menu, index (menu.title)}
		<!--
		  no tab stop, so a click leaves the keys with the field that has them, as AppKit's menus never take first
		  responder: Edit's and Format's items then act on that field's selection
		-->
		<div
			class={['menu-title', index === openIndex && 'menu-title-open']}
			testid={`menu-title-${index}`}
			role="menuitem"
			hitbox="self"
			onmouseenter={() => enterTitle(index)}
			onclick={() => clickTitle(index)}
			{@attach (node: ShadowNode) => trackTitle(index, node)}
		>
			<text testid={`menu-title-text-${index}`}>{menu.title}</text>
		</div>
	{/each}
</div>

{#if openIndex !== null && placement}
	<Portal>
		<!-- takes every click below the bar beside the menu, so it closes the menu and leaves the Document untouched -->
		<div
			class="menu-backdrop"
			style="top: {placement.y}px"
			hitbox="self"
			onclick={() => documentController.closeOverlay()}
		></div>
		{#key openIndex}
			<MenuDropdown index={openIndex} x={placement.x} y={placement.y} />
		{/key}
	</Portal>
{/if}

<style>
	.menu-bar {
		display: flex;
		flex-direction: row;
		align-items: center;
		flex-shrink: 0;
		height: 24px;
		padding: 0 6px;
		border-bottom-width: 1px;
		border-color: var(--border);
		background-color: var(--surface);
		color: var(--text);
		font-size: 13px;
	}
	.menu-title {
		display: flex;
		align-items: center;
		height: 20px;
		padding: 0 8px;
		border-radius: 4px;
		cursor: default;
	}
	.menu-title-open {
		background-color: var(--accent);
		color: var(--background);
	}
	.menu-backdrop {
		position: absolute;
		right: 0;
		bottom: 0;
		left: 0;
	}
</style>
