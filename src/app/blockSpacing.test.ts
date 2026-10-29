import { describe, expect, test } from 'vitest'
import { parseBlocks } from '../engine/blocks.ts'
import { spaceAbove, spaceAroundDeletions } from './blockSpacing.ts'

/** the size token above each Block of `text`, as `spaceAbove` picks it from the Block before */
function spacesOf(text: string): (string | null)[] {
	const blocks = parseBlocks(text)
	return blocks.map((block, index) => spaceAbove(blocks[index - 1], block))
}

describe('spaceAbove', () => {
	// editmd's `.markdown-body > :first-child { margin-top: 0 }`
	test('the first Block has no space above it, whatever its kind', () => {
		expect(spacesOf('# Title\n')).toEqual([null])
		expect(spacesOf('---\n\nText\n')).toEqual([null, 'rule-margin'])
	})

	// `p, ul, ol, blockquote, pre, table, dl { margin: 0 0 1em }`: their 1em bottom, nothing on top
	test('between two body Blocks: the 1em bottom margin of the first', () => {
		expect(spacesOf('One.\n\n- a\n\n> q\n\n```\nx\n```\n\n| a |\n| - |\n| b |\n\nTwo.\n')).toEqual([
			null,
			'block-bottom',
			'block-bottom',
			'block-bottom',
			'block-bottom',
			'block-bottom'
		])
	})

	// headings `margin: 1.6em 0 0.6em` in their own em, collapsing with the body Blocks' 1em as CSS margins do
	test('around headings: the larger of the bottom margin above and the heading’s own top, then its own bottom', () => {
		expect(
			spacesOf(
				'# One\n\nText\n\n## Two\n\nText\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\nBody\n'
			)
		).toEqual([
			null,
			'heading-1-bottom',
			'heading-2-top',
			'heading-2-bottom',
			'heading-3-top',
			'heading-4-top',
			'heading-5-top',
			'heading-6-top',
			'heading-6-bottom'
		])
	})

	// `hr { margin: 2em 0 }`
	test('a rule has 2em on either side, which outweighs a paragraph’s 1em', () => {
		expect(spacesOf('Above.\n\n---\n\nBelow.\n')).toEqual([null, 'rule-margin', 'rule-margin'])
	})

	// `.frontmatter { margin: 0 0 2rem }` sits before `.markdown-body`, whose first child has no top margin
	test('front matter keeps 2rem below it, even before a heading', () => {
		expect(spacesOf('---\ntitle: A\n---\n\n# Title\n')).toEqual([null, 'frontmatter-bottom'])
	})

	// a link definition line (`div[data-type="definition"]`) has no margin of its own
	test('a definition line has no bottom margin, so only the next Block’s top counts', () => {
		expect(spacesOf('[a]: https://a.x\n\nText\n\n[b]: https://b.x\n\n# H\n')).toEqual([
			null,
			null,
			'block-bottom',
			'heading-1-top'
		])
	})
})

/**
 * editmd's `.agent-deleted.between { height: 0; margin: 0.2rem 0; border-top: 2px }` (style.css:494-498): a line
 * whose 0.2rem margins collapse with the Blocks' around it, the larger of each pair winning
 */
describe('spaceAroundDeletions', () => {
	const [heading, paragraph, rule, frontmatter, definition] = [
		...parseBlocks('# H\n\nText\n\n---\n'),
		...parseBlocks('---\nt: a\n---\n\n[a]: https://a.x\n')
	]

	test('between two paragraphs: the paragraph’s 1em above the line, the line’s own 0.2rem below it', () => {
		expect(spaceAroundDeletions(paragraph, paragraph)).toEqual({
			above: 'block-bottom',
			below: 'deleted-margin'
		})
	})

	test('a heading or rule after the line keeps its own top margin, which outweighs 0.2rem', () => {
		expect(spaceAroundDeletions(paragraph, heading)).toEqual({
			above: 'block-bottom',
			below: 'heading-1-top'
		})
		expect(spaceAroundDeletions(heading, rule)).toEqual({
			above: 'heading-1-bottom',
			below: 'rule-margin'
		})
	})

	test('a definition line, which has no margin, leaves the line its own 0.2rem above', () => {
		expect(spaceAroundDeletions(definition, paragraph).above).toBe('deleted-margin')
	})

	// the line is then `.markdown-body`'s first child: no margin on top, and front matter's 2rem stays alone
	test('first in the Document: nothing above, or front matter’s 2rem; last: nothing below', () => {
		expect(spaceAroundDeletions(undefined, paragraph)).toEqual({
			above: null,
			below: 'deleted-margin'
		})
		expect(spaceAroundDeletions(frontmatter, paragraph).above).toBe('frontmatter-bottom')
		expect(spaceAroundDeletions(paragraph, undefined)).toEqual({
			above: 'block-bottom',
			below: null
		})
	})
})
