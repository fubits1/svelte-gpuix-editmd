import { describe, expect, test } from 'vitest'
import { parseBlocks } from '../engine/blocks.ts'
import { blockLines } from './blockLines.ts'

describe('blockLines', () => {
	test('a top-level Block’s lines as written, each with the Document offset it starts at', () => {
		expect(blockLines('| a |\n| - |', 4)).toEqual([
			{ text: '| a |', at: 4 },
			{ text: '| - |', at: 10 }
		])
	})

	test('a Block inside a quote leaves out the quote’s `>` on each line after its first, its offsets past it', () => {
		const text = '> | a |\n> | - |\n>| b |\n'
		const [table] = parseBlocks(text)[0]?.children ?? []
		if (!table) throw new Error('no table in the quote')
		const lines = blockLines(text.slice(table.start, table.end), table.start, table.prefix)
		expect(lines).toEqual([
			{ text: '| a |', at: 2 },
			{ text: '| - |', at: 10 },
			{ text: '| b |', at: 17 }
		])
		expect(lines.map(({ text: line, at }) => text.slice(at, at + line.length))).toEqual(
			lines.map(({ text: line }) => line)
		)
	})
})
