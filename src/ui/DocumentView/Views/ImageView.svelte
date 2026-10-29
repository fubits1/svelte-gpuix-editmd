<!--
  @component
  One image of a paragraph, as `<img>`, since native <markdown> paints images as link text. A local image paints at
  its natural size, scaled down to fit the column; one of unknown size gets a fixed box. A remote image shows its alt
  text until View > Load Remote Images allows it. A local image whose file is missing shows its alt text the same way,
  as WebKit paints a broken image small, instead of GPUI's load error atop the fixed box. ImageBlock and MixedParagraphBlock paint each of their images here.
-->
<script lang="ts">
	import { get_native, type ShadowNode } from 'gpuix-svelte'
	import Tooltip from 'gpuix-svelte/components/Tooltip.svelte'
	import { useTheme } from '../../../app/theme.svelte.ts'
	import type { Image } from '../../../engine/blocks.ts'
	import { fitToWidth, type Size } from '../../../core/imageSize.ts'
	import { resolveImageSource } from '../../../core/imageSource.ts'
	import { documentController } from '../controller.svelte.ts'
	import { dropFiles } from '../fileDrop.ts'

	let {
		image,
		testIdSuffix
	}: {
		image: Image
		/**
		 * `<block index>-<image index in the paragraph>`, after `image-` or `image-blocked-` in the test ids, or
		 * `image-missing-` for a local image with no file
		 */
		testIdSuffix: string
	} = $props()

	const theme = useTheme()

	/** the image's column width as last painted, null until the first paint */
	let columnWidth = $state<number | null>(null)

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
	 * GPUI's <img> needs explicit dimensions and has no aspect-ratio style, so the scaled height comes from the
	 * measured column; before the first paint the natural size is capped at the column width instead
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

	/** the blocked image's box as last painted, null until its first paint: its dashed border is drawn to that size */
	let remoteSize = $state<{ width: number; height: number } | null>(null)

	/**
	 * editmd's `.remote-image { border: 1px dashed var(--border); border-radius: 4px }` (style.css:297-306): gpuix has
	 * no border style (remorses/gpuix#60), so an svg rect of the box's size strokes it, its dashes as WebKit draws a
	 * 1px dashed border, 3px long and 3px apart (measured in editmd's screenshot). GPUI paints an svg as a mask
	 * in its element's `color`, so the stroke's own colour does not matter
	 */
	function dashedBox(width: number, height: number): string {
		const radius = theme().scaled(4)
		return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${radius}" fill="none" stroke="black" stroke-width="1" stroke-dasharray="3 3"/></svg>`
	}

	/** the blocked image's box, re-measured on a timer as `measureColumn` measures the column */
	function measureRemote(box: ShadowNode) {
		const measure = () => {
			if (box.nativeId === null) return
			const painted = get_native()?.getElementBounds(box.nativeId)
			if (!painted) return
			const { width, height } = painted
			if (width !== remoteSize?.width || height !== remoteSize?.height)
				remoteSize = { width, height }
		}
		measure()
		const timer = setInterval(measure, 250)
		return () => clearInterval(timer)
	}

	/**
	 * GPUI sends no resize event, so the column is re-measured on a timer from its painted bounds, as gpuix's
	 * Scroller measures its viewport. the column is the frame's container, which spans it: the frame itself is as wide
	 * as its image in a row of images, which would hold a zoomed image to its old width
	 */
	function measureColumn(frame: ShadowNode) {
		const column = frame.parent ?? frame
		const measure = () => {
			if (column.nativeId === null) return
			const width = get_native()?.getElementBounds(column.nativeId)?.width
			// an unchanged number is no change to $state, so the steady poll restyles nothing
			if (width !== undefined) columnWidth = width
		}
		measure()
		const timer = setInterval(measure, 250)
		return () => clearInterval(timer)
	}
</script>

<!-- the frame spans the column, so its painted width is the width an image scales down to -->
<!-- an image of unknown size keeps the fixed box across the column, in a row of images too -->
<div
	class={[
		'frame',
		naturalSize === null &&
			!fileMissing &&
			(source.kind === 'local' || documentController.remoteImagesAllowed) &&
			'fill'
	]}
	{@attach naturalSize !== null && measureColumn}
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
			<div class="remote-frame" {@attach measureRemote}>
				<div class="remote" testid={`remote-image-${testIdSuffix}`}>
					<svg class="remote-icon" source={pictureIcon(theme().palette.muted)}></svg>
					<text
						class="remote-alt"
						testid={`image-blocked-${testIdSuffix}`}
						aria-description={image.src}>{image.alt}</text
					>
				</div>
				{#if remoteSize}
					<svg
						class="remote-border"
						testid={`remote-image-border-${testIdSuffix}`}
						style:width={`${remoteSize.width}px`}
						style:height={`${remoteSize.height}px`}
						source={dashedBox(remoteSize.width, remoteSize.height)}
					></svg>
				{/if}
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

	/* the blocked image's box with no border or padding of its own, so its painted bounds are its border's outer edge */
	.remote-frame {
		display: flex;
		align-self: flex-start;
	}

	/*
	 * editmd's `.remote-image` (style.css:297-306); its dashed border is `.remote-border`, so its own 1px border only
	 * keeps the room and paints nothing
	 */
	.remote {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: var(--size-remote-image-gap);
		padding-top: var(--size-remote-image-padding-y);
		padding-bottom: var(--size-remote-image-padding-y);
		padding-left: var(--size-remote-image-padding-x);
		padding-right: var(--size-remote-image-padding-x);
		border-width: 1px;
		border-color: #00000000;
		border-radius: var(--size-image-radius);
	}

	/* the dashed border over the box, in the border colour */
	.remote-border {
		position: absolute;
		left: 0;
		top: 0;
		color: var(--border);
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
