export type Size = { width: number; height: number }

const startsWith = (data: Uint8Array, signature: readonly number[], at = 0) =>
	signature.every((byte, index) => data[at + index] === byte)

const uint16BigEndian = (data: Uint8Array, at: number) => (data[at]! << 8) | data[at + 1]!
const uint16LittleEndian = (data: Uint8Array, at: number) => data[at]! | (data[at + 1]! << 8)
const uint24LittleEndian = (data: Uint8Array, at: number) =>
	data[at]! | (data[at + 1]! << 8) | (data[at + 2]! << 16)
const uint32BigEndian = (data: Uint8Array, at: number) =>
	data[at]! * 0x1000000 + ((data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!)

/** SOF0-SOF15 except DHT (C4), JPG (C8) and DAC (CC), which carry no frame size */
const isStartOfFrame = (marker: number) =>
	marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

function jpegSize(data: Uint8Array): Size | null {
	let at = 2
	// a start-of-frame segment is read up to `at + 8` (height at +5, width at +7)
	while (at + 8 < data.length) {
		if (data[at] !== 0xff) return null
		// a marker may be preceded by any number of 0xFF fill bytes (ITU T.81 B.1.1.2)
		if (data[at + 1] === 0xff) {
			at += 1
			continue
		}
		const marker = data[at + 1]!
		if (isStartOfFrame(marker))
			return { width: uint16BigEndian(data, at + 7), height: uint16BigEndian(data, at + 5) }
		at += 2 + uint16BigEndian(data, at + 2)
	}
	return null
}

function webpSize(data: Uint8Array): Size | null {
	if (startsWith(data, [0x56, 0x50, 0x38, 0x58], 12)) {
		return { width: uint24LittleEndian(data, 24) + 1, height: uint24LittleEndian(data, 27) + 1 }
	}
	if (startsWith(data, [0x56, 0x50, 0x38, 0x4c], 12) && data.length >= 25) {
		const bits = data[21]! | (data[22]! << 8) | (data[23]! << 16) | (data[24]! << 24)
		return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
	}
	if (startsWith(data, [0x56, 0x50, 0x38, 0x20], 12) && data.length >= 30) {
		return {
			width: uint16LittleEndian(data, 26) & 0x3fff,
			height: uint16LittleEndian(data, 28) & 0x3fff
		}
	}
	return null
}

function bmpSize(data: Uint8Array): Size | null {
	if (data.length < 26) return null
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
	// a negative height is a top-down bitmap of that many rows
	return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) }
}

/** ImageWidth (256) and ImageLength (257) in the first image file directory, each a SHORT or a LONG */
function tiffSize(data: Uint8Array, littleEndian: boolean): Size | null {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
	if (data.length < 8) return null
	const directory = view.getUint32(4, littleEndian)
	if (directory + 2 > data.length) return null
	const sizes = new Map<number, number>()
	for (let entry = 0; entry < view.getUint16(directory, littleEndian); entry++) {
		const at = directory + 2 + entry * 12
		if (at + 12 > data.length) break
		const tag = view.getUint16(at, littleEndian)
		const type = view.getUint16(at + 2, littleEndian)
		if (tag !== 256 && tag !== 257) continue
		if (type === 3) sizes.set(tag, view.getUint16(at + 8, littleEndian))
		else if (type === 4) sizes.set(tag, view.getUint32(at + 8, littleEndian))
	}
	const width = sizes.get(256)
	const height = sizes.get(257)
	return width && height ? { width, height } : null
}

/** the largest entry of an icon directory; a width or height byte of 0 means 256 */
function icoSize(data: Uint8Array): Size | null {
	let largest: Size | null = null
	for (let entry = 0; entry < uint16LittleEndian(data, 4); entry++) {
		const at = 6 + entry * 16
		if (at + 2 > data.length) break
		const size = { width: data[at]! || 256, height: data[at + 1]! || 256 }
		if (!largest || size.width * size.height > largest.width * largest.height) largest = size
	}
	return largest
}

/** px per CSS absolute unit, 96 px to the inch, as WebKit sizes an SVG */
const PX_PER_UNIT: Record<string, number> = {
	'': 1,
	px: 1,
	pt: 96 / 72,
	pc: 16,
	in: 96,
	cm: 96 / 2.54,
	mm: 96 / 25.4,
	q: 96 / 101.6
}

/**
 * a length attribute in an absolute unit or a plain number, in px; percentages and font-relative units depend on the
 * page, so they are no size
 */
function svgLength(value: string | undefined): number | null {
	const match = value?.trim().match(/^(\d+(?:\.\d+)?)([a-z]*)$/i)
	const factor = match ? PX_PER_UNIT[match[2]!.toLowerCase()] : undefined
	return match && factor !== undefined ? Number(match[1]) * factor : null
}

/** the root <svg>'s width and height, either derived from the other and the viewBox; null when the page sets it */
function svgSize(data: Uint8Array): Size | null {
	// the root may follow a long comment or doctype; a commented-out <svg> is not it
	const text = new TextDecoder().decode(data).replace(/<!--[\s\S]*?-->/g, '')
	const tag = text.match(/<svg\b[^>]*>/)?.[0]
	if (!tag) return null
	const attribute = (name: string) =>
		tag
			.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`))
			?.slice(1)
			.find((v) => v !== undefined)
	const width = svgLength(attribute('width'))
	const height = svgLength(attribute('height'))
	if (width !== null && height !== null) return { width, height }
	const box = attribute('viewBox')
		?.trim()
		.split(/[\s,]+/)
		.map(Number)
	if (!box || box.length !== 4 || !(box[2]! > 0) || !(box[3]! > 0)) return null
	const ratio = box[3]! / box[2]!
	if (width !== null) return { width, height: width * ratio }
	if (height !== null) return { width: height / ratio, height }
	return null
}

/**
 * an image file's natural size from its header (PNG, GIF, JPEG, WebP, BMP, TIFF, ICO, SVG: what GPUI's <img>
 * decodes), since GPUI's <img> needs explicit dimensions
 */
export function imageSize(data: Uint8Array): Size | null {
	if (startsWith(data, [0x89, 0x50, 0x4e, 0x47]) && data.length >= 24) {
		return { width: uint32BigEndian(data, 16), height: uint32BigEndian(data, 20) }
	}
	if (startsWith(data, [0x47, 0x49, 0x46, 0x38]) && data.length >= 10) {
		return { width: uint16LittleEndian(data, 6), height: uint16LittleEndian(data, 8) }
	}
	if (startsWith(data, [0xff, 0xd8])) return jpegSize(data)
	if (startsWith(data, [0x52, 0x49, 0x46, 0x46]) && startsWith(data, [0x57, 0x45, 0x42, 0x50], 8))
		return webpSize(data)
	if (startsWith(data, [0x42, 0x4d])) return bmpSize(data)
	if (startsWith(data, [0x49, 0x49, 0x2a, 0x00])) return tiffSize(data, true)
	if (startsWith(data, [0x4d, 0x4d, 0x00, 0x2a])) return tiffSize(data, false)
	if (startsWith(data, [0x00, 0x00, 0x01, 0x00]) && data.length >= 6) return icoSize(data)
	return svgSize(data)
}

/** `size` scaled down to fit `width`, keeping its aspect ratio; never scaled up */
export function fitToWidth(size: Size, width: number): Size {
	if (size.width <= width) return size
	return { width, height: (size.height * width) / size.width }
}
