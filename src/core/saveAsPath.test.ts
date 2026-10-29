import { describe, expect, test } from 'vitest'
import { saveAsPath } from './saveAsPath.ts'

describe('saveAsPath', () => {
	test('a name without a markdown extension gets .md, as editmd’s save panel adds it', () => {
		expect(saveAsPath('/Users/me/Notes', 'Plan')).toBe('/Users/me/Notes/Plan.md')
		expect(saveAsPath('/Users/me/Notes', 'v1.2 notes')).toBe('/Users/me/Notes/v1.2 notes.md')
	})

	test('a markdown extension is kept, whatever its case', () => {
		expect(saveAsPath('/Users/me', 'Plan.markdown')).toBe('/Users/me/Plan.markdown')
		expect(saveAsPath('/Users/me', 'README.MD')).toBe('/Users/me/README.MD')
	})

	// editmd's text documents are their own type (Info.plist: public.plain-text and public.data are Editor types too),
	// so NSDocument's save panel gives a name the document's own extension, or none for a file that has none
	test('a text document keeps its own type: a name without its extension gets it', () => {
		expect([
			saveAsPath('/Users/me', 'notes', '/Users/me/old.txt'),
			saveAsPath('/Users/me', 'notes.txt', '/Users/me/old.txt'),
			saveAsPath('/Users/me', 'notes.md', '/Users/me/old.txt'),
			saveAsPath('/Users/me', 'notes', '/Users/me/README'),
			saveAsPath('/Users/me', 'notes', '/Users/me/old.markdown'),
			saveAsPath('/Users/me', 'notes', null)
		]).toEqual([
			'/Users/me/notes.txt',
			'/Users/me/notes.txt',
			'/Users/me/notes.md',
			'/Users/me/notes',
			'/Users/me/notes.md',
			'/Users/me/notes.md'
		])
	})

	test('a blank name or one that names a folder has no path', () => {
		expect(saveAsPath('/Users/me', '   ')).toBeNull()
		expect(saveAsPath('/Users/me', 'a/b')).toBeNull()
		expect(saveAsPath('/Users/me', '..')).toBeNull()
	})
})
