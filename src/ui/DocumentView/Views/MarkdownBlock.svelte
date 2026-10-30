<!--
  @component
  A Block painted by GPUI's native <markdown>, with the Document's definitions as context. An h1 or h2 gets editmd's
  bottom rule under it, which native <markdown> has no theme token for; an h5 or h6 its own size.
-->
<script lang="ts">
	import {
		emptyLinkThemeFor,
		headingThemeFor,
		heldLinkThemeFor,
		inlineHtmlThemeFor,
		linkThemeFor
	} from '../../../app/palette.ts'
	import { useCommandHeld, useQuoteColour, useTheme } from '../../../app/theme.svelte.ts'
	import { documentController } from '../controller.svelte.ts'
	import type { BlockViewProps } from '../DocumentView.model.ts'

	let { block, testKey }: BlockViewProps = $props()

	const theme = useTheme()
	const commandHeld = useCommandHeld()
	const quoteColour = useQuoteColour()

	const level = $derived(block.kind === 'heading' ? (block.heading?.level ?? null) : null)

	/** editmd rules off h1 and h2 only (style.css:152-163) */
	const ruleLevel = $derived(level !== null && level <= 2 ? level : null)

	/**
	 * an h5 or h6 paints at its own size, an h6 muted, where native <markdown> has one tier for h4-h6; inside a quote
	 * every other Block takes the quote's muted colour too, which muting an h6 again would turn faint. a Block with a
	 * link with no text paints its source as editmd does, in the accent with no fill (`emptyLinkThemeFor`), and one
	 * with an inline HTML tag its source in the muted colour with no fill (`inlineHtmlThemeFor`, editmd style.css:346-349)
	 */
	const sourceTheme = $derived.by(() => {
		const base =
			level === null
				? quoteColour(theme().textTheme)
				: level === 6
					? headingThemeFor(theme().textTheme, level, theme().zoom)
					: headingThemeFor(quoteColour(theme().textTheme), level, theme().zoom)
		if (!block.emptyLinks && !block.inlineHtml) return base
		const hasCode = documentController.sliceOf(block).includes('`')
		const html = block.inlineHtml ? inlineHtmlThemeFor(base, hasCode) : base
		return block.emptyLinks ? emptyLinkThemeFor(html, hasCode) : html
	})

	/**
	 * native draws a strike and a link's underline in `textMuted`: a Block without links strikes in its text colour,
	 * editmd's `currentColor` (style.css has no `del` rule); one with a link underlines it in the accent at 35%, the
	 * accent while ⌘ is held (`linkThemeFor`, style.css:170-181), and strikes in that colour too
	 */
	const blockTheme = $derived(
		block.links ? linkThemeFor(sourceTheme, commandHeld()) : heldLinkThemeFor(sourceTheme)
	)
</script>

{#snippet text()}
	<markdown
		testid={`markdown-${testKey}`}
		source={documentController.renderSourceOf(block)}
		theme={blockTheme}
		onlinkclick={(event) => documentController.linkClicked(event.value)}
	></markdown>
{/snippet}

{#if block.footnoteReferences && block.kind === 'paragraph'}
	<!-- a footnote reference's `sup` makes its line taller than the body's, so the text sits lower -->
	<div class="sup-line" testid={`sup-line-${testKey}`}>
		{@render text()}
	</div>
{:else if ruleLevel}
	<!-- `padding-bottom: 0.25em` (h1) or `0.2em` (h2), then `border-bottom: 1px solid var(--border)` -->
	<div class={['rule', ruleLevel === 1 ? 'rule-1' : 'rule-2']} testid={`heading-rule-${testKey}`}>
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
