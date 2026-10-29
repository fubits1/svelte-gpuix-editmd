<!--
  @component
  A paragraph mixing text and images, which editmd paints inline. Each text run goes through native <markdown> with
  the Document's definitions as context and its footnote references as links, each image through ImageView. Native
  <markdown> takes the whole width it is given and has no content-sized mode, so a run cannot flow beside an image
  in a wrapping row: when the images lead, they keep their own width in one row and the text takes the rest of the
  line, and a run that needs more than one line there turns the paragraph back into a column of its parts, image
  above text. A click anywhere opens the whole paragraph, as the Block's own click does.
-->
<script lang="ts">
	import { get_native, type ShadowNode } from 'gpuix-svelte'
	import { emptyLinkThemeFor, heldLinkThemeFor } from '../../../app/palette.ts'
	import { useCommandHeld, useTheme } from '../../../app/theme.svelte.ts'
	import type { Image } from '../../../engine/blocks.ts'
	import { documentController } from '../controller.svelte.ts'
	import type { BlockViewProps } from '../DocumentView.model.ts'
	import ImageView from './ImageView.svelte'

	let { block, index }: BlockViewProps = $props()

	const theme = useTheme()
	const commandHeld = useCommandHeld()

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
						testIdSuffix: `${index}-${images++}`
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
	 * the theme a text run from `start` to `end` paints in: while ⌘ is held a link's underline takes its own colour
	 * (`heldLinkThemeFor`), and a run holding a link with no text paints its source as editmd does, in the accent with
	 * no fill (`emptyLinkThemeFor`), as MarkdownBlock paints a Block's
	 */
	function themeOf(start: number, end: number) {
		const base =
			commandHeld() && block.links ? heldLinkThemeFor(theme().textTheme) : theme().textTheme
		const holdsEmptyLink = block.emptyLinks?.some((link) => link.start >= start && link.end <= end)
		if (!holdsEmptyLink) return base
		return emptyLinkThemeFor(base, documentController.text.slice(start, end).includes('`'))
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

	/**
	 * GPUI sends no layout event, so a text run in the row is measured on a timer from its painted bounds, as
	 * ImageView measures its column: taller than one and a half lines, it wrapped
	 */
	function measureRun(run: ShadowNode) {
		const measure = () => {
			if (run.nativeId === null) return
			const height = get_native()?.getElementBounds(run.nativeId)?.height
			const lineHeight = theme().textTheme.metrics?.mdLineHeight ?? 0
			if (height !== undefined && lineHeight > 0 && height > lineHeight * 1.5)
				multilineKey = paintedKey
		}
		measure()
		const timer = setInterval(measure, 250)
		return () => clearInterval(timer)
	}
</script>

<div class={['paragraph', inline ? 'inline' : 'stacked']}>
	{#each parts as part, partIndex (part.start)}
		{#if part.kind === 'image'}
			<ImageView image={part.image} testIdSuffix={part.testIdSuffix} />
		{:else}
			<markdown
				class={inline ? 'run' : null}
				testid={`text-run-${index}-${partIndex}`}
				source={part.source}
				theme={themeOf(part.start, part.end)}
				onlinkclick={(event) => documentController.linkClicked(event.value)}
				{@attach inline && measureRun}
			></markdown>
		{/if}
	{/each}
</div>

<style>
	.paragraph {
		display: flex;
	}
	.inline {
		flex-direction: row;
		align-items: center;
		gap: var(--size-inline-gap);
	}
	.stacked {
		flex-direction: column;
		gap: var(--size-images-gap);
	}
	/* the text takes the rest of the line after the images */
	.run {
		flex-grow: 1;
		flex-shrink: 1;
		flex-basis: 0;
		min-width: 0;
	}
</style>
