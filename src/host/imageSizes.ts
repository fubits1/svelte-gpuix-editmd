import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { imageSize, type Size } from '../core/imageSize.ts'

/** what one read of an image file found: its natural size (null when unknown), and whether it was there at all */
type Read = { size: Size | null; missing: boolean }

/**
 * local image files' natural sizes, read from their headers once per path, since a View asks on every
 * paint; null for a file that is missing, unreadable or not a PNG, GIF, JPEG or WebP
 */
export class ImageSizes {
	#reads = new Map<string, Read>()

	sizeOf(path: string): Size | null {
		return this.#read(path).size
	}

	/** no file at `path`: the View shows a broken image, small, where an unknown size gets the fallback box */
	isMissing(path: string): boolean {
		return this.#read(path).missing
	}

	#read(path: string): Read {
		let read = this.#reads.get(path)
		if (!read) {
			read = readImage(path)
			this.#reads.set(path, read)
		}
		return read
	}
}

/** an inline image's size, read from the bytes its `data:` URL holds (base64 or percent-encoded); null when unknown */
function dataUrlSize(url: string): Size | null {
	const comma = url.indexOf(',')
	if (comma < 0) return null
	const meta = url.slice(5, comma)
	const body = url.slice(comma + 1)
	try {
		// percent-escapes are bytes, which need be no UTF-8 text (a PNG's 0x89)
		const bytes = meta.endsWith(';base64')
			? Buffer.from(body, 'base64')
			: Buffer.from(
					body.replace(/%([0-9a-f]{2})/gi, (_all, hex: string) =>
						String.fromCharCode(Number.parseInt(hex, 16))
					),
					'latin1'
				)
		return imageSize(new Uint8Array(bytes.subarray(0, HEADER_BYTES)))
	} catch {
		return null
	}
}

/** the most of a file read for its size: a header, or an SVG's root tag, sits well inside it */
const HEADER_BYTES = 1024 * 1024

/**
 * a regular file's first bytes only: a FIFO or a device could block the read for good, and the window reads while it
 * paints
 */
function readImage(path: string): Read {
	if (path.startsWith('data:')) return { size: dataUrlSize(path), missing: false }
	try {
		// told missing, so the view paints the alt text and GPUI's <img> never loads a FIFO or a device either
		if (!statSync(path).isFile()) return { size: null, missing: true }
		const descriptor = openSync(path, 'r')
		try {
			const bytes = new Uint8Array(HEADER_BYTES)
			const length = readSync(descriptor, bytes, 0, HEADER_BYTES, 0)
			return { size: imageSize(bytes.subarray(0, length)), missing: false }
		} finally {
			closeSync(descriptor)
		}
	} catch (error) {
		const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT'
		return { size: null, missing }
	}
}
