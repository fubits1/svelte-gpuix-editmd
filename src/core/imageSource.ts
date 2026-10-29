import { fileURLToPath } from 'node:url'
import { imageBase } from './fileUrls.ts'
import { isRemote } from './remote.ts'

/**
 * a local image as a filesystem path (or its `data:` URL); a remote one as the URL it would fetch, plus the
 * path a blocked `file:` URL loads from once allowed (GPUI's <img> takes paths, not `file:` URLs)
 */
export type ImageSource =
	{ kind: 'local'; path: string } | { kind: 'remote'; url: string; path?: string }

/**
 * where `src`, as written in a document in `folder` (null when untitled), points in the form GPUI's <img>
 * loads: relative paths resolve against the folder and come out percent-decoded, `data:` URLs pass through
 */
export function resolveImageSource(src: string, folder: string | null): ImageSource {
	const base = imageBase(folder)
	if (isRemote(src, base)) {
		if (!URL.canParse(src, base)) return { kind: 'remote', url: src }
		const url = new URL(src, base)
		const path = url.protocol === 'file:' && url.host === '' ? fileURLToPath(url) : undefined
		return path === undefined
			? { kind: 'remote', url: url.href }
			: { kind: 'remote', url: url.href, path }
	}

	const url = new URL(src, base)
	if (url.protocol === 'data:') return { kind: 'local', path: src }
	try {
		return { kind: 'local', path: fileURLToPath(url) }
	} catch {
		// a file URL naming another host (`//host/pic.png`) has no local path, so only Load Remote Images may try it
		return { kind: 'remote', url: url.href }
	}
}
