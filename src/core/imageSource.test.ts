import { describe, expect, test } from 'vitest'
import { resolveImageSource } from './imageSource.ts'

const folder = '/Users/me/notes'

describe('resolveImageSource', () => {
	test('a relative path resolves against the document folder', () => {
		expect(resolveImageSource('pic.png', folder)).toEqual({
			kind: 'local',
			path: '/Users/me/notes/pic.png'
		})
		expect(resolveImageSource('../img/a.jpg', folder)).toEqual({
			kind: 'local',
			path: '/Users/me/img/a.jpg'
		})
	})

	test('percent-encoded names are decoded', () => {
		expect(resolveImageSource('my%20pic%20%281%29.png', folder)).toEqual({
			kind: 'local',
			path: '/Users/me/notes/my pic (1).png'
		})
	})

	test('an unencoded space still finds the file', () => {
		expect(resolveImageSource('my pic.png', folder)).toEqual({
			kind: 'local',
			path: '/Users/me/notes/my pic.png'
		})
	})

	test('an absolute path stays where it points', () => {
		expect(resolveImageSource('/tmp/a.png', folder)).toEqual({ kind: 'local', path: '/tmp/a.png' })
	})

	// editmd blocks a written `file:` URL like any other scheme until Load Remote Images (web/src/remote.ts:15);
	// once allowed it loads from its path, which is what GPUI's <img> takes
	test('a file URL written in the document is blocked like a remote one, keeping its path for when it is allowed', () => {
		expect(resolveImageSource('file:///tmp/a%20b.png', folder)).toEqual({
			kind: 'remote',
			url: 'file:///tmp/a%20b.png',
			path: '/tmp/a b.png'
		})
	})

	test('untitled documents resolve against the filesystem root', () => {
		expect(resolveImageSource('pic.png', null)).toEqual({ kind: 'local', path: '/pic.png' })
		expect(resolveImageSource('/Users/me/My%20Pictures/a.png', null)).toEqual({
			kind: 'local',
			path: '/Users/me/My Pictures/a.png'
		})
	})

	test('a document at the filesystem root resolves beside it', () => {
		expect(resolveImageSource('pic.png', '/')).toEqual({ kind: 'local', path: '/pic.png' })
	})

	test('data: URLs are local and pass through unchanged', () => {
		const src = 'data:image/png;base64,iVBORw0KGgo='
		expect(resolveImageSource(src, folder)).toEqual({ kind: 'local', path: src })
	})

	test('web addresses are remote', () => {
		expect(resolveImageSource('https://example.com/p.png', folder)).toEqual({
			kind: 'remote',
			url: 'https://example.com/p.png'
		})
		expect(resolveImageSource('http://example.com/p.png', null)).toEqual({
			kind: 'remote',
			url: 'http://example.com/p.png'
		})
	})

	test('a file URL on another host has no local path, so it counts as remote', () => {
		expect(resolveImageSource('//example.com/pic.png', folder)).toEqual({
			kind: 'remote',
			url: 'file://example.com/pic.png'
		})
	})
})
