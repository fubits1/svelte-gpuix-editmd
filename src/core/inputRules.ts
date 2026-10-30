import { type BlockKind, blockKindOf } from '../engine/blocks.ts'
import { commonEnds } from './diff.ts'

/**
 * editmd's Milkdown input rules (preset-commonmark), each matched against a Block's text from its start to the caret:
 * heading, quote, bullet list, ordered list, code fence, rule
 */
const INPUT_RULES = [
	/^(#+)\s$/,
	/^\s*>\s$/,
	/^\s*([-+*])\s$/,
	/^\s*(\d+)\.\s$/,
	/^```([a-z]*)?[\s\n]$/,
	/^(?:---|___\s|\*\*\*\s)$/
]

/** the kinds an input rule makes, whose look the open field takes at once */
export const INPUT_RULE_KINDS = new Set<BlockKind>([
	'heading',
	'list',
	'blockquote',
	'code',
	'mermaid',
	'thematicBreak'
])

/**
 * the kind an input rule turned the Block into when the field became `field` by typing up to `caret`: its text from
 * the start to the caret is a rule's and `field` parses as one of INPUT_RULE_KINDS; null for any other typing
 */
export function inputRuleKind(field: string, caret: number): BlockKind | null {
	const typed = field.slice(0, caret)
	if (!INPUT_RULES.some((rule) => rule.test(typed))) return null
	const kind = blockKindOf(field)
	return INPUT_RULE_KINDS.has(kind) ? kind : null
}

/**
 * where typing that turned the field's `before` into `after` left the caret: the end of what it changed, after the
 * text the two share at their start and before the text they share at their end
 */
export const caretAfterTyping = (before: string, after: string): number =>
	commonEnds(before, after).bEnd
