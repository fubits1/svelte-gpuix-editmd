<!--
  @component
  One image of a paragraph, as `<img>`, since native <markdown> paints images as link text. A local image paints at
  its natural size, scaled down to fit the column; one of unknown size gets a fixed box. A remote image shows its alt
  text until View > Load Remote Images allows it. A local image whose file is missing shows its alt text the same way,
  as WebKit paints a broken image small, instead of GPUI's load error atop the fixed box. ImageBlock and MixedParagraphBlock paint each of their images here.
-->
<script lang="ts">
	import Tooltip from 'gpuix-svelte/components/Tooltip.svelte'
	import { useTheme } from '../../../app/theme.svelte.ts'
	import type { Image } from '../../../engine/blocks.ts'
	import { fitToWidth, type Size } from '../../../core/imageSize.ts'
	import { resolveImageSource } from '../../../core/imageSource.ts'
	import { documentController } from '../controller.svelte.ts'
	import { dropFiles } from '../fileDrop.ts'

	let {
		image,
		testIdSuffix,
		columnWidth,
		inline = false
	}: {
		image: Image
		/**
		 * `<block index>-<image index in the paragraph>`, after `image-` or `image-blocked-` in the test ids, or
		 * `image-missing-` for a local image with no file
		 */
		testIdSuffix: string
		/**
		 * the column's width as its paragraph's layout event last reported it, null until painted: the frame itself is
		 * as wide as its image in a row of images, which would hold a zoomed image to its old width
		 */
		columnWidth: number | null
		/**
		 * the image sits in a line of text whose row aligns its items' bottoms (MixedParagraphBlock): its bottom then
		 * stands on the line's baseline, as WebKit sets an inline `<img>`, the line's room below the baseline beneath it
		 */
		inline?: boolean
	} = $props()

	const theme = useTheme()

	/**
	 * the room below the baseline of a 16px/1.65 body line, in CSS px at actual size: GPUI sets that 26.4px line's
	 * baseline 19.5px below its top (test.ts, the image-on-the-baseline check)
	 */
	const BELOW_BASELINE = 6.9

	const source = $derived(resolveImageSource(image.src, documentController.folder))
	/**
	 * a local image's size from its file, a loaded remote one's from its bytes once they came (a `file:` URL's from the
	 * file it loads from); null while unknown
	 */
	const naturalSize = $derived.by(() => {
		if (source.kind === 'local') return documentController.imageSizeOf(source.path)
		if (!documentController.remoteImagesAllowed) return null
		return source.path === undefined
			? documentController.remoteImageSizeOf(source.url)
			: documentController.imageSizeOf(source.path)
	})
	/**
	 * a linked image's click reports its link as a <markdown> reports a link run's: the Block's click that follows
	 * decides whether it is followed (Cmd) or the Block opens (`DocumentController.clickBlock`)
	 */
	const href = $derived(image.href)
	/**
	 * a local image whose file is missing, or a remote one that failed once allowed (a 404, no answer): either paints
	 * its alt text, as WebKit paints a broken image small
	 */
	const fileMissing = $derived(
		source.kind === 'local'
			? documentController.isImageMissing(source.path)
			: documentController.remoteImagesAllowed &&
					source.path === undefined &&
					documentController.isRemoteImageFailed(source.url)
	)

	/**
	 * GPUI's <img> needs explicit dimensions, so the scaled height comes from the measured column: `aspect-ratio` gives
	 * the img its file's own shape, but its frame keeps the natural height (measured headless: a 1600x800 file at
	 * `width: 1600px; max-width: 100%` paints 656x328 in a row 800px tall). before the first paint the natural size is
	 * capped at the column width instead
	 */
	function styleOf(size: Size): string {
		// editmd's page zoom grows an image's CSS size with the page, up to the column's `max-width: 100%`
		const zoomed = {
			width: theme().scaled(size.width),
			height: theme().scaled(size.height)
		}
		if (columnWidth === null)
			return `width: ${zoomed.width}px; max-width: 100%; height: ${zoomed.height}px`
		const fitted = fitToWidth(zoomed, columnWidth)
		return `width: ${fitted.width}px; height: ${fitted.height}px`
	}

	/**
	 * editmd's picture icon for a blocked image (style.css:313, its mask's rect, circle and mountain), in `colour`:
	 * GPUI's SVG decoder drops var() and currentColor, so the colour is inlined, as the find bar's chevrons
	 */
	function pictureIcon(colour: string | undefined): string {
		const paint = colour ?? '#808080'
		return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="${paint}" stroke-width="1.3"/><circle cx="5.5" cy="6.3" r="1.3" fill="${paint}"/><path d="M2.5 12.5 6.5 8.5 9 11 11 9 13.5 12.5Z" fill="${paint}"/></svg>`
	}
</script>

<!-- an image of unknown size keeps the fixed box across the column, in a row of images too -->
<div
	class={[
		'frame',
		naturalSize === null &&
			!fileMissing &&
			(source.kind === 'local' || documentController.remoteImagesAllowed) &&
			'fill'
	]}
>
	{#if fileMissing}
		<text class="blocked" testid={`image-missing-${testIdSuffix}`}>{image.alt}</text>
	{:else if source.kind === 'local' || documentController.remoteImagesAllowed}
		<img
			class={['image', naturalSize === null && 'fixed']}
			testid={`image-${testIdSuffix}`}
			src={source.kind === 'local' ? source.path : (source.path ?? source.url)}
			alt={image.alt}
			style={naturalSize && styleOf(naturalSize)}
			style:margin-bottom={inline ? `${theme().scaled(BELOW_BASELINE)}px` : null}
			objectfit="contain"
			onclick={href === undefined ? null : () => documentController.linkClicked(href)}
			onfiledrop={href === undefined ? null : dropFiles}
		/>
	{:else}
		<!--
		  editmd's `.remote-image`: a picture icon, then the alt text, titled with the src attribute as written
		  (remote.ts:68 `title = src`), not the URL it resolves to. the box takes no clicks of its own, so it is a
		  decorative trigger and the Tooltip needs nothing more
		-->
		<Tooltip content={image.src} testid={`remote-image-tooltip-${testIdSuffix}`}>
			<div class="remote" testid={`remote-image-${testIdSuffix}`}>
				<svg class="remote-icon" source={pictureIcon(theme().palette.muted)}></svg>
				<text
					class="remote-alt"
					testid={`image-blocked-${testIdSuffix}`}
					aria-description={image.src}>{image.alt}</text
				>
			</div>
		</Tooltip>
	{/if}
</div>

<style>
	/* in a paragraph's row it keeps its own width, never more than the column's */
	.frame {
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
		max-width: 100%;
	}

	.fill {
		flex-grow: 1;
	}

	/* editmd's `img { border-radius: 4px }` */
	.image {
		flex-shrink: 0;
		border-radius: var(--size-image-radius);
	}

	.fixed {
		width: 100%;
		height: var(--size-image-fallback);
	}

	.blocked {
		color: var(--muted);
		font-size: var(--size-image-alt);
	}

	/* editmd's `.remote-image { border: 1px dashed var(--border); border-radius: 4px }` (style.css:297-306) */
	.remote {
		display: flex;
		flex-direction: row;
		align-self: flex-start;
		align-items: center;
		gap: var(--size-remote-image-gap);
		padding-top: var(--size-remote-image-padding-y);
		padding-bottom: var(--size-remote-image-padding-y);
		padding-left: var(--size-remote-image-padding-x);
		padding-right: var(--size-remote-image-padding-x);
		border-width: 1px;
		border-style: dashed;
		border-color: var(--border);
		border-radius: var(--size-image-radius);
	}

	/*
	 * `.remote-image::before`: a 1em square, its mask filled with `currentColor`, the box's muted colour; GPUI paints
	 * an svg in its element's `color`, else in its nearest ancestor's, the window's text colour
	 */
	.remote-icon {
		width: var(--size-remote-image-text);
		height: var(--size-remote-image-text);
		flex-shrink: 0;
		color: var(--muted);
	}

	.remote-alt {
		color: var(--muted);
		font-size: var(--size-remote-image-text);
	}
</style>
