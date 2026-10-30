<!--
  @component
  A paragraph mixing text and images, which editmd paints inline. Each text run goes through native <markdown> with
  the Document's definitions as context and its footnote references as superscript, each image through ImageView. Native
  <markdown> takes the whole width it is given and has no content-sized mode, so a run cannot flow beside an image
  in a wrapping row: when the images lead, they keep their own width in one row and the text takes the rest of the
  line, and a run that needs more than one line there turns the paragraph back into a column of its parts, image
  above text. A click anywhere opens the whole paragraph, as the Block's own click does.
-->
<script lang="ts">
	import type { GpuixEvent } from 'gpuix-svelte'
	import { emptyLinkThemeFor, inlineHtmlThemeFor, linkThemeFor } from '../../../app/palette.ts'
	import { useCommandHeld, useQuoteColour, useTheme } from '../../../app/theme.svelte.ts'
	import type { Image } from '../../../engine/blocks.ts'
	import { documentController } from '../controller.svelte.ts'
	import type { BlockViewProps } from '../DocumentView.model.ts'
	import ImageView from './ImageView.svelte'

	let { block, testKey }: BlockViewProps = $props()

	const theme = useTheme()
	const commandHeld = useCommandHeld()
	const quoteColour = useQuoteColour()

	/** what one part paints: a text run's markdown source, or an image with its test id suffix */
	type Part =
		| { kind: 'text'; start: number; end: number; source: string }
		| { kind: 'image'; start: number; image: Image; testIdSuffix: string }

	/**
	 * the paragraph's parts by Document offset; a text run is trimmed, so the spaces around an image paint nothing,
	 * and a blank run or a lone hard break between two images is dropped. images count from 0 in the paragraph, as
	 * ImageBlock's do
	 */
	const parts = $derived.by(() => {
		let images = 0
		return (block.segments ?? []).flatMap((segment): Part[] => {
			if (segment.kind === 'image') {
				const { src, alt, href } = segment
				return [
					{
						kind: 'image',
						start: segment.start,
						image: { src, alt, href },
						testIdSuffix: `${testKey}-${images++}`
					}
				]
			}
			/**
			 * a hard break beside an image (`\` or two spaces before the newline) only ends the line, which the parts'
			 * column already does: on its own, a run's own would paint as a lone `\`
			 */
			const run = documentController
				.paintedSliceOf(block, segment.start, segment.end)
				.replace(/^[ \t]*\\\n/, '')
				.replace(/\\\n[ \t]*$/, '')
				.trim()
			if (run === '') return []
			return [
				{
					kind: 'text',
					start: segment.start,
					end: segment.end,
					source: documentController.renderSource(run)
				}
			]
		})
	})

	/**
	 * the theme a text run from `start` to `end` paints in: a link's underline in the accent at 35%, the accent while ⌘
	 * is held (`linkThemeFor`), a run holding a link with no text its source as editmd does, in the accent with
	 * no fill (`emptyLinkThemeFor`), and one holding an inline HTML tag its source in the muted colour with no fill
	 * (`inlineHtmlThemeFor`), as MarkdownBlock paints a Block's
	 */
	function themeOf(start: number, end: number) {
		const text = quoteColour(theme().textTheme)
		const base = block.links ? linkThemeFor(text, commandHeld()) : text
		const within = (span: { start: number; end: number }) => span.start >= start && span.end <= end
		const holdsEmptyLink = block.emptyLinks?.some(within)
		const holdsHtml = block.inlineHtml?.some(within)
		if (!holdsEmptyLink && !holdsHtml) return base
		const hasCode = documentController.text.slice(start, end).includes('`')
		const html = holdsHtml ? inlineHtmlThemeFor(base, hasCode) : base
		return holdsEmptyLink ? emptyLinkThemeFor(html, hasCode) : html
	}

	/** what the paragraph paints, so a run measured too long for one line counts only until it changes */
	const paintedKey = $derived(
		parts.map((part) => (part.kind === 'text' ? part.source : part.image.src)).join('\u0000')
	)

	/**
	 * the paragraph whose text runs were measured taller than one line beside its images; kept for that paragraph
	 * only, since in the column the same run may fit one line again, which would flip the layout back and forth
	 */
	let multilineKey = $state<string | null>(null)

	/** the images lead and no text comes before one: a text run before an image would push it to the line's end */
	const imagesLead = $derived(
		parts.findIndex((part) => part.kind === 'text') >
			parts.findLastIndex((part) => part.kind === 'image')
	)

	/** one row of images, then the text in the rest of the line, as editmd's inline images read */
	const inline = $derived(imagesLead && multilineKey !== paintedKey)

	/** a text run in the row, by its layout event: taller than one and a half lines, it wrapped */
	function measureRun(event: GpuixEvent) {
		const lineHeight = theme().textTheme.metrics?.mdLineHeight ?? 0
		if (event.height !== undefined && lineHeight > 0 && event.height > lineHeight * 1.5)
			multilineKey = paintedKey
	}

	/** the paragraph's width as its layout event last reported it, the column its images fit; null until painted */
	let columnWidth = $state<number | null>(null)
</script>

<div
	class={['paragraph', inline ? 'inline' : 'stacked']}
	onlayout={(event) => (columnWidth = event.width ?? null)}
>
	{#each parts as part, partIndex (part.start)}
		{#if part.kind === 'image'}
			<ImageView image={part.image} testIdSuffix={part.testIdSuffix} {columnWidth} {inline} />
		{:else}
			<!-- a <markdown> reports no layout, so a div around it does -->
			<div class={['text', inline && 'run']} onlayout={inline ? measureRun : null}>
				<markdown
					testid={`text-run-${testKey}-${partIndex}`}
					source={part.source}
					theme={themeOf(part.start, part.end)}
					onlinkclick={(event) => documentController.linkClicked(event.value)}
				></markdown>
			</div>
		{/if}
	{/each}
</div>

<style>
	.paragraph {
		display: flex;
	}
	/*
	 * the bottoms meet: the one line of text at the row's foot, and each image standing on its baseline (ImageView
	 * `inline`), as WebKit sets an inline `<img>`'s bottom on the line's baseline; a taller image makes the line taller
	 */
	.inline {
		flex-direction: row;
		align-items: flex-end;
		gap: var(--size-inline-gap);
	}
	.stacked {
		flex-direction: column;
		gap: var(--size-images-gap);
	}
	.text {
		display: flex;
		flex-direction: column;
	}
	/* the text takes the rest of the line after the images */
	.run {
		flex-grow: 1;
		flex-shrink: 1;
		flex-basis: 0;
		min-width: 0;
	}
</style>
