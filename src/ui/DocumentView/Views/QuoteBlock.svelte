<!--
  @component
  A blockquote as editmd paints it (`blockquote { padding: 0 1em; color: var(--muted); border-left: 0.25em solid
  var(--border) }`): a rail in the border colour, no fill, and the quote's markdown without its `>` markers through
  native <markdown> in the muted colour. Native's own quote paints a rail and a wash in its theme's accent.
-->
<script lang="ts">
	import { heldLinkThemeFor, mutedThemeFor } from '../../../app/palette.ts'
	import { useCommandHeld, useTheme } from '../../../app/theme.svelte.ts'
	import { unquoted } from '../../../core/paintedSlice.ts'
	import { documentController } from '../controller.svelte.ts'
	import type { BlockViewProps } from '../DocumentView.model.ts'

	let { block, index }: BlockViewProps = $props()

	const theme = useTheme()
	const commandHeld = useCommandHeld()

	/**
	 * native <markdown> ignores CSS, so editmd's muted quote text, its inline code too, goes in through its theme
	 * (`mutedThemeFor`); while ⌘ is held a link's underline takes its own colour (`heldLinkThemeFor`)
	 */
	const quoteTheme = $derived.by(() => {
		const muted = mutedThemeFor(theme().textTheme)
		return commandHeld() && block.links ? heldLinkThemeFor(muted) : muted
	})
</script>

<div class="quote" testid={`quote-${index}`}>
	<markdown
		testid={`quote-text-${index}`}
		source={documentController.renderSource(unquoted(documentController.paintedSliceOf(block)))}
		theme={quoteTheme}
		onlinkclick={(event) => documentController.linkClicked(event.value)}
	></markdown>
</div>

<style>
	.quote {
		border-left-width: var(--size-quote-rail);
		border-color: var(--border);
		padding-left: var(--size-quote-padding);
		padding-right: var(--size-quote-padding);
	}
</style>
