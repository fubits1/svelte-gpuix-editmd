<!--
  @component
  A footnote definition as editmd shows it (`dl[data-type="footnote_definition"]`): the label in bold, and under
  it the content through native <markdown>, muted, both under a rule.
-->
<script module lang="ts">
	import type { GpuixTheme } from 'gpuix-svelte'
	import { mutedThemeFor } from '../../../app/palette.ts'

	/** editmd sets a definition at `font-size: 0.9em` */
	const FOOTNOTE_SCALE = 0.9

	/** float noise from the scaling would make theme values like 23.760000000000002; unset stays unset */
	const scaled = (size: number | undefined) =>
		size === undefined ? undefined : Math.round(size * FOOTNOTE_SCALE * 1000) / 1000

	/**
	 * editmd's definition text is muted at 0.9 of the body size; native <markdown> ignores CSS, so both go in
	 * through its theme: the text colour, and its inline code's, becomes the muted one (`mutedThemeFor`), body size and
	 * line height scale by 0.9
	 */
	function footnoteThemeOf(textTheme: GpuixTheme): GpuixTheme {
		const { metrics = {} } = textTheme
		return {
			...mutedThemeFor(textTheme),
			metrics: {
				...metrics,
				mdTextSize: scaled(metrics.mdTextSize),
				mdLineHeight: scaled(metrics.mdLineHeight)
			}
		}
	}
</script>

<script lang="ts">
	import { heldLinkThemeFor } from '../../../app/palette.ts'
	import { useCommandHeld, useTheme } from '../../../app/theme.svelte.ts'
	import { footnoteContent } from '../../../core/footnotes.ts'
	import { documentController } from '../controller.svelte.ts'
	import type { BlockViewProps } from '../DocumentView.model.ts'

	let { block, index }: BlockViewProps = $props()

	const theme = useTheme()
	const commandHeld = useCommandHeld()

	/**
	 * follows the live text theme, so a footnote changes appearance and zoom with the blocks around it; while ⌘ is held a
	 * link's underline takes its own colour
	 */
	const footnoteTheme = $derived.by(() => {
		const muted = footnoteThemeOf(theme().textTheme)
		return commandHeld() && block.links ? heldLinkThemeFor(muted) : muted
	})

	/**
	 * the content after `[^label]:` with its references as link runs, dedented so continuation lines are markdown of
	 * their own; parseBlocks gives every footnote definition a `footnote`, so the Block start is only a fallback
	 */
	const source = $derived(
		documentController.renderSource(
			footnoteContent(
				documentController.paintedSliceOf(block, block.footnote?.contentStart ?? block.start)
			)
		)
	)
</script>

<div class="footnote" testid={`footnote-box-${index}`}>
	<text class="label" testid={`footnote-label-${index}`}>{block.footnote?.label ?? ''}</text>
	<div class="content">
		<markdown
			testid={`footnote-${index}`}
			{source}
			theme={footnoteTheme}
			onlinkclick={(event) => documentController.linkClicked(event.value)}
		></markdown>
	</div>
</div>

<style>
	/* editmd's `dl`: `border-top: 1px solid var(--border); padding-top: 0.5em`, its `dt` above its `dd` */
	.footnote {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		padding-top: var(--size-footnote-inset);
		border-top-width: 1px;
		border-color: var(--border);
	}
	/* editmd's `dt { font-weight: 600 }`, at the content's 0.9 of the 16px body */
	.label {
		font-size: var(--size-footnote-label);
		font-weight: 600;
		color: var(--muted);
	}
	/* `dd { margin: 0 }`: the content spans the column under its label */
	.content {
		align-self: stretch;
	}
</style>
