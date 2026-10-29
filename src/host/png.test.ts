import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { decodePng, encodePng, stitch, type Pixels } from './png.ts'

/** a width×height RGBA picture whose every pixel holds its own x, y and `tag` */
function picture(width: number, height: number, tag: number): Pixels {
	const data = new Uint8Array(width * height * 4)
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) data.set([x, y, tag, 255], (y * width + x) * 4)
	}
	return { width, height, data }
}

describe('PNG', () => {
	test('what encodePng writes, decodePng reads back pixel for pixel', () => {
		const original = picture(5, 3, 7)
		expect(decodePng(encodePng(original))).toEqual(original)
	})

	// GPUI's screenshots use every PNG row filter, so reading one exercises them all
	test('a screenshot GPUI wrote reads at its size and survives a write and a read', () => {
		const shot = decodePng(readFileSync('test/fixtures/parity/r-quote-shot.png'))
		expect([shot.width > 0, shot.height > 0, shot.data.length]).toEqual([
			true,
			true,
			shot.width * shot.height * 4
		])
		const again = decodePng(encodePng(shot))
		// compared as bytes: a deep equal walks millions of array entries one by one
		expect([again.width, again.height, Buffer.from(again.data).equals(shot.data)]).toEqual([
			shot.width,
			shot.height,
			true
		])
	})
})

/** the RGBA pixels of a top-down 32-bit BITFIELDS BMP, which is what macOS's `sips -s format bmp` writes */
function readBmp(bytes: Buffer): Pixels {
	const start = bytes.readUInt32LE(10)
	const width = bytes.readInt32LE(18)
	const height = Math.abs(bytes.readInt32LE(22))
	const masks = [54, 58, 62, 66].map((at) => bytes.readUInt32LE(at))
	const shifts = masks.map((mask) => Math.log2(mask & -mask))
	const data = new Uint8Array(width * height * 4)
	for (let pixel = 0; pixel < width * height; pixel++) {
		const value = bytes.readUInt32LE(start + pixel * 4)
		for (let channel = 0; channel < 4; channel++) {
			data[pixel * 4 + channel] = (value >>> shifts[channel]!) & 0xff
		}
	}
	return { width, height, data }
}

describe('decodePng against macOS', () => {
	// an independent decoder: ImageIO through `sips`, so a row filter decoded wrong cannot hide in a round trip
	test('a GPUI screenshot decodes to the same pixels ImageIO reads', () => {
		const folder = mkdtempSync(join(tmpdir(), 'eg-png-'))
		const bmp = join(folder, 'shot.bmp')
		execFileSync('/usr/bin/sips', [
			'-s',
			'format',
			'bmp',
			'test/fixtures/parity/r-quote-shot.png',
			'--out',
			bmp
		])
		const reference = readBmp(readFileSync(bmp))
		rmSync(folder, { recursive: true, force: true })

		const decoded = decodePng(readFileSync('test/fixtures/parity/r-quote-shot.png'))
		expect([
			decoded.width,
			decoded.height,
			Buffer.from(decoded.data).equals(reference.data)
		]).toEqual([reference.width, reference.height, true])
	})
})

describe('stitch', () => {
	test('places each piece at its row on the page, later pieces over earlier ones, cut to the height', () => {
		const top = picture(2, 3, 1)
		const bottom = picture(2, 3, 2)
		const page = stitch(
			[
				{ pixels: top, y: 0 },
				{ pixels: bottom, y: 2 }
			],
			4
		)

		const tags = Array.from({ length: page.height }, (_, y) => page.data[y * page.width * 4 + 2])
		const rows = Array.from({ length: page.height }, (_, y) => page.data[y * page.width * 4 + 1])
		expect([page.width, page.height, tags, rows]).toEqual([2, 4, [1, 1, 2, 2], [0, 1, 0, 1]])
	})
})
