import { crc32, deflateSync, inflateSync } from 'node:zlib'

/** an RGBA picture, 8 bits a channel, rows top to bottom */
export type Pixels = { width: number; height: number; data: Uint8Array }

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

/** the predictor a PNG row filter adds back (PNG spec 9.2), `paeth` for filter 4 */
function predictor(filter: number, left: number, up: number, upLeft: number): number {
	if (filter === 1) return left
	if (filter === 2) return up
	if (filter === 3) return (left + up) >> 1
	if (filter !== 4) return 0
	const estimate = left + up - upLeft
	const toLeft = Math.abs(estimate - left)
	const toUp = Math.abs(estimate - up)
	const toUpLeft = Math.abs(estimate - upLeft)
	return toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft
}

/** an 8-bit RGB or RGBA, non-interlaced PNG, which is what GPUI's screenshots are, as RGBA */
export function decodePng(bytes: Uint8Array): Pixels {
	const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	let offset = SIGNATURE.length
	let width = 0
	let height = 0
	let channels = 4
	const compressed: Buffer[] = []
	while (offset < view.length) {
		const length = view.readUInt32BE(offset)
		const type = view.toString('ascii', offset + 4, offset + 8)
		const body = view.subarray(offset + 8, offset + 8 + length)
		if (type === 'IHDR') {
			width = body.readUInt32BE(0)
			height = body.readUInt32BE(4)
			if (body[8] !== 8 || (body[9] !== 2 && body[9] !== 6) || body[12] !== 0) {
				throw new Error('only 8-bit RGB or RGBA PNGs without interlacing are read')
			}
			channels = body[9] === 6 ? 4 : 3
		} else if (type === 'IDAT') compressed.push(body)
		offset += 12 + length
	}

	const raw = inflateSync(Buffer.concat(compressed))
	const stride = width * channels
	const rows = new Uint8Array(height * stride)
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)]!
		for (let x = 0; x < stride; x++) {
			const left = x >= channels ? rows[y * stride + x - channels]! : 0
			const up = y > 0 ? rows[(y - 1) * stride + x]! : 0
			const upLeft = y > 0 && x >= channels ? rows[(y - 1) * stride + x - channels]! : 0
			rows[y * stride + x] =
				(raw[y * (stride + 1) + 1 + x]! + predictor(filter, left, up, upLeft)) & 0xff
		}
	}
	if (channels === 4) return { width, height, data: rows }

	const data = new Uint8Array(width * height * 4)
	for (let pixel = 0; pixel < width * height; pixel++) {
		data.set(rows.subarray(pixel * 3, pixel * 3 + 3), pixel * 4)
		data[pixel * 4 + 3] = 255
	}
	return { width, height, data }
}

function chunk(type: string, body: Uint8Array): Buffer {
	const head = Buffer.alloc(8)
	head.writeUInt32BE(body.length, 0)
	head.write(type, 4, 'ascii')
	const tail = Buffer.alloc(4)
	tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
	return Buffer.concat([head, body, tail])
}

/** an RGBA PNG of `pixels`, every row unfiltered */
export function encodePng({ width, height, data }: Pixels): Uint8Array {
	const header = Buffer.alloc(13)
	header.writeUInt32BE(width, 0)
	header.writeUInt32BE(height, 4)
	header.set([8, 6, 0, 0, 0], 8)
	const stride = width * 4
	const raw = Buffer.alloc(height * (stride + 1))
	for (let y = 0; y < height; y++) {
		raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
	}
	return Buffer.concat([
		SIGNATURE,
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', new Uint8Array())
	])
}

/**
 * one picture `height` rows tall from pieces of the same width, each drawn at its row `y` on the page,
 * later pieces over earlier ones; rows no piece covers stay transparent
 */
export function stitch(pieces: readonly { pixels: Pixels; y: number }[], height: number): Pixels {
	const width = pieces[0]?.pixels.width ?? 0
	const data = new Uint8Array(width * height * 4)
	const stride = width * 4
	for (const { pixels, y } of pieces) {
		for (let row = 0; row < pixels.height; row++) {
			const at = y + row
			if (at < 0 || at >= height) continue
			data.set(pixels.data.subarray(row * stride, (row + 1) * stride), at * stride)
		}
	}
	return { width, height, data }
}
