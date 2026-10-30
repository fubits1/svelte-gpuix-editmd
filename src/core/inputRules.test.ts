/**
 * editmd's Milkdown input rules (preset-commonmark: heading.ts:116, blockquote.ts:61, bullet-list.ts:90,
 * ordered-list.ts:98, code-block.ts:104, hr.ts:49) turn a Block into another kind the moment its text from the start to
 * the caret matches; the port's field takes that kind's look at once
 */

import { describe, expect, test } from 'vitest'
import { caretAfterTyping, inputRuleKind } from './inputRules.ts'

/** the kind typing `field` up to its end makes, as the field reports it */
const kindAfter = (field: string) => inputRuleKind(field, field.length)

describe('inputRuleKind', () => {
	test('each of editmd’s rules makes its kind as its space or newline is typed', () => {
		expect(
			['# ', '### ', '> ', '- ', '* ', '1. ', '```js\n', '```\n', '---'].map(kindAfter)
		).toEqual([
			'heading',
			'heading',
			'blockquote',
			'list',
			'list',
			'list',
			'code',
			'code',
			'thematicBreak'
		])
	})

	test('text that only looks like a rule further in, or has no space yet, makes nothing', () => {
		expect(['a # ', '#', '1) ', 'text'].map(kindAfter)).toEqual([null, null, null, null])
	})

	// the rule reads the text up to the caret: `# ` typed in front of existing text makes the heading too
	test('a rule typed in front of text matches up to the caret', () => {
		expect(inputRuleKind('# Title', 2)).toBe('heading')
	})
})

describe('caretAfterTyping', () => {
	test('the caret sits at the end of what typing changed', () => {
		expect([caretAfterTyping('one two', 'one, two'), caretAfterTyping('ab', 'abc')]).toEqual([4, 3])
	})
})
