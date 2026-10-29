import { describe, expect, test } from 'vitest'
import { imageLink } from './imageLink.ts'

const folder = '/Users/me/notes/'

describe('imageLink', () => {
	test('image beside the document', () => {
		expect(imageLink('/Users/me/notes/pic.png', folder)).toEqual({ src: 'pic.png', alt: 'pic' })
	})

	test('image in a subfolder or above', () => {
		expect(imageLink('/Users/me/notes/images/a.jpg', folder)?.src).toBe('images/a.jpg')
		expect(imageLink('/Users/me/Pictures/a.gif', folder)?.src).toBe('../Pictures/a.gif')
		expect(imageLink('/tmp/a.webp', folder)?.src).toBe('../../../tmp/a.webp')
	})

	test('awkward names are percent-encoded', () => {
		const link = imageLink('/Users/me/notes/my pic (1)#2?:é.png', folder)
		expect(link?.src).toBe('my%20pic%20%281%29%232%3F%3A%C3%A9.png')
		expect(link?.alt).toBe('my pic (1)#2?:é')
	})

	test('decomposed names come out in NFC', () => {
		// e + combining acute accent, as macOS may hand over file names
		const combiningAcute = String.fromCharCode(0x301)
		expect(imageLink(`/Users/me/notes/e${combiningAcute}.png`, folder)).toEqual({
			src: '%C3%A9.png',
			alt: 'é'
		})
	})

	test('untitled documents get an absolute path', () => {
		expect(imageLink('/Users/me/My Pictures/a.png', null)?.src).toBe(
			'/Users/me/My%20Pictures/a.png'
		)
	})

	test('other files are not images', () => {
		expect(imageLink('/Users/me/notes/other.md', folder)).toBeNull()
		expect(imageLink('/Users/me/notes/report.pdf', folder)).toBeNull()
		expect(imageLink('/Users/me/notes/README', folder)).toBeNull()
	})
})
