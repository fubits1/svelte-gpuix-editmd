<!--
  @component
  macOS's menu search, which it puts in the Help menu (editmd's own Help menu is empty): a search field, and once
  something is typed, every item of the in-window menu bar, submenus included, whose title holds each typed word,
  shown as "Menu ▸ Submenu ▸ Title" with its key glyphs, disabled ones greyed and never run (`searchMenuBar`). Up and
  Down move the selection past the disabled ones; Return or a click runs the selected item through the controller
  exactly as a click on it in the bar does (window actions, Open Recent's files, Clear Menu, Enter Full Screen).
-->
<script lang="ts">
	import { type GpuixEvent, on_window_key } from 'gpuix-svelte'
	import { firstEnabled, moveSelection } from '../../app/commandPalette.ts'
	import { magnifierGlyph } from '../../app/glyphs.ts'
	import { type MenuSearchHit, searchMenuBar } from '../../app/menu.ts'
	import { useTheme } from '../../app/theme.svelte.ts'
	import { documentController } from '../DocumentView/controller.svelte.ts'

	const theme = useTheme()

	/** the typed query: transient field text, so it lives here (ADR-0011) */
	let query = $state('')
	/** nothing until something is typed, as macOS lists no item for an empty search */
	const hits = $derived(searchMenuBar(query, documentController.menus))
	/** what the selection looks at: an item with no command of its own (field-only) never takes it */
	const matches = $derived(
		hits.map((hit) => ({ ...hit, enabled: hit.item.enabled && hit.item.command !== null }))
	)
	/** the selected match, -1 for none; each new query selects its first enabled match */
	let selected = $derived(firstEnabled(matches))

	function run(hit: (MenuSearchHit & { enabled: boolean }) | undefined): void {
		if (hit?.enabled) documentController.runMenuItem(hit.item)
	}

	/** Return reaches `onsubmit` while the field has focus; Up and Down come through the window */
	function pressKey(event: GpuixEvent): void {
		if (event.key === 'down') selected = moveSelection(matches, selected, 1)
		else if (event.key === 'up') selected = moveSelection(matches, selected, -1)
	}

	$effect(() => on_window_key('keydown', pressKey))
</script>

<!-- an NSSearchField as the find field is: its magnifier inside its left edge, before the text -->
<div class="help-search-box" testid="help-search-box">
	<svg
		class="help-search-glyph"
		testid="help-search-magnifier"
		source={magnifierGlyph(theme().palette.muted)}
	></svg>
	<input
		class="help-search"
		testid="help-search"
		autofocus
		placeholder="Search"
		value={query}
		theme={theme().chromeTextTheme}
		onchange={(event) => (query = event.value ?? '')}
		onsubmit={() => run(matches[selected])}
	/>
</div>
<!-- keyed by place: two Open Recent files may share a name, and the list is rebuilt per query -->
{#each matches as hit, index (index)}
	<div
		class={[
			'help-result',
			!hit.enabled && 'help-result-disabled',
			index === selected && 'help-result-selected'
		]}
		testid={`help-result-${index}`}
		role="menuitem"
		tabindex={-1}
		hitbox="self"
		onmouseenter={() => {
			if (hit.enabled) selected = index
		}}
		onclick={() => run(hit)}
	>
		<text class="help-result-title" testid={`help-result-title-${index}`}
			>{[...hit.path, hit.item.title].join(' ▸ ')}</text
		>
		{#if hit.item.keys !== ''}
			<text
				class={!hit.enabled
					? 'help-result-keys-disabled'
					: index === selected
						? 'help-result-keys-selected'
						: 'help-result-keys'}
				testid={`help-result-keys-${index}`}>{hit.item.keys}</text
			>
		{/if}
	</div>
{/each}

<style>
	/* the field's bezel, around its magnifier and its text; the find field's glyph size and gap */
	.help-search-box {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: var(--size-find-glyph-gap);
		width: 260px;
		margin-bottom: 4px;
		padding: 2px var(--size-find-glyph-gap);
		border-width: 1px;
		border-color: var(--border);
		border-radius: 5px;
		background-color: var(--background);
	}
	/* NSSearchField's secondary colour; GPUI paints an svg in its element's `color` */
	.help-search-glyph {
		flex-shrink: 0;
		width: var(--size-find-glyph);
		height: var(--size-find-glyph);
		color: var(--muted);
	}
	.help-search {
		flex-grow: 1;
		min-width: 0;
	}
	.help-result {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 24px;
		height: 22px;
		padding: 0 10px;
		border-radius: 4px;
		cursor: default;
	}
	.help-result-disabled {
		color: var(--faint);
	}
	.help-result-selected {
		background-color: var(--accent);
		color: var(--background);
	}
	.help-result-title {
		flex-grow: 1;
	}
	.help-result-keys {
		flex-shrink: 0;
		color: var(--muted);
	}
	.help-result-keys-disabled {
		flex-shrink: 0;
		color: var(--faint);
	}
	.help-result-keys-selected {
		flex-shrink: 0;
		color: var(--background);
	}
</style>
