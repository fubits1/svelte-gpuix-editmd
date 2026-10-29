import { describe, expect, test } from 'vitest'
import { fitToWidth, imageSize } from './imageSize.ts'

const bytes = (...values: number[]) => Uint8Array.from(values)

describe('imageSize', () => {
	test('PNG: width and height from the IHDR chunk', () => {
		const png = bytes(
			0x89,
			0x50,
			0x4e,
			0x47,
			0x0d,
			0x0a,
			0x1a,
			0x0a,
			0,
			0,
			0,
			13,
			0x49,
			0x48,
			0x44,
			0x52,
			0,
			0,
			0x01,
			0x2c,
			0,
			0,
			0,
			0xc8
		)
		expect(imageSize(png)).toEqual({ width: 300, height: 200 })
	})

	test('GIF: little-endian logical screen size', () => {
		const gif = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00)
		expect(imageSize(gif)).toEqual({ width: 320, height: 240 })
	})

	test('JPEG: the first start-of-frame marker after other segments', () => {
		const jpeg = bytes(
			0xff,
			0xd8,
			0xff,
			0xe0,
			0x00,
			0x04,
			0x00,
			0x00,
			0xff,
			0xc0,
			0x00,
			0x11,
			0x08,
			0x01,
			0x90,
			0x02,
			0x58
		)
		expect(imageSize(jpeg)).toEqual({ width: 600, height: 400 })
	})

	test('WebP (VP8X): 24-bit little-endian size minus one', () => {
		const webp = bytes(
			0x52,
			0x49,
			0x46,
			0x46,
			0,
			0,
			0,
			0,
			0x57,
			0x45,
			0x42,
			0x50,
			0x56,
			0x50,
			0x38,
			0x58,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0x7f,
			0x02,
			0x00,
			0xdf,
			0x01,
			0x00
		)
		expect(imageSize(webp)).toEqual({ width: 640, height: 480 })
	})

	// GPUI's <img> decodes SVG, BMP, TIFF and ICO too (`setImage`, @gpuix/native index.d.ts:156-160)
	test('BMP: little-endian width and height, a top-down height given as its size', () => {
		const bmp = new Uint8Array(26)
		bmp.set([0x42, 0x4d])
		new DataView(bmp.buffer).setInt32(18, 320, true)
		new DataView(bmp.buffer).setInt32(22, -200, true)
		expect(imageSize(bmp)).toEqual({ width: 320, height: 200 })
	})

	test('TIFF: ImageWidth and ImageLength from the first directory, either byte order', () => {
		const tiff = (littleEndian: boolean) => {
			const data = new Uint8Array(8 + 2 + 2 * 12)
			const view = new DataView(data.buffer)
			data.set(littleEndian ? [0x49, 0x49, 0x2a, 0x00] : [0x4d, 0x4d, 0x00, 0x2a])
			view.setUint32(4, 8, littleEndian)
			view.setUint16(8, 2, littleEndian)
			// ImageWidth as SHORT, ImageLength as LONG
			view.setUint16(10, 256, littleEndian)
			view.setUint16(12, 3, littleEndian)
			view.setUint32(14, 1, littleEndian)
			view.setUint16(18, 640, littleEndian)
			view.setUint16(22, 257, littleEndian)
			view.setUint16(24, 4, littleEndian)
			view.setUint32(26, 1, littleEndian)
			view.setUint32(30, 480, littleEndian)
			return data
		}
		expect([imageSize(tiff(true)), imageSize(tiff(false))]).toEqual([
			{ width: 640, height: 480 },
			{ width: 640, height: 480 }
		])
	})

	test('ICO: the largest image in the directory, 0 meaning 256', () => {
		const ico = bytes(
			0,
			0,
			1,
			0,
			2,
			0,
			...[16, 16, 0, 0],
			...new Array(12).fill(0),
			...[0, 0, 0, 0]
		)
		expect(imageSize(ico)).toEqual({ width: 256, height: 256 })
	})

	test('SVG: the root’s width and height in px or plain numbers, else from the other and the viewBox', () => {
		const svg = (attributes: string) =>
			new TextEncoder().encode(
				`<?xml version="1.0"?>\n<!-- drawn -->\n<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><rect/></svg>`
			)
		expect([
			imageSize(svg('width="120" height="80px"')),
			imageSize(svg('width="120" viewBox="0 0 60 20"')),
			imageSize(svg("height='40' viewBox='0 0 60 20'")),
			imageSize(svg('viewBox="0 0 60 20"')),
			imageSize(svg('width="50%" height="80"'))
		]).toEqual([
			{ width: 120, height: 80 },
			{ width: 120, height: 40 },
			{ width: 120, height: 40 },
			null,
			null
		])
	})

	// WebKit sizes an SVG of 300×150pt at 400×200 px; CSS absolute units, 96 px to the inch
	test('SVG lengths in absolute units convert to px as CSS converts them', () => {
		const svg = (attributes: string) =>
			new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" ${attributes}/>`)
		expect([
			imageSize(svg('width="300pt" height="150pt"')),
			imageSize(svg('width="1in" height="2.54cm"')),
			imageSize(svg('width="25.4mm" height="6pc"'))
		]).toEqual([
			{ width: 400, height: 200 },
			{ width: 96, height: 96 },
			{ width: 96, height: 96 }
		])
	})

	// the root came after the first 4096 bytes, a commented-out <svg> was read as the root, and a JPEG
	// with 0xFF fill bytes before a marker gave no size
	test('a late root, a commented-out <svg> and JPEG fill bytes', () => {
		const encode = (text: string) => new TextEncoder().encode(text)
		const late = encode(`<!--${'x'.repeat(5000)}-->\n<svg width="30" height="20"/>`)
		const commented = encode('<!-- <svg width="1" height="1"/> --><svg width="30" height="20"/>')
		const jpeg = bytes(
			0xff,
			0xd8,
			0xff,
			0xff,
			0xff,
			0xc0,
			0x00,
			0x11,
			0x08,
			0x00,
			0x14,
			0x00,
			0x1e,
			0x03
		)
		expect([imageSize(late), imageSize(commented), imageSize(jpeg)]).toEqual([
			{ width: 30, height: 20 },
			{ width: 30, height: 20 },
			{ width: 30, height: 20 }
		])
	})

	test('anything else is null, so the view falls back to a fixed box', () => {
		expect(imageSize(bytes(1, 2, 3))).toBeNull()
	})
})

describe('fitToWidth', () => {
	test('a wider image scales down to the width, keeping its aspect ratio', () => {
		expect(fitToWidth({ width: 1600, height: 800 }, 752)).toEqual({ width: 752, height: 376 })
	})

	test('a narrower image keeps its natural size: it is never scaled up', () => {
		expect(fitToWidth({ width: 300, height: 200 }, 752)).toEqual({ width: 300, height: 200 })
	})
})
