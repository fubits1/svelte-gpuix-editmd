import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { ImageSizes } from './imageSizes.ts'

const directory = mkdtempSync(join(tmpdir(), 'editmd-gpuix-image-sizes-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

/** a GIF's signature and logical screen size, the shortest header imageSize reads */
const gifHeader = (width: number, height: number) =>
	Uint8Array.from([
		0x47,
		0x49,
		0x46,
		0x38,
		0x39,
		0x61,
		width & 0xff,
		width >> 8,
		height & 0xff,
		height >> 8
	])

describe('ImageSizes', () => {
	test('reads a local image file’s natural size from its header', () => {
		const path = join(directory, 'screen.gif')
		writeFileSync(path, gifHeader(320, 240))
		expect(new ImageSizes().sizeOf(path)).toEqual({ width: 320, height: 240 })
	})

	test('a missing or unrecognised file has no size', () => {
		const path = join(directory, 'notes.txt')
		writeFileSync(path, 'not an image')
		const sizes = new ImageSizes()
		expect(sizes.sizeOf(path)).toBeNull()
		expect(sizes.sizeOf(join(directory, 'missing.png'))).toBeNull()
	})

	test('a missing file is told apart from one of unknown size, so the View can show it as broken', () => {
		const path = join(directory, 'unknown.txt')
		writeFileSync(path, 'not an image')
		const sizes = new ImageSizes()

		expect(sizes.isMissing(join(directory, 'gone.png'))).toBe(true)
		expect(sizes.isMissing(path)).toBe(false)
	})

	/**
	 * a read that never ends would freeze the window while it paints: a FIFO with no writer and a
	 * device that never runs dry. the read runs in a child process, since a blocked read would stop this test too
	 */
	test('a FIFO or a device is no image and is never read', () => {
		const fifo = join(directory, 'pipe.png')
		execFileSync('/usr/bin/mkfifo', [fifo])
		const module = pathToFileURL(join(import.meta.dirname, 'imageSizes.ts')).href
		const script = `const { ImageSizes } = await import(${JSON.stringify(module)}); const sizes = new ImageSizes(); console.log(JSON.stringify([${JSON.stringify(fifo)}, '/dev/zero'].map((path) => [sizes.sizeOf(path), sizes.isMissing(path)])))`

		const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
			encoding: 'utf8',
			timeout: 5000
		})

		// told missing, so the view paints the alt text and never hands GPUI's <img> the path to load
		expect(JSON.parse(out)).toEqual([
			[null, true],
			[null, true]
		])
	})

	// percent-encoded bytes that are no UTF-8 text (a PNG's 0x89) gave no size
	test('a percent-encoded data: URL of binary bytes is sized from them', () => {
		const png = Buffer.alloc(24)
		png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
		png.writeUInt32BE(10, 16)
		png.writeUInt32BE(20, 20)
		const url = `data:image/png,${[...png].map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join('')}`
		expect(new ImageSizes().sizeOf(url)).toEqual({ width: 10, height: 20 })
	})

	// a `data:` image was looked up as a file, found missing and painted as its alt text; editmd shows it
	test('a data: URL is sized from its own bytes and is never missing', () => {
		const base64 = `data:image/gif;base64,${Buffer.from(gifHeader(12, 34)).toString('base64')}`
		const svg =
			'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2256%22%20height%3D%2278%22%2F%3E'
		const sizes = new ImageSizes()
		expect([sizes.sizeOf(base64), sizes.isMissing(base64), sizes.sizeOf(svg)]).toEqual([
			{ width: 12, height: 34 },
			false,
			{ width: 56, height: 78 }
		])
	})

	test('each path is read once, so every paint after the first costs no file read', () => {
		const path = join(directory, 'cached.gif')
		writeFileSync(path, gifHeader(10, 20))
		const sizes = new ImageSizes()
		sizes.sizeOf(path)
		writeFileSync(path, gifHeader(30, 40))
		expect(sizes.sizeOf(path)).toEqual({ width: 10, height: 20 })
	})
})
