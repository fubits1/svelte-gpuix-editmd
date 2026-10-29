import { describe, expect, test } from 'vitest'
import { parseBlocks } from '../engine/blocks.ts'
import { footnoteContent, footnoteIdentifierOf, footnoteLink } from './footnotes.ts'

describe('footnoteLink', () => {
	test('a reference becomes a link run to its definition, its label’s punctuation escaped', () => {
		// a GFM footnote label holds no whitespace, so punctuation is the case to escape
		const text = 'Text[^2-x*].\n\n[^2-x*]: b\n'
		const reference = parseBlocks(text)[0]!.footnoteReferences![0]!

		expect(footnoteLink(reference)).toBe('[\\[2\\-x\\*\\]](footnote:2-x*)')
	})

	test('the link shows the label as written and points at the parser’s normalized identifier', () => {
		const text = 'See[^Note].\n\n[^note]: a\n'
		const reference = parseBlocks(text)[0]!.footnoteReferences![0]!

		expect(footnoteLink(reference)).toBe('[\\[Note\\]](footnote:note)')
	})

	test('a footnote link names its label again; other links name none', () => {
		expect(footnoteIdentifierOf('footnote:caf%C3%A9')).toBe('café')
		expect(footnoteIdentifierOf('https://example.com')).toBeNull()
	})
})

describe('footnoteContent', () => {
	test('continuation lines lose the four-space indent that belongs to the definition', () => {
		expect(
			footnoteContent('Second note\n    with continuation.\n\n    ```\n      code\n    ```')
		).toBe('Second note\nwith continuation.\n\n```\n  code\n```')
	})
})
