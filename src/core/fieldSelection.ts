/**
 * a text field's selection, which gpuix does not report (gap G1), learnt and changed through the keys the field
 * takes (`simulateKeystrokes`): a sentinel character typed over the selection shows where it was in the
 * value the field reports, cmd-z puts the text and the selection back, and keys then edit around it
 */

import { type BlockKind, blockKindOf } from '../engine/blocks.ts'

/** a field's text and selection: `anchor` stays put while shift moves `focus`; equal for a caret */
export type FieldState = { text: string; anchor: number; focus: number }
export type Range = { start: number; end: number }
export type InlineFormat = 'bold' | 'italic' | 'strikethrough' | 'code'

/** the marks editmd's serializer writes for each format (strong `*`, emphasis `_`, editor.ts:82-93; GFM `~~`) */
const MARKS: Record<InlineFormat, string> = {
	bold: '**',
	italic: '_',
	strikethrough: '~~',
	code: '`'
}

/** every spelling of each format's marks that editmd's editor reads as that format, and so takes off */
const SPELLINGS: Record<InlineFormat, readonly string[]> = {
	bold: ['**', '__'],
	italic: ['_', '*'],
	strikethrough: ['~~', '~'],
	code: ['`']
}

/** Blocks whose text takes no marks: editmd's toggleMark refuses in code and HTML, and its front matter box is no part of its editor */
const MARKLESS = new Set<BlockKind>([
	'code',
	'mermaid',
	'frontmatter',
	'html',
	'definition',
	'thematicBreak'
])

/** the Block `source` holds text that Bold, Italic, Strikethrough and Inline Code can mark */
export function takesMarks(source: string): boolean {
	return !MARKLESS.has(blockKindOf(source))
}

/**
 * every selection of `before` that typing `sentinel` over could have turned into `after`: one, unless the
 * sentinel matches the text beside it
 */
export function selectionCandidates(before: string, after: string, sentinel: string): Range[] {
	const candidates: Range[] = []
	for (let at = after.indexOf(sentinel); at !== -1; at = after.indexOf(sentinel, at + 1)) {
		const head = after.slice(0, at)
		const tail = after.slice(at + 1)
		if (head.length + tail.length > before.length) continue
		if (before.startsWith(head) && before.endsWith(tail)) {
			candidates.push({ start: at, end: before.length - tail.length })
		}
	}
	return candidates
}

/** the one selection every probe allows, or null when they allow none or more than one */
export function settleSelection(probes: readonly (readonly Range[])[]): Range | null {
	const [first = [], ...rest] = probes
	const common = first.filter((range) =>
		rest.every((list) => list.some(({ start, end }) => start === range.start && end === range.end))
	)
	return common.length === 1 ? common[0]! : null
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** the offsets in `text` an arrow can stop at: every character's start, and the end */
function stops(text: string): number[] {
	return [...[...graphemes.segment(text)].map(({ index }) => index), text.length]
}

/** the stop after `at`, or the end */
const nextStop = (text: string, at: number) => stops(text).find((stop) => stop > at) ?? text.length

/** the stop before `at`, or the start */
const previousStop = (text: string, at: number) => stops(text).findLast((stop) => stop < at) ?? 0

const words = new Intl.Segmenter(undefined, { granularity: 'word' })

/**
 * the word segments a word move stops at, as GPUI's field finds them (`split_word_bound_indices`, Unicode word
 * boundaries): every segment that is not whitespace only, punctuation included
 */
function wordSegments(text: string): { start: number; end: number }[] {
	return [...words.segment(text)]
		.filter(({ segment }) => segment.trim() !== '')
		.map(({ segment, index }) => ({ start: index, end: index + segment.length }))
}

/** where alt-right takes a caret at `at`: the end of the first word segment ending after it, else the text's end */
const nextWordEnd = (text: string, at: number) =>
	wordSegments(text).find(({ end }) => end > at)?.end ?? text.length

/** where alt-left takes a caret at `at`: the start of the last word segment starting before it, else 0 */
const previousWordStart = (text: string, at: number) =>
	wordSegments(text).findLast(({ start }) => start < at)?.start ?? 0

/**
 * text a word jump may cross: Latin script, spaces and punctuation, where JavaScript's segmenter and GPUI's agree;
 * ICU tailors other scripts (CJK by dictionary), so a caret there moves by arrows only
 */
const JUMPABLE = /^[\0-ɏ]*$/

/** how many characters (arrow steps) lie between UTF-16 offsets `from` and `to` of `text` */
export const steps = (text: string, from: number, to: number) =>
	[...graphemes.segment(text.slice(Math.min(from, to), Math.max(from, to)))].length

/** the key that types `character` in a field */
const keyOf = (character: string) => (character === ' ' ? 'space' : character)

const repeat = (key: string, times: number) => Array.from({ length: times }, () => key)

/**
 * what `keys` (space separated, as `simulateKeystrokes` takes them) do to a field, as GPUI's field does them
 * (measured in a real window): a character replaces the selection, left and right collapse a selection to its start and
 * end, shift moves the focus, delete is forward
 */
export function applyKeys(state: FieldState, keys: string): FieldState {
	let { text, anchor, focus } = state
	const start = () => Math.min(anchor, focus)
	const end = () => Math.max(anchor, focus)
	const caret = (at: number) => {
		anchor = at
		focus = at
	}
	const replace = (insert: string) => {
		const at = start()
		text = text.slice(0, at) + insert + text.slice(end())
		caret(at + insert.length)
	}
	for (const key of keys.split(' ').filter(Boolean)) {
		const collapsed = anchor === focus
		// an arrow, delete and backspace step over one character, an emoji included, as GPUI's field does
		if (key === 'left') caret(collapsed ? previousStop(text, focus) : start())
		else if (key === 'right') caret(collapsed ? nextStop(text, focus) : end())
		else if (key === 'shift-left') focus = previousStop(text, focus)
		else if (key === 'shift-right') focus = nextStop(text, focus)
		else if (key === 'cmd-up') caret(0)
		else if (key === 'cmd-down') caret(text.length)
		// a word move goes from the caret (the focus), as GPUI's WordLeft and WordRight do
		else if (key === 'alt-right') caret(nextWordEnd(text, focus))
		else if (key === 'alt-left') caret(previousWordStart(text, focus))
		else if (key === 'backspace') {
			if (collapsed && focus > 0) anchor = previousStop(text, focus)
			replace('')
		} else if (key === 'delete') {
			if (collapsed && focus < text.length) focus = nextStop(text, focus)
			replace('')
		} else if (key === 'space') replace(' ')
		else if (key === 'enter') replace('\n')
		else if ([...key].length === 1) replace(key)
		else throw new Error(`no model for the key ${key}`)
	}
	return { text, anchor, focus }
}

/**
 * the keys that put the caret of a field holding `text` at UTF-16 offset `at`, the fewer of two ways: cmd-up, word
 * jumps forward while they stay short of `at`, then an arrow per character; or cmd-down and the same backward. each key
 * costs about 0.5ms in a real window, so a caret deep in a long text needs the word jumps
 */
export function caretKeys(text: string, at: number): string {
	const segments = wordSegments(text)
	let forward = 0
	const ahead: string[] = ['cmd-up']
	for (const { end } of segments) {
		if (end <= forward) continue
		if (end > at || !JUMPABLE.test(text.slice(forward, end))) break
		// a jump over one character saves nothing over an arrow, the plainer move
		ahead.push(steps(text, forward, end) === 1 ? 'right' : 'alt-right')
		forward = end
	}
	ahead.push(...repeat('right', steps(text, forward, at)))

	let backward = text.length
	const behind: string[] = ['cmd-down']
	for (const { start } of segments.toReversed()) {
		if (start >= backward) continue
		if (start < at || !JUMPABLE.test(text.slice(start, backward))) break
		behind.push(steps(text, start, backward) === 1 ? 'left' : 'alt-left')
		backward = start
	}
	behind.push(...repeat('left', steps(text, at, backward)))
	return (ahead.length <= behind.length ? ahead : behind).join(' ')
}

/**
 * the keys that select `range` (UTF-16 offsets) in a field holding `text` whose caret is anywhere: the caret, then
 * one shift-arrow per character, since the field's arrows step characters and an emoji is one (`steps`)
 */
export function selectKeys(text: string, { start, end }: Range): string {
	return [caretKeys(text, start), ...repeat('shift-right', steps(text, start, end))].join(' ')
}

/** the offset at the end of each line of `source`, where a caret on that line can sit */
export function lineEndsOf(source: string): number[] {
	const ends: number[] = []
	for (let at = source.indexOf('\n'); at !== -1; at = source.indexOf('\n', at + 1)) ends.push(at)
	return [...ends, source.length]
}

/** text a pair of `spelling` marks holds, from `start` (after the opening marks) to `end` (the closing marks) */
type Span = { spelling: string; start: number; end: number }

/** a change to a field's text: `remove` characters deleted at `at`, then `insert` typed there */
type Edit = { at: number; remove: number; insert: string }

const WORD_CHARACTER = /[\p{L}\p{N}]/u

/**
 * the pairs of `format`'s marks in `text`, line by line: a run of exactly the spelling's characters, not escaped,
 * opens before text and closes after it, and `_` opens and closes only outside a word (CommonMark's flanking rules)
 */
function spansOf(text: string, format: InlineFormat): Span[] {
	const spans: Span[] = []
	for (const spelling of SPELLINGS[format]) {
		const mark = spelling[0]!
		let open: number | null = null
		for (const { 0: run, index } of text.matchAll(new RegExp(`\\${mark}+|\\n`, 'g'))) {
			const before = text[index - 1] ?? ' '
			const after = text[index + run.length] ?? ' '
			const inWord = mark === '_' && WORD_CHARACTER.test(open === null ? before : after)
			if (run === '\n') open = null
			else if (run !== spelling || before === '\\' || inWord) continue
			else if (open === null && /\S/.test(after)) open = index + run.length
			else if (open !== null && /\S/.test(before)) {
				spans.push({ spelling, start: open, end: index })
				open = null
			}
		}
	}
	return spans
}

/**
 * the edits that take the marks of `spans` off `start`..`end`, as ProseMirror's removeMark: the marked text on either
 * side keeps its marks, with the spaces at its ends left outside them
 */
const unmarked = (text: string, spans: Span[], start: number, end: number): Edit[] =>
	spans
		.filter((span) => Math.max(span.start, start) < Math.min(span.end, end))
		.flatMap(({ spelling, start: from, end: to }) => {
			const left = text.slice(from, Math.max(from, start)).trimEnd()
			const right = text.slice(Math.min(to, end), to)
			return [
				left
					? { at: from + left.length, remove: 0, insert: spelling }
					: { at: from - spelling.length, remove: spelling.length, insert: '' },
				right.trim()
					? { at: to - right.trimStart().length, remove: 0, insert: spelling }
					: { at: to, remove: spelling.length, insert: '' }
			]
		})

/**
 * the keys that make `edits` (offsets in `text`) and then select what `start`..`end` held: from the last edit back,
 * so each edit's offset still holds, and with no newline typed, which Return would take
 */
function editKeys(text: string, edits: Edit[], start: number, end: number): string {
	const byPlace: Edit[] = []
	for (const edit of edits.toSorted((a, b) => a.at - b.at)) {
		const last = byPlace.at(-1)
		if (last?.at === edit.at) {
			byPlace[byPlace.length - 1] = {
				at: edit.at,
				remove: last.remove + edit.remove,
				insert: last.insert + edit.insert
			}
		} else byPlace.push(edit)
	}
	/** where `at` moves: a selection's start goes after text typed at it, its end before */
	const moved = (at: number, isStart: boolean) =>
		byPlace.reduce(
			(to, edit) =>
				edit.at < at || (edit.at === at && isStart)
					? to + edit.insert.length - Math.min(edit.remove, at - edit.at)
					: to,
			at
		)
	const keys: string[] = []
	let current = text
	for (const { at, remove, insert } of byPlace.toReversed()) {
		keys.push(caretKeys(current, at), ...repeat('delete', remove), ...[...insert].map(keyOf))
		current = current.slice(0, at) + insert + current.slice(at + remove)
	}
	keys.push(selectKeys(current, { start: moved(start, true), end: moved(end, false) }))
	return keys.join(' ')
}

/**
 * the keys that toggle `format` on the field's selection, as editmd's Format > Bold, Italic, Strikethrough and
 * Inline Code toggle a mark (editor.ts:95-99, ProseMirror's toggleMark): a selection that holds the mark anywhere loses
 * it, the marked text beside it keeps it; any other is wrapped in the marks and stays selected, and Inline Code
 * first takes the other marks off it (inline-code.ts:76-86); a caret gets the marks around it, so typing goes between
 * them, or loses an empty pair it sits in; Inline Code at a caret changes nothing ('')
 */
export function toggleInlineKeys(state: FieldState, format: InlineFormat): string {
	const marks = MARKS[format]
	const { text } = state
	const start = Math.min(state.anchor, state.focus)
	const end = Math.max(state.anchor, state.focus)

	if (start === end) {
		// editmd's toggleInlineCodeCommand refuses an empty selection (inline-code.ts:66)
		if (format === 'code') return ''
		/** `spelling` at `from`, and not part of a longer run of its character (a `*` of `**` is no italic's) */
		const isMarks = (from: number, spelling: string) =>
			from >= 0 &&
			text.slice(from, from + spelling.length) === spelling &&
			text[from - 1] !== spelling[0] &&
			text[from + spelling.length] !== spelling[0]
		const enclosing = SPELLINGS[format].find(
			(spelling) => isMarks(start - spelling.length, spelling) && isMarks(end, spelling)
		)
		const size = enclosing?.length ?? 0
		if (enclosing) return [...repeat('delete', size), ...repeat('backspace', size)].join(' ')
		const typed = [...marks].map(keyOf)
		return [...typed, ...typed, ...repeat('left', marks.length)].join(' ')
	}
	const taken = unmarked(text, spansOf(text, format), start, end)
	if (taken.length > 0) return editKeys(text, taken, start, end)

	// editmd's mark leaves the spaces at the selection's ends outside it
	const selected = text.slice(start, end)
	const from = start + selected.length - selected.trimStart().length
	const to = from + selected.trim().length
	if (from === to) return ''
	const others =
		format === 'code'
			? (['bold', 'italic', 'strikethrough'] as const).flatMap((other) =>
					unmarked(text, spansOf(text, other), from, to)
				)
			: []
	const wrap = [
		{ at: from, remove: 0, insert: marks },
		{ at: to, remove: 0, insert: marks }
	]
	return editKeys(text, [...others, ...wrap], from, to)
}
