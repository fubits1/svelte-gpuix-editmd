import { describe, expect, test } from 'vitest'
import { parseBlocks } from '../engine/blocks.ts'
import { HORIZONTAL_RULE, TABLE, underLastItem } from './blockCommands.ts'

describe('inserted Blocks', () => {
	test('Table is Milkdown’s default: a header row and two body rows of three empty cells', () => {
		const [table] = parseBlocks(TABLE)
		expect(table?.kind).toBe('table')
		// written out here, apart from the constant, so the test does not check TABLE against itself
		expect(TABLE).toBe('|   |   |   |\n| - | - | - |\n|   |   |   |\n|   |   |   |')
	})

	// editmd's table goes into the list item its caret is in, indented to the item's text (measured in editmd's own
	// editor: Table at the end of `- a\n- b`)
	test('a Table inserted at the end of a list goes under its last item', () => {
		expect([underLastItem('- a\n- b', TABLE), underLastItem('1. a\n  - b', '| x |')]).toEqual([
			'- a\n- b\n  |   |   |   |\n  | - | - | - |\n  |   |   |   |\n  |   |   |   |',
			'1. a\n  - b\n    | x |'
		])
	})

	test('Horizontal Rule is written as editmd writes rules', () => {
		expect(HORIZONTAL_RULE).toBe('---')
		expect(parseBlocks(`a\n\n${HORIZONTAL_RULE}\n`)[1]?.kind).toBe('thematicBreak')
	})
})
