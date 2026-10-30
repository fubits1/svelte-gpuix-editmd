import type { BlockFormat } from '../core/formatBlock.ts'
import type { Command } from './shortcuts.ts'

/** the Format menu commands that rewrite the Active block's source (editmd MainMenu.swift `format()`) */
export type FormatCommand = Extract<Command, BlockFormat>

/** every Format menu command, the one list of them; a Record, so a command added to the type must be listed */
const FORMAT_COMMANDS: Record<FormatCommand, true> = {
	body: true,
	heading1: true,
	heading2: true,
	heading3: true,
	heading4: true,
	heading5: true,
	heading6: true,
	bulletList: true,
	numberedList: true,
	quote: true,
	codeBlock: true,
	indent: true,
	outdent: true
}

/** whether `command` is a Format menu command, which `formatBlock` carries out on the Active block's source */
export function isFormatCommand(command: string): command is FormatCommand {
	return Object.hasOwn(FORMAT_COMMANDS, command)
}
