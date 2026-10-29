<!--
  @component
  The window: the open Document in a scrolling column, with the save-status label, and the menu bar and the find bar
  above it.
-->
<script lang="ts">
	import Scroller from 'gpuix-svelte/components/Scroller.svelte'
	import Tooltip from 'gpuix-svelte/components/Tooltip.svelte'
	import { findController } from './src/app/find.svelte.ts'
	import { provideTheme, type ThemeController, themeController } from './src/app/theme.svelte.ts'
	import DocumentView from './src/ui/DocumentView.svelte'
	import FindBar from './src/ui/FindBar.svelte'
	import MenuBar from './src/ui/MenuBar.svelte'
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
</script>

<!-- the label itself is the Tooltip's trigger; it has no listener of its own, so the Tooltip's wrapper takes the hover -->
{#snippet statusLabel()}
	<text
		class={['status', documentController.statusFailed && 'status-failed']}
		testid="save-status"
		motion={statusMotion}>{documentController.statusText}</text
	>
{/snippet}

<div class="window" testid="window">
	<!-- editmd's menu bar, which gpuix's native bar cannot hold (gap G2), across the top above the find bar -->
	<MenuBar />
	<!-- editmd stacks its find bar above the web view, so the document moves down while the bar shows -->
	{#if findController.visible}
		<FindBar />
	{/if}
	<!-- the label sits in the page's corner, below the find bar, as editmd's sits in the title bar beside it -->
	<div class="page">
		<!--
		  Source mode's field grows to its whole text, as editmd's `field-sizing: content`, so the column scrolls it as it
		  scrolls the Blocks; its testid names the thumb `page-scroller-thumb` too
		-->
		<Scroller testid="page-scroller">
			<div class="scrolled">
				<DocumentView />
			</div>
		</Scroller>
		<!-- its text stays while it fades out, so it goes once the fade is over; a failed save's reason is its tooltip -->
		{#if documentController.statusText}
			<div class="status-corner">
				<Tooltip
					content={documentController.statusDetail ?? ''}
					open={documentController.statusDetail === null ? false : null}
					side="bottom"
					align="end"
					testid="save-status-tooltip"
					children={statusLabel}
				/>
			</div>
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
	/* editmd's `NSFont.smallSystemFontSize` in `secondaryLabelColor`, window chrome that never zooms */
	.status {
		font-size: var(--size-status-text);
		color: var(--muted);
	}
	/* editmd paints Not Saved in `systemRed` */
	.status-failed {
		color: var(--danger);
	}
</style>
