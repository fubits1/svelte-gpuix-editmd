import { imageLink } from '../core/imageLink.ts'
import { type Image, imagesMarkdown } from '../core/images.ts'

/** what a file drop does to the Document: the images' markdown, null when there is none, and the files to open */
export type Drop = { markdown: string | null; others: string[] }

/**
 * files dropped on a Document in `folder` (null when untitled), as editmd's EditorBridge `drop`: each image
 * becomes a link (`imageLink`), all of them one run inserted together; anything else opens as a linked file would.
 * `isImageName` tells an image by its name (the app passes macOS's type for its extension, host/fileKinds.ts)
 */
export function sortDrop(
	paths: readonly string[],
	folder: string | null,
	isImageName?: (path: string) => boolean
): Drop {
	const images: Image[] = []
	const others: string[] = []
	for (const path of paths) {
		const link = imageLink(path, folder, isImageName)
		if (link) images.push(link)
		else others.push(path)
	}
	return { markdown: images.length > 0 ? imagesMarkdown(images) : null, others }
}
