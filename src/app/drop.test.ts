import { describe, expect, test } from 'vitest'
import { sortDrop } from './drop.ts'

describe('sortDrop', () => {
	test('images become one run of links relative to the folder; other files are to open', () => {
		expect(
			sortDrop(['/notes/images/my pic.png', '/notes/note.md', '/notes/b.jpg'], '/notes')
		).toEqual({
			markdown: '![my pic](images/my%20pic.png) ![b](b.jpg)',
			others: ['/notes/note.md']
		})
	})

	test('an untitled Document links each image by its absolute path', () => {
		expect(sortDrop(['/tmp/my pic.png'], null)).toEqual({
			markdown: '![my pic](/tmp/my%20pic.png)',
			others: []
		})
	})

	// the app tells an image by macOS's type for its extension (host/fileKinds.ts), as editmd's ImageLink does
	test('images are told by the name test it is given', () => {
		expect(sortDrop(['/n/a.heic', '/n/b.png'], '/n', (path) => path.endsWith('.heic'))).toEqual({
			markdown: '![a](a.heic)',
			others: ['/n/b.png']
		})
	})

	test('a drop without images inserts nothing', () => {
		expect(sortDrop(['/notes/a.md', '/notes/report.pdf'], '/notes')).toEqual({
			markdown: null,
			others: ['/notes/a.md', '/notes/report.pdf']
		})
	})
})
