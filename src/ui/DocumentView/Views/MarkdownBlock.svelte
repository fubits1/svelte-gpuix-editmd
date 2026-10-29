<!--
  @component
  A Block painted by GPUI's native <markdown>, with the Document's definitions as context. An h1 or h2 gets editmd's
  bottom rule under it, which native <markdown> has no theme token for; an h5 or h6 its own size.
-->
<script lang="ts">
	import { emptyLinkThemeFor, headingThemeFor, heldLinkThemeFor } from '../../../app/palette.ts'
	import { useCommandHeld, useTheme } from '../../../app/theme.svelte.ts'
	import { documentController } from '../controller.svelte.ts'
	import type { BlockViewProps } from '../DocumentView.model.ts'

	let { block, index }: BlockViewProps = $props()

	const theme = useTheme()
	const commandHeld = useCommandHeld()

	const level = $derived(block.kind === 'heading' ? (block.heading?.level ?? null) : null)

	/** editmd rules off h1 and h2 only (style.css:152-163) */
	const ruleLevel = $derived(level !== null && level <= 2 ? level : null)

	/**
	 * an h5 or h6 paints at its own size, an h6 muted, where native <markdown> has one tier for h4-h6; a Block with a
	 * link with no text paints its source as editmd does, in the accent with no fill (`emptyLinkThemeFor`); while ⌘ is
	 * held a link's underline takes its own colour (`heldLinkThemeFor`)
	 */
	const blockTheme = $derived.by(() => {
		const base =
			level === null ? theme().textTheme : headingThemeFor(theme().textTheme, level, theme().zoom)
		const linked = commandHeld() && block.links ? heldLinkThemeFor(base) : base
		if (!block.emptyLinks) return linked
		return emptyLinkThemeFor(linked, documentController.sliceOf(block).includes('`'))
	})
</script>

{#snippet text()}
	<markdown
		source={documentController.renderSourceOf(block)}
		theme={blockTheme}
		onlinkclick={(event) => documentController.linkClicked(event.value)}
	></markdown>
{/snippet}

{#if block.footnoteReferences && block.kind === 'paragraph'}
	<!-- a footnote reference's `sup` makes its line taller than the body's, so the text sits lower -->
	<div class="sup-line" testid={`sup-line-${index}`}>
		{@render text()}
	</div>
{:else if ruleLevel}
	<!-- `padding-bottom: 0.25em` (h1) or `0.2em` (h2), then `border-bottom: 1px solid var(--border)` -->
	<div class={['rule', ruleLevel === 1 ? 'rule-1' : 'rule-2']} testid={`heading-rule-${index}`}>
		{@render text()}
	</div>
{:else}
	{@render text()}
{/if}

<style>
	.sup-line {
		padding-top: var(--size-footnote-sup-rise);
	}
	.rule {
		border-bottom-width: 1px;
		border-color: var(--border);
	}
	.rule-1 {
		padding-bottom: var(--size-heading-1-rule-padding);
	}
	.rule-2 {
		padding-bottom: var(--size-heading-2-rule-padding);
	}
</style>
