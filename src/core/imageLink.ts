// How an image file dropped on a document is written into it.

import { posix } from 'node:path'
import { isImagePath } from './fileTypes.ts'
import type { Image } from './images.ts'

/**
 * Only unreserved characters stay as they are. Spaces and parentheses
 * would end a markdown link, `#` and `?` would start a fragment or query,
 * and a `:` could make the path read as a URL scheme. In NFC, the form the
 * web expects; macOS file names may come decomposed, and APFS finds the file either way.
 */
function encodeComponent(component: string): string {
	return encodeURIComponent(component.normalize('NFC')).replace(
		/[!'()*]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
	)
}

/**
 * The link for `file` (an absolute path), or null if it is not an image. `directory`
 * is the document's folder, null for an untitled document. `src` is a path relative to
 * that folder, or an absolute path for a document not yet saved, percent-encoded;
 * `alt` is the file's name without its extension. `isImageName` tells an image
 * by its name (the app passes macOS's type for its extension, host/fileKinds.ts).
 */
export function imageLink(
	file: string,
	directory: string | null,
	isImageName: (path: string) => boolean = isImagePath
): Image | null {
	if (!isImageName(file)) return null

	const target = posix.normalize(file).split('/').filter(Boolean)
	let components: string[]

	if (directory !== null) {
		const base = posix.normalize(directory).split('/').filter(Boolean)
		let common = 0
		while (common < Math.min(base.length, target.length - 1) && base[common] === target[common])
			common++
		components = [...Array<string>(base.length - common).fill('..'), ...target.slice(common)]
	} else {
		components = ['', ...target]
	}

	const src = components
		.map((component) => (component === '..' ? component : encodeComponent(component)))
		.join('/')
	const name = posix.basename(file)
	const alt = name.slice(0, name.lastIndexOf('.')).normalize('NFC')

	return { src, alt }
}
