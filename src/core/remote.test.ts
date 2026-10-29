/**
 * base and table adapted to `file:` documents: editmd's `editmd:`/`blob:` rows become `file:` rows.
 * a relative or absolute path resolves against the document's `file:` folder and is local; a `file:` URL
 * written in the document is blocked like any other scheme, as editmd blocks it (its page resolves paths
 * against `editmd:`, so only a written `file:` URL ends up on `file:`, web/src/remote.ts:15)
 */

import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { isRemote } from './remote.ts'

const base = 'file:///Users/me/notes/'

describe('isRemote', () => {
	test.each([
		['pic.png', false],
		['../img/pic.png', false],
		['/Users/me/pic.png', false],
		['//example.com/pic.png', false], // takes the page's own scheme
		['', false],
		['data:image/png;base64,iVBORw0KGgo=', false],
		['file:///tmp/pic.png', true],
		['FILE:///tmp/pic.png', true],
		['http://example.com/p.png', true],
		['https://example.com/p.png', true],
		['HTTPS://example.com/p.png', true],
		['ftp://example.com/p.png', true],
		['blob:file:///1234', true],
		['javascript:alert(1)', true]
	])('%s is remote: %s', (src, remote) => {
		expect(isRemote(src, base)).toBe(remote)
	})

	test("an address that doesn't resolve counts as remote", () => {
		expect(isRemote('pic.png', 'not a base')).toBe(true)
	})

	test('every web address is remote, whatever the base', () => {
		fc.assert(
			fc.property(fc.webUrl(), fc.constantFrom(base, 'file:///'), (url, b) => {
				expect(isRemote(url, b)).toBe(true)
			})
		)
	})

	test('every relative path is local', () => {
		const segment = fc.stringMatching(/^[a-zA-Z0-9 ._-]{1,12}$/)
		fc.assert(
			fc.property(fc.array(segment, { minLength: 1, maxLength: 4 }), (parts) => {
				expect(isRemote(parts.join('/'), base)).toBe(false)
			})
		)
	})
})
