import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { caretAfter, FrontmatterHistory, joinFrontmatter, splitFrontmatter } from './frontmatter.ts'

describe('splitFrontmatter', () => {
	test.each([
		['yaml', '---\ntitle: A\n---\n\nBody.\n', '---\ntitle: A\n---\n', '\nBody.\n'],
		['yaml ending in ...', '---\ntitle: A\n...\nBody.\n', '---\ntitle: A\n...\n', 'Body.\n'],
		['toml', '+++\ntitle = "A"\n+++\n\nBody.\n', '+++\ntitle = "A"\n+++\n', '\nBody.\n'],
		['empty block', '---\n---\nBody.\n', '---\n---\n', 'Body.\n'],
		['crlf', '---\r\ntitle: A\r\n---\r\nBody.\r\n', '---\r\ntitle: A\r\n---\r\n', 'Body.\r\n'],
		['no front matter', '# Title\n\n---\n', '', '# Title\n\n---\n'],
		['mixed fences stay body', '---\ntitle: A\n+++\nBody.\n', '', '---\ntitle: A\n+++\nBody.\n']
	])('%s', (_name, text, frontmatter, body) => {
		expect(splitFrontmatter(text)).toEqual({ frontmatter, body })
	})
})

describe('joinFrontmatter', () => {
	test('puts one blank line between front matter and body', () => {
		expect(joinFrontmatter('---\ntitle: A\n---\n', '\n\nBody.\n')).toBe(
			'---\ntitle: A\n---\n\nBody.\n'
		)
		expect(joinFrontmatter('---\ntitle: A\n---', 'Body.\n')).toBe('---\ntitle: A\n---\n\nBody.\n')
	})

	test('an empty body leaves the front matter alone', () => {
		expect(joinFrontmatter('---\ntitle: A\n---\n', '  \n')).toBe('---\ntitle: A\n---\n')
	})

	test('no front matter returns the body unchanged', () => {
		expect(joinFrontmatter('', 'Body.\n')).toBe('Body.\n')
	})

	test('split then join restores a document with one blank line after the block', () => {
		const text = '---\ntitle: A\ntags: [x]\n---\n\nBody.\n'
		const { frontmatter, body } = splitFrontmatter(text)
		expect(joinFrontmatter(frontmatter, body)).toBe(text)
	})
})

describe('caret after undo', () => {
	test('sits at the end of what changed', () => {
		expect(caretAfter('title: AB\n', 'title: A\n')).toBe(8)
		expect(caretAfter('title: A\n', 'title: AB\n')).toBe(9)
		fc.assert(
			fc.property(fc.string(), fc.string(), fc.string(), fc.string(), (pre, a, b, post) => {
				const before = pre + a + post
				const after = pre + b + post
				const at = caretAfter(before, after)
				// Everything after the caret was there before; nothing new is left behind it.
				expect(before.endsWith(after.slice(at))).toBe(true)
				expect(at).toBeLessThanOrEqual(pre.length + b.length)
			})
		)
	})
})

describe('FrontmatterHistory', () => {
	const base = '---\ntitle: A\ntags: [x]\n---\n'

	test('undo and redo the user edit, with the caret at the end of the change', () => {
		const history = new FrontmatterHistory()
		history.reset(base)
		history.edit('---\ntitle: B\ntags: [x]\n---\n')

		// '---\n' (4) + 'title: ' (7) + the changed character (1)
		const afterChange = 12
		expect(history.undo()).toBe(afterChange)
		expect(history.text).toBe(base)
		expect(history.undo()).toBeNull()
		expect(history.redo()).toBe(afterChange)
		expect(history.text).toBe('---\ntitle: B\ntags: [x]\n---\n')
	})

	test('undo takes back the user edit but not a merge from the file', () => {
		const history = new FrontmatterHistory()
		history.reset(base)
		history.edit('---\ntitle: Mine\ntags: [x]\n---\n')
		history.update('---\ntitle: Mine\ntags: [x, y]\n---\n')

		expect(history.undo()).not.toBeNull()
		expect(history.text).toBe('---\ntitle: A\ntags: [x, y]\n---\n')
		expect(history.undo()).toBeNull()
	})

	test('a reset starts with no history', () => {
		const history = new FrontmatterHistory()
		history.reset(base)
		history.edit('---\ntitle: B\n---\n')
		history.reset('---\ntitle: C\n---\n')

		expect(history.undo()).toBeNull()
		expect(history.text).toBe('---\ntitle: C\n---\n')
	})
})
