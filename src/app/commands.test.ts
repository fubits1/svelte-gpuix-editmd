import { describe, expect, test } from 'vitest'
import { formatBlock } from '../core/formatBlock.ts'
import { isFormatCommand } from './commands.ts'

describe('the Format menu commands', () => {
	test.each([
		['heading1', 'Title', '# Title'],
		['heading2', 'Title', '## Title'],
		['heading3', 'Title', '### Title'],
		['heading4', 'Title', '#### Title'],
		['heading5', 'Title', '##### Title'],
		['heading6', 'Title', '###### Title'],
		['body', '## Title', 'Title'],
		['bulletList', 'one', '- one'],
		['numberedList', 'one', '1. one'],
		['quote', 'one', '> one'],
		['codeBlock', 'x', '```\nx\n```'],
		['indent', '- one\n- two', '- one\n  - two'],
		['outdent', '- one\n  - two', '- one\n- two']
	] as const)('%s turns %j into %j', (command, source, expected) => {
		expect(formatBlock(command, source)).toBe(expected)
	})
})

describe('isFormatCommand', () => {
	test('a Format menu command is one', () => {
		expect(isFormatCommand('heading2')).toBe(true)
		expect(isFormatCommand('codeBlock')).toBe(true)
	})

	test('commands that are not block transforms are not', () => {
		expect(isFormatCommand('save')).toBe(false)
		expect(isFormatCommand('bold')).toBe(false)
	})
})
