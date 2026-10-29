import { formatBlock, type BlockFormat } from '../core/formatBlock.ts'
import type { Command } from './shortcuts.ts'

/**
 * the Block's new source, or null where editmd's command refuses or changes nothing; `caret` is the field's caret in
 * `source`, the end of it when left out
 */
export type BlockTransform = (source: string, caret?: number) => string | null

/** the Format menu commands that rewrite the Active block's source (editmd MainMenu.swift `format()`) */
export type FormatCommand = Extract<Command, BlockFormat>

const transform =
	(command: FormatCommand): BlockTransform =>
	(source, caret) =>
		formatBlock(command, source, caret)

/** each Format menu command as a transform of one Block's source; the one list of them */
export const BLOCK_TRANSFORMS: Record<FormatCommand, BlockTransform> = {
	body: transform('body'),
	heading1: transform('heading1'),
	heading2: transform('heading2'),
	heading3: transform('heading3'),
	heading4: transform('heading4'),
	heading5: transform('heading5'),
	heading6: transform('heading6'),
	bulletList: transform('bulletList'),
	numberedList: transform('numberedList'),
	quote: transform('quote'),
	codeBlock: transform('codeBlock'),
	indent: transform('indent'),
	outdent: transform('outdent')
}

/** whether `command` is a Format menu command, so `BLOCK_TRANSFORMS` has its transform */
export function isFormatCommand(command: string): command is FormatCommand {
	return Object.hasOwn(BLOCK_TRANSFORMS, command)
}
