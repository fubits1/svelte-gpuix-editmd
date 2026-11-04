<!--
  @component
  One image of a paragraph, as `<img>`, since native <markdown> paints images as link text. A local image paints at
  its natural size, scaled down to fit the column; one of unknown size gets a fixed box. A remote image shows its alt
  text until View > Load Remote Images allows it, and paints the bytes fetched for its size. A local image whose file
  is missing, or a remote one that failed, paints as WebKit's broken image, instead of GPUI's load error atop the
  fixed box. ImageBlock and MixedParagraphBlock paint each of their images here.
-->
<script lang="ts">
	import { set_image, type ShadowNode } from 'gpuix-svelte'
	import { useTheme } from '../../../app/theme.svelte.ts'
	import type { Image } from '../../../engine/blocks.ts'
	import { fitToWidth, type Size } from '../../../core/imageSize.ts'
	import { resolveImageSource } from '../../../core/imageSource.ts'
	import { documentController } from '../controller.svelte.ts'
	import { dropFiles } from '../fileDrop.ts'
	import PointerTip from '../../PointerTip.svelte'

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
	/** a loaded remote image's size and bytes once they came; null while unknown, and for any other image */
	const remote = $derived(
		source.kind === 'remote' && source.path === undefined && documentController.remoteImagesAllowed
			? documentController.remoteImageOf(source.url)
			: null
	)
	/**
	 * a local image's size from its file, a loaded remote one's from its bytes once they came (a `file:` URL's from the
	 * file it loads from); null while unknown
	 */
	const naturalSize = $derived.by(() => {
		if (source.kind === 'local') return documentController.imageSizeOf(source.path)
		if (!documentController.remoteImagesAllowed) return null
		return source.path === undefined
			? (remote?.size ?? null)
			: documentController.imageSizeOf(source.path)
	})
	/**
	 * what the <img> loads: a file's path, or a remote image's URL until its bytes came; null once they did, which it
	 * paints instead (`set_image`), so the image is fetched once
	 */
	const imageSource = $derived.by(() => {
		if (source.kind === 'local') return source.path
		return source.path ?? (remote?.bytes ? null : source.url)
	})
	/**
	 * a linked image's click reports its link as a <markdown> reports a link run's: the Block's click that follows
	 * decides whether it is followed (Cmd) or the Block opens (`DocumentController.clickBlock`)
	 */
	const href = $derived(image.href)
	/**
	 * a local image whose file is missing, or a remote one that failed once allowed (a 404, no answer): either paints
	 * as WebKit's broken image, a box its alt text's size
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
	 * editmd's picture icon for a blocked image (style.css:313, its mask's rect, circle and mountain): GPUI paints it as
	 * a mask in `.remote-icon`'s `color`, so `colour` only matters where something reads the source, as the magnifier's
	 */
	function pictureIcon(colour: string | undefined): string {
		const paint = colour ?? '#808080'
		return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="${paint}" stroke-width="1.3"/><circle cx="5.5" cy="6.3" r="1.3" fill="${paint}"/><path d="M2.5 12.5 6.5 8.5 9 11 11 9 13.5 12.5Z" fill="${paint}"/></svg>`
	}

	/**
	 * WebKit's broken-image icon as editmd's picture shows it: a blue square in a pale frame holding a white question
	 * mark. GPUI paints an <svg> element in one colour, so the icon's several go in through an <img>
	 */
	const BROKEN_ICON = `data:image/svg+xml,${encodeURIComponent(
		'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect x="0.5" y="0.5" width="15" height="15" fill="#4f86c6" stroke="#dce8f5"/><path d="M5.8 6.2a2.2 2.2 0 1 1 3.3 1.9c-.7.4-1.1.8-1.1 1.6v.5" fill="none" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="12.2" r="0.9" fill="#ffffff"/></svg>'
	)}`
</script>

<!--
  an image's title is a native tip at the pointer, as editmd sets `img.title` (remote.ts:77-78), heard on the frame:
  the handlers on the <img> itself showed no tip (measured headless); a blocked image's own tip, its src, is innermost
-->
<PointerTip text={image.title ?? null} testid={`image-tooltip-${testIdSuffix}`}>
	{#snippet children(pointer)}
		<!-- an image of unknown size keeps the fixed box across the column, in a row of images too -->
		<div
			class={[
				'frame',
				naturalSize === null &&
					!fileMissing &&
					(source.kind === 'local' || documentController.remoteImagesAllowed) &&
					'fill'
			]}
			{...pointer}
		>
			{#if fileMissing}
				<!--
				  WebKit's broken image: a box the alt text's size in a 1px light grey border, the alt text itself unpainted,
				  its icon centred in it
				-->
				<div class="broken" testid={`image-broken-${testIdSuffix}`}>
					<text class="broken-alt" testid={`image-missing-${testIdSuffix}`}>{image.alt}</text>
					<div class="broken-centre">
						<img
							class="broken-icon"
							testid={`image-broken-icon-${testIdSuffix}`}
							src={BROKEN_ICON}
							alt=""
						/>
					</div>
				</div>
			{:else if source.kind === 'local' || documentController.remoteImagesAllowed}
				{@const bytes = remote?.bytes}
				<img
					class={['image', naturalSize === null && 'fixed']}
					testid={`image-${testIdSuffix}`}
					src={imageSource}
					{@attach bytes && ((node: ShadowNode) => set_image(node, bytes))}
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
				  (remote.ts:68 `title = src`), not the URL it resolves to, a native tip at the pointer
				-->
				<PointerTip text={image.src} testid={`remote-image-tooltip-${testIdSuffix}`}>
					{#snippet children(remotePointer)}
						<div class="remote" testid={`remote-image-${testIdSuffix}`} {...remotePointer}>
							<svg class="remote-icon" source={pictureIcon(theme().palette.muted)}></svg>
							<text
								class="remote-alt"
								testid={`image-blocked-${testIdSuffix}`}
								aria-description={image.src}>{image.alt}</text
							>
						</div>
					{/snippet}
				</PointerTip>
			{/if}
		</div>
	{/snippet}
</PointerTip>

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

	.broken {
		align-self: flex-start;
		border-width: 1px;
		border-color: var(--broken-image);
	}

	/* the alt text sizes the box and paints nothing */
	.broken-alt {
		font-size: var(--size-image-alt);
		opacity: 0;
	}

	.broken-centre {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.broken-icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
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
