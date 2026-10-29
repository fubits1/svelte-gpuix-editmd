<!--
  @component
  The page alone, for the headless modes: `--snapshot` pictures it (editmd Headless.swift:116-135) and `--selftest`
  edits through it (SelfTest.swift). The open Document's Blocks on the window's background, in a column that scrolls
  without a thumb, so each screenshot holds only the page, with no menu bar, find bar or save-status label; a freshly
  loaded file has no Agent, so no legend either. `--snapshot` mounts it with `autofocus={false}`, so an open field
  paints no caret; `--selftest` keeps the default and types into the field.
-->
<script lang="ts">
	import DocumentView from '../ui/DocumentView.svelte'
	import { provideTheme, type ThemeController } from './theme.svelte.ts'

	let {
		theme,
		autofocus = true
	}: {
		/** the appearance the picture is taken in, light or dark */
		theme: ThemeController
		/** an open field takes the keys when it mounts, as `--selftest` types into it; false paints it with no caret */
		autofocus?: boolean
	} = $props()

	provideTheme(() => theme)

	// sets the colour and size tokens before the first paint, as App's root does for a window
	$effect(() => theme.start())
</script>

<div class="page" testid="snapshot-page">
	<div class="content" testid="snapshot-content">
		<DocumentView {autofocus} />
	</div>
</div>

<style>
	/* GPUI paints no scrollbar, so the column scrolls with nothing over the page */
	.page {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		overflow-y: scroll;
		background-color: var(--background);
		color: var(--text);
	}
	.content {
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
	}
</style>
