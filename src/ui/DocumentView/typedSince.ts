import { commonEnds } from '../../core/diff.ts'
import type { Range } from '../../core/fieldSelection.ts'

/** what keys typed in a field replaced (`replaced`, in the text from before them) and what they typed */
export type TypedSince = { replaced: Range; typed: string }

/**
 * the typing that turned `base`, the field's text when a command came, into `field`, its text once the command's probe
 * found the caret at `caret`, right after the typing; null when nothing was typed there or the keys only deleted
 */
export function typedSince(base: string, field: string, caret: Range): TypedSince | null {
	const tail = field.length - caret.end
	if (caret.start !== caret.end || tail > base.length || !base.endsWith(field.slice(caret.end)))
		return null
	const end = base.length - tail
	const { start } = commonEnds(base.slice(0, end), field.slice(0, caret.end))
	const typed = field.slice(start, caret.end)
	return typed === '' ? null : { replaced: { start, end }, typed }
}
