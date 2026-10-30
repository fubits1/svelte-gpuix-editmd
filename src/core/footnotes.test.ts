import { describe, expect, test } from 'vitest'
import { parseBlocks } from '../engine/blocks.ts'
import { footnoteContent, footnoteMark } from './footnotes.ts'

// editmd's reference is a `sup` holding the label as written, no brackets and no link (preset-gfm
// footnote/reference.ts:33-45, style.css:370-374); a run in <markdown> takes no size of its own (gap G9), so the label
// is raised with Unicode's superscript characters where they exist
describe('footnoteMark', () => {
	const markOf = (text: string) => footnoteMark(parseBlocks(text)[0]!.footnoteReferences![0]!)

	test('a reference paints its label raised, with no brackets and no link', () => {
		expect([markOf('See[^12].\n\n[^12]: a\n'), markOf('See[^note].\n\n[^note]: a\n')]).toEqual([
			'¹²',
			'ⁿᵒᵗᵉ'
		])
	})

	// a GFM footnote label holds no whitespace, so punctuation is the case to escape
	test('a character with no superscript form stays as written, its markdown punctuation escaped', () => {
		expect(markOf('Text[^Q-x*].\n\n[^Q-x*]: b\n')).toBe('Q⁻ˣ\\*')
	})
})

describe('footnoteContent', () => {
	test('continuation lines lose the four-space indent that belongs to the definition', () => {
		expect(
			footnoteContent('Second note\n    with continuation.\n\n    ```\n      code\n    ```')
		).toBe('Second note\nwith continuation.\n\n```\n  code\n```')
	})
})
