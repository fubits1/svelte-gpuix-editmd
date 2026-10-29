import { expect, test } from 'vitest'
import { imagesMarkdown } from './images.ts'

test('alt text brackets are escaped in markdown', () => {
	expect(imagesMarkdown([{ src: 'a.png', alt: 'a [1]' }])).toBe('![a \\[1\\]](a.png)')
})

test('several images are separated by a space', () => {
	expect(
		imagesMarkdown([
			{ src: 'images/my%20pic.png', alt: 'my pic' },
			{ src: 'b.png', alt: 'b' }
		])
	).toBe('![my pic](images/my%20pic.png) ![b](b.png)')
})
