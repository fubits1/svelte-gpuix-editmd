<!--
  @component
  The window: the open Document in a scrolling column, with the save-status label and the command palette's hint, and
  the menu bar and the find bar above it.
-->
<script lang="ts">
	import Scroller from 'gpuix-svelte/components/Scroller.svelte'
	import { findController } from './src/app/find.svelte.ts'
	import { keysOf } from './src/app/menu.ts'
	import { provideTheme, type ThemeController, themeController } from './src/app/theme.svelte.ts'
	import DocumentView from './src/ui/DocumentView.svelte'
	import FindBar from './src/ui/FindBar.svelte'
	import MenuBar from './src/ui/MenuBar.svelte'
	import PointerTip from './src/ui/PointerTip.svelte'
	import { documentController } from './src/ui/DocumentView/controller.svelte.ts'

	let {
		theme = themeController
	}: {
		/** the appearance and zoom every view paints in; the process's own by default */
		theme?: ThemeController
	} = $props()

	provideTheme(() => theme)

	// the root owns the poll's lifetime: it runs while the window shows a Document and stops on unmount
	$effect(() => theme.start())

	/**
	 * editmd's SaveStatusView fades its alpha (EditorWindowController.swift:362-365): in over 0.15s while a label
	 * shows, out over 0.4s once it goes, from 0 when it first appears; GPUI animates opacity natively through `motion`
	 */
	const statusMotion = $derived({
		initial: { opacity: 0 },
		animate: { opacity: documentController.statusShown ? 1 : 0 },
		transition: { duration: documentController.statusShown ? 0.15 : 0.4 }
	})

	const paletteHint = `${keysOf('commandPalette')} Commands`
</script>

<div class="window" testid="window">
	<!-- editmd's menu bar, which gpuix's native bar cannot hold (gap G2), across the top above the find bar -->
	<MenuBar />
	<!-- editmd stacks its find bar above the web view, so the document moves down while the bar shows -->
	{#if findController.visible}
		<FindBar />
	{/if}
	<!-- A wheel over the page shows an overlay scroller's thumb for a while (`ThemeController.pageScrolled`). -->
	<div class="page" onscroll={() => theme.pageScrolled()}>
		<!--
		  Source mode's field grows to its whole text, as editmd's `field-sizing: content`, so the column scrolls it as it
		  scrolls the Blocks; its testid names the thumb `page-scroller-thumb` too
		-->
		<Scroller testid="page-scroller">
			<div class="scrolled">
				<DocumentView />
			</div>
		</Scroller>
		<!--
		  The palette's key sits in the middle of the bottom edge, as the save status floats in the top right corner. The
		  strip lets clicks through to the page; the label alone takes them. It has no tab stop, so a click opens the
		  palette as ⌘K does and leaves the keys with the open field.
		-->
		<div class="palette-hint-strip">
			<div
				class="palette-hint"
				role="button"
				hitbox="self"
				onclick={() => documentController.run('commandPalette')}
			>
				<text class="status" testid="palette-hint">{paletteHint}</text>
			</div>
		</div>
		<!--
		  The label sits in the page's corner, below the find bar, as editmd's sits in the title bar beside it. Its text
		  stays while it fades out, so it goes once the fade is over. A failed save's reason is the label's native tip at
		  the pointer (EditorWindowController.swift:360), which the corner box hears for the label.
		-->
		{#if documentController.statusText}
			<PointerTip text={documentController.statusDetail} testid="save-status-tooltip">
				{#snippet children(pointer)}
					<div class="status-corner" hitbox="self" {...pointer}>
						<text
							class={['status', documentController.statusFailed && 'status-failed']}
							testid="save-status"
							motion={statusMotion}>{documentController.statusText}</text
						>
					</div>
				{/snippet}
			</PointerTip>
		{/if}
	</div>
</div>

<style>
	/*
	 * `selection-color` washes the painted text's selections below it (GPUI's `selectionColor`, inherited, else its
	 * accent at 35%): editmd's `::selection { background: var(--selection) }`, the accent at 22% (style.css:12, 60-62).
	 * a <textarea> takes it neither from here nor set on itself (measured: its selection stays at the 35% wash)
	 */
	.window {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		background-color: var(--background);
		color: var(--text);
		selection-color: var(--selection);
	}
	.page {
		display: flex;
		flex-direction: column;
		flex-grow: 1;
		min-height: 0;
	}
	/*
	 * gpuix's Scroller pads its column 12px on the right for its thumb, which editmd's overlay scroller paints over
	 * the page instead, so the page reaches back over that gutter and centres its column on the whole window
	 */
	.scrolled {
		display: flex;
		flex-direction: column;
		margin-right: -12px;
	}
	/* editmd's SaveStatusView ends its label 10px from its right edge (EditorWindowController.swift:345) */
	.status-corner {
		position: absolute;
		top: 8px;
		right: 10px;
	}
	/* across the bottom, 8px up as the save status sits 8px down; gpuix drops `left: 50%` and ignores `transform` */
	.palette-hint-strip {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 8px;
		display: flex;
		justify-content: center;
		pointer-events: none;
	}
	.palette-hint {
		pointer-events: auto;
		cursor: default;
	}
	/*
	 * editmd's `NSFont.smallSystemFontSize` in `secondaryLabelColor`, window chrome that never zooms
	 * (EditorWindowController.swift:340, 358)
	 */
	.status {
		font-size: var(--size-status-text);
		color: var(--secondary-label);
	}
	/* editmd paints Not Saved in `systemRed` (EditorWindowController.swift:358) */
	.status-failed {
		color: var(--system-red);
	}
</style>
