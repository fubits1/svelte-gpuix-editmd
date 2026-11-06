import { describe, expect, test } from 'vitest'
import { splitFrontmatter } from './frontmatter.ts'

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
