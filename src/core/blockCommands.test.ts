import { describe, expect, test } from 'vitest'
import { parseBlocks } from '../engine/blocks.ts'
import { HORIZONTAL_RULE, TABLE } from './blockCommands.ts'

describe('inserted Blocks', () => {
	test('Table is Milkdown’s default: a header row and two body rows of three empty cells', () => {
		const [table] = parseBlocks(TABLE)
		expect(table?.kind).toBe('table')
		// written out here, apart from the constant, so the test does not check TABLE against itself
		expect(TABLE).toBe('|   |   |   |\n| - | - | - |\n|   |   |   |\n|   |   |   |')
	})

	test('Horizontal Rule is written as editmd writes rules', () => {
		expect(HORIZONTAL_RULE).toBe('---')
		expect(parseBlocks(`a\n\n${HORIZONTAL_RULE}\n`)[1]?.kind).toBe('thematicBreak')
	})
})
