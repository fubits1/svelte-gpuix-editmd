import { type Block, parseBlocks } from '../engine/blocks.ts'
import { type AgentAuthor, OUTSIDE_EDIT } from './agentEdits.ts'
import { diff } from './diff.ts'
import { mergeText, mergeTextMapping, type TextEdit, textEdits } from './merge.ts'
import { settleReferences } from './references.ts'
import { type ChangedRun, changedText, removedText } from './changedText.ts'

/** the Active block's text field, from click until blur or Escape; see CONTEXT.md "Edit session" */
export type EditSession = {
	/** the Slice the field starts with */
	readonly source: string
	/** a change from outside the field reached the Active block; the field does not show it, the Document does */
	readonly hasDeferredMerge: boolean
	/** where the session's text sits in the Document now; a Disk merge moves it, Blocks above it may come and go */
	readonly start: number
	readonly end: number
	/** the field's whole new value */
	update(field: string): void
	/**
	 * a change from outside reached the Active block: the text the field should show now, the field's typing and the
	 * outside change merged as editmd shows them live, with the edits from what the field showed, to carry its caret
	 * through. the field takes it as its value, so later updates go on from it. null when nothing came in
	 */
	takeOutsideChange(): { text: string; edits: TextEdit[] } | null
	close(): void
}

/**
 * where the open Edit session's text sits in the Document. `deferred` holds what the field
 * shows and the Slice as of the last outside change, so later keystrokes merge onto the Slice
 * instead of replacing it.
 */
type SessionRange = {
	start: number
	end: number
	deferred: { field: string; slice: string } | null
	/** the session's keystrokes so far, which close as one undo step */
	changes: TextChange[]
	/** Source mode's session over the whole text, where the text stays exactly as typed */
	whole: boolean
	/** opened on a Document with no text yet: its first field */
	fresh: boolean
}

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/

/**
 * the fence a Block's text leaves open, `` ``` `` or `~~~` as long as it opened, or null when every fence it opens is
 * closed (CommonMark: a closing fence is the same character, at least as long, with nothing after it)
 */
function openFence(text: string): string | null {
	let open: string | null = null
	for (const line of text.split('\n')) {
		const fence = FENCE_LINE.exec(line)
		if (!fence) continue
		const marks = fence[1]!
		const rest = fence[2]!
		if (open === null) {
			// a backtick fence's info string holds no backtick
			if (marks[0] === '`' && rest.includes('`')) continue
			open = marks
		} else if (marks[0] === open[0] && marks.length >= open.length && rest.trim() === '') {
			open = null
		}
	}
	return open
}

/** one user change, as the whole text before and after it */
type TextChange = { before: string; after: string }

/**
 * what one undo takes back: the user's changes in order. a step is a list, not one before/after pair,
 * so a Disk merge that landed between an Edit session's keystrokes is not undone with them; keystrokes
 * with nothing in between share one change, so the list grows only at such merges
 */
type UndoStep = TextChange[]

/** an Agent's colour on text a Disk merge changed; see CONTEXT.md "Agent highlight" */
/** `at` is when the change landed, in ms since the epoch, for the tooltip's time */
export type Highlight = {
	author: AgentAuthor
	start: number
	end: number
	at: number
	/**
	 * for a Block that kept its kind: the runs of its painted text that changed, which editmd marks inline instead of
	 * the whole Block (web/src/changes.ts:48-74); none for a new or retyped Block, or once the user edits it
	 */
	runs?: ChangedRun[]
	/**
	 * for a Block that only lost text: the painted text taken away, which editmd's "Deleted by" marker shows in its
	 * title (changes.ts:71-73, highlights.ts:189-219); the port marks the Block whole and names the text in its tooltip
	 */
	removed?: string
}

/**
 * Blocks a Disk merge removed, as editmd's `deleted` change (web/src/changes.ts:41-44): `offset` is where the Block
 * after them started (the text's end when none did) and follows later edits like a highlight, `at` is when the
 * change landed and `text` the removed Blocks' source, one per line. inline deletions inside a Block are not
 * recorded: native <markdown> takes no ranges to mark them in (gap G4)
 */
export type Deletion = { author: AgentAuthor; offset: number; at: number; text: string }

/** the index of the Block a Deletion at `offset` paints above: the first one that ends past it, else past the last */
export function deletionSlot(
	blocks: readonly { start: number; end: number }[],
	offset: number
): number {
	const index = blocks.findIndex((block) => block.end > offset)
	return index < 0 ? blocks.length : index
}

/**
 * where `position` in the text `edits` start from lands in the text they make; `edits` come from `textEdits`.
 * a position inside a replaced run goes to its start, or for a range's `end` to the end of what replaced it;
 * an insertion right at a range's `start` comes before the range, one at its `end` after it
 */
function mappedThrough(
	edits: readonly TextEdit[],
	position: number,
	side: 'start' | 'end'
): number {
	let shift = 0
	let at = position
	for (const edit of edits) {
		const before =
			edit.end < position || (edit.end === position && (edit.start < position || side === 'start'))
		if (before) shift += edit.insert.length - (edit.end - edit.start)
		else if (edit.start < position && position < edit.end) {
			at = side === 'start' ? edit.start : edit.start + edit.insert.length
		}
	}
	return at + shift
}

/**
 * where a field's caret at `at` lands after `takeOutsideChange`'s `edits`: text that came in right at the caret stays
 * after it, so the next key the user types goes where they left off
 */
export const caretThrough = (edits: readonly TextEdit[], at: number): number =>
	mappedThrough(edits, at, 'end')

/**
 * the text an undo step started from, with the outside changes that landed between its changes (and after the last,
 * up to `now`) merged in: what the text would be had the user typed nothing, so the step's own changes can be told
 * from an agent's
 */
function withOutsideChanges(step: UndoStep, now: string): string {
	let text = step[0]!.before
	for (const [index, change] of step.entries()) {
		const next = step[index + 1]?.before ?? now
		if (next !== change.after) text = mergeText(change.after, text, next).text
	}
	return text
}

/** the open file's text (LF line endings) and its Blocks; see CONTEXT.md */
export class Document {
	#text: string
	#blocks: Block[]
	#baseline: string
	#session: SessionRange | null = null
	#highlights: Highlight[] = []
	#deletions: Deletion[] = []
	#undoSteps: UndoStep[] = []
	#redoSteps: UndoStep[] = []

	constructor(text: string) {
		this.#text = text
		this.#baseline = text
		this.#blocks = parseBlocks(text)
	}

	get text(): string {
		return this.#text
	}

	/** the text as last loaded from or saved to disk */
	get baseline(): string {
		return this.#baseline
	}

	get isDirty(): boolean {
		return this.#text !== this.#baseline
	}

	markSaved(): void {
		this.#baseline = this.#text
	}

	/** start over from `text` as both text and Baseline (Revert to Saved): no session, no highlights or Deletions */
	reset(text: string): void {
		this.#session = null
		this.#highlights = []
		this.#deletions = []
		this.#undoSteps = []
		this.#redoSteps = []
		this.#baseline = text
		this.#setText(text)
	}

	get blocks(): readonly Block[] {
		return this.#blocks
	}

	/** replace the Slice of Block `index` with `source`; Gaps and other Blocks keep their bytes */
	editBlock(index: number, source: string): void {
		const block = this.#blockAt(index)
		this.#userSplice(block.start, block.end, source)
	}

	/** a new Block with `source` right after Block `index`, separated by a blank line; -1 puts it first */
	insertBlockAfter(index: number, source: string): void {
		if (index < 0) {
			const first = this.#blocks[0]
			// front matter only counts as such at the very top, so nothing goes above it
			if (first?.kind === 'frontmatter') return this.insertBlockAfter(0, source)
			if (!first) return this.#userSplice(0, this.#text.length, `${source}\n`)
			return this.#userSplice(first.start, first.start, `${source}\n\n`)
		}
		const block = this.#blockAt(index)
		this.#userSplice(block.end, block.end, `\n\n${source}`)
	}

	/** tick or untick the task whose mark (the character between its brackets) is at `mark` */
	toggleTask(mark: number): void {
		this.#userSplice(mark, mark + 1, this.#text[mark] === ' ' ? 'x' : ' ')
	}

	/**
	 * take back the last user change; false when there is none. an open Edit session's typing joins the
	 * history only when it closes: while its field is focused, the field's own native undo applies
	 */
	undo(): boolean {
		const step = this.#undoSteps.pop()
		if (!step) return false
		for (const change of step.toReversed()) this.#apply(change.after, change.before)
		this.#redoSteps.push(step)
		return true
	}

	/** make the last undone change again; false when there is none */
	redo(): boolean {
		const step = this.#redoSteps.pop()
		if (!step) return false
		for (const change of step) this.#apply(change.before, change.after)
		this.#undoSteps.push(step)
		return true
	}

	/** a splice by the user, outside an Edit session: one undo step; a new one ends what redo could bring back */
	#userSplice(start: number, end: number, insert: string): void {
		const before = this.#text
		this.#splice([{ start, end, insert }])
		this.#settleReferences(before)
		if (before !== this.#text) this.#push([{ before, after: this.#text }])
	}

	#push(step: UndoStep): void {
		this.#undoSteps.push(step)
		this.#redoSteps = []
	}

	/**
	 * the change from `base` to `target` merged onto the current text, so Disk merges made since stay,
	 * as editmd's Y.UndoManager tracks only the user's edits
	 */
	#apply(base: string, target: string): void {
		// nothing came in since the change: no merge needed
		const result = this.#text === base ? target : mergeText(base, this.#text, target).text
		this.#splice(textEdits(this.#text, result))
	}

	/** open Block `index` as the Active block, closing any other Edit session */
	openEdit(index: number): EditSession {
		const block = this.#blockAt(index)
		return this.#openSession(block.start, block.end)
	}

	/** Source mode's field: one Edit session over the whole text, so outside changes defer into it like a Block's */
	openSourceEdit(): EditSession {
		// over blank text it is an empty Document's first field ("Start writing…"), a Block's field in all but name
		return this.#openSession(0, this.#text.length, this.#text.trim() !== '')
	}

	#openSession(start: number, end: number, whole = false): EditSession {
		this.#endSession()
		const range: SessionRange = {
			start,
			end,
			deferred: null,
			changes: [],
			whole,
			fresh: this.#text.trim() === ''
		}
		this.#session = range

		return {
			source: this.#text.slice(start, end),
			get hasDeferredMerge() {
				return range.deferred !== null
			},
			get start() {
				return range.start
			},
			get end() {
				return range.end
			},
			update: (field) => this.#updateSession(range, field),
			takeOutsideChange: () => {
				if (this.#session !== range || range.deferred === null) return null
				const shown = range.deferred.field
				const text = this.#text.slice(range.start, range.end)
				range.deferred = null
				return { text, edits: textEdits(shown, text) }
			},
			close: () => {
				if (this.#session === range) this.#endSession()
			}
		}
	}

	/** close the open Edit session, if any, keeping its typing as one undo step */
	#endSession(): void {
		const session = this.#session
		this.#session = null
		if (!session || session.changes.length === 0) return
		const typed = this.#text
		// a fence typed and left open would make every later Block code: closed at the Block's end, as editmd's input
		// rule makes a code block of that Block alone
		const fence = session.whole ? null : openFence(this.#text.slice(session.start, session.end))
		if (fence) {
			const ending = this.#text.slice(session.start, session.end).endsWith('\n') ? '' : '\n'
			this.#splice([{ start: session.end, end: session.end, insert: `${ending}${fence}` }])
		}
		// a new document's text ends with a newline, as editmd's serializer writes every document; a file that has none
		// keeps its bytes as they are
		if (session.fresh && this.#text !== '' && !this.#text.endsWith('\n')) {
			this.#splice([{ start: this.#text.length, end: this.#text.length, insert: '\n' }])
		}
		this.#settleReferences(withOutsideChanges(session.changes, typed))
		if (this.#text !== typed) session.changes.push({ before: typed, after: this.#text })
		this.#push(session.changes)
	}

	/**
	 * after the user's change from `before`, write inline each reference whose definition the change removed or
	 * changed, as editmd does when it writes the document out (web/src/markdown/references.ts:32-60)
	 */
	#settleReferences(before: string): void {
		const settled = settleReferences(before, this.#text)
		if (settled !== this.#text) this.#splice(textEdits(this.#text, settled))
	}

	/** Agent highlights in document order; their offsets follow every later edit */
	get highlights(): readonly Highlight[] {
		return this.#highlights
	}

	/** Deletion markers in document order; their offsets follow every later edit */
	get deletions(): readonly Deletion[] {
		return this.#deletions
	}

	/** drop one Agent's highlights and Deletions, or all of them, as editmd's `clear` drops every kind of its marks */
	clearHighlights(authorId?: string): void {
		const kept = ({ author }: { author: AgentAuthor }) =>
			authorId !== undefined && author.id !== authorId
		this.#highlights = this.#highlights.filter(kept)
		this.#deletions = this.#deletions.filter(kept)
	}

	/**
	 * fold `theirs`, the file's new text on disk, into the Document; unsaved edits on both sides are kept.
	 * the Blocks the merge changed or added are highlighted for `author`, or as an Outside edit when nobody is credited.
	 * returns their new indices.
	 */
	mergeFromDisk(theirs: string, author: AgentAuthor | null = null, at = Date.now()): number[] {
		const before = this.#slices()
		const blocksBefore = this.#blocks
		const session = this.#session
		// what the open field shows, read before the merge moves the offsets
		const shown = session ? this.#shownBy(session) : ''
		let cursors = [
			...(session ? [session.start, session.end] : []),
			...this.#highlights.flatMap(({ start, end }) => [start, end]),
			...this.#deletions.map(({ offset }) => offset)
		]
		const removed = session ? this.#deletedFromOutside(session, theirs) : null
		let mine = this.#text
		if (session && removed) {
			// the deleted Block's own text in place of the typing, so the outside deletion applies cleanly
			const original = this.#baseline.slice(removed.start, removed.end)
			const delta = original.length - (session.end - session.start)
			mine = this.#text.slice(0, session.start) + original + this.#text.slice(session.end)
			cursors = cursors.map((cursor) =>
				cursor >= session.end ? cursor + delta : Math.min(cursor, session.start)
			)
		}
		// a Block field's end keeps to its own text: a section appended right after it is new Blocks, not the field's;
		// Source mode's field holds the whole text, appends included
		const merged = mergeTextMapping(
			this.#baseline,
			mine,
			theirs,
			cursors,
			new Set(session && !session.whole ? [1] : [])
		)

		// the same string object as the baseline keeps `isDirty` a reference compare when nothing local changed
		this.#setText(merged.text === theirs ? theirs : merged.text)
		this.#baseline = theirs

		const mapped = merged.cursors.slice(session ? 2 : 0)
		this.#highlights = this.#highlights.map((highlight, index) => ({
			...highlight,
			start: mapped[index * 2]!,
			end: mapped[index * 2 + 1]!
		}))
		const deletionsFrom = this.#highlights.length * 2
		this.#deletions = this.#deletions.map((deletion, index) => ({
			...deletion,
			offset: mapped[deletionsFrom + index]!
		}))
		if (session && removed) this.#keepAsOwnBlock(session, merged.cursors[0]!, shown)
		else if (session) {
			session.start = merged.cursors[0]!
			session.end = merged.cursors[1]!
			this.#deferIfChanged(session, shown)
		}

		const credited = author ?? OUTSIDE_EDIT
		const changed: number[] = []
		/** a changed Block paired with the one it was, by index, as editmd's `compareChildren` pairs them */
		const was = new Map<number, string>()
		for (const hunk of diff(before, this.#slices())) {
			for (let index = hunk.bStart; index < hunk.bEnd; index++) changed.push(index)
			// past the Blocks paired with new ones, the hunk's old Blocks are gone (editmd's changes.ts:41-44)
			const paired = Math.min(hunk.aEnd - hunk.aStart, hunk.bEnd - hunk.bStart)
			for (let i = 0; i < paired; i++) was.set(hunk.bStart + i, before[hunk.aStart + i]!)
			// front matter merges as plain text in editmd, outside the body its changes are marked in
			const removed = blocksBefore
				.slice(hunk.aStart + paired, hunk.aEnd)
				.map((block, offset) =>
					block.kind === 'frontmatter' ? '' : before[hunk.aStart + paired + offset]!
				)
				.filter((slice) => slice !== '')
			if (removed.length === 0) continue
			this.#deletions.push({
				author: credited,
				offset: this.#blocks[hunk.bEnd]?.start ?? this.#text.length,
				at,
				text: removed.join('\n')
			})
		}
		for (const index of changed) {
			const block = this.#blocks[index]!
			// editmd highlights only the body; front matter merges as plain text (web/src/editor.ts:221-226)
			if (block.kind === 'frontmatter') continue
			const previous = was.get(index)
			const now = this.#text.slice(block.start, block.end)
			const runs = previous === undefined ? null : changedText(previous, now)
			const removed = runs?.length === 0 ? removedText(previous!, now) : null
			const highlight: Highlight = { author: credited, start: block.start, end: block.end, at }
			if (runs && runs.length > 0) highlight.runs = runs
			if (removed !== null) highlight.removed = removed
			this.#highlights.push(highlight)
		}
		this.#highlights.sort((a, b) => a.start - b.start)
		this.#deletions.sort((a, b) => a.offset - b.offset)
		return changed
	}

	#blockAt(index: number): Block {
		const block = this.#blocks[index]
		if (!block) throw new RangeError(`no block ${index}`)
		return block
	}

	#slices(): string[] {
		return this.#blocks.map((block) => this.#text.slice(block.start, block.end))
	}

	#updateSession(range: SessionRange, field: string): void {
		if (this.#session !== range) throw new Error('edit session is closed')

		const source = range.deferred
			? mergeText(range.deferred.field, field, range.deferred.slice).text
			: field
		if (range.deferred) range.deferred = { field, slice: source }
		const current = this.#text.slice(range.start, range.end)
		if (source === current) return

		// per minimal edit, so a highlight inside the session (all of them in Source mode) keeps its text
		if (this.#highlights.length > 0 || this.#deletions.length > 0) {
			for (const edit of textEdits(current, source)) {
				this.#shiftHighlights(range.start + edit.start, range.start + edit.end, edit.insert.length)
			}
		}
		const before = this.#text
		this.#setText(this.#text.slice(0, range.start) + source + this.#text.slice(range.end))
		range.end = range.start + source.length

		// keystrokes with nothing from outside in between are one change: the same string object links them
		const last = range.changes.at(-1)
		if (last?.after === before) last.after = this.#text
		else range.changes.push({ before, after: this.#text })
	}

	/**
	 * the session's Block as it is in the Baseline, when `theirs` deletes it; null when it is kept, changed, or
	 * not in the Baseline at all (typed since the last save)
	 */
	#deletedFromOutside(
		session: SessionRange,
		theirs: string
	): { start: number; end: number } | null {
		const toBaseline = textEdits(this.#text, this.#baseline)
		const start = mappedThrough(toBaseline, session.start, 'start')
		const end = mappedThrough(toBaseline, session.end, 'end')
		if (end <= start) return null
		const toTheirs = textEdits(this.#baseline, theirs)
		return mappedThrough(toTheirs, end, 'end') <= mappedThrough(toTheirs, start, 'start')
			? { start, end }
			: null
	}

	/**
	 * an outside write deleted the Block being edited: the field's text goes back in as its own Block where that
	 * Block was, and the session goes on over it. editmd's rich editor drops the typing with the Block and its
	 * Source mode glues it onto the next Block; losing typing is what the port must not do
	 */
	#keepAsOwnBlock(session: SessionRange, at: number, shown: string): void {
		const before = this.#text.slice(0, at)
		const after = this.#text.slice(at)
		const prefix =
			before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
		const suffix =
			after === '' ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
		const insert = `${prefix}${shown}${suffix}`
		this.#shiftHighlights(at, at, insert.length)
		this.#setText(before + insert + after)
		session.start = at + prefix.length
		session.end = session.start + shown.length
		session.deferred = null
	}

	/** what the open field shows: the Slice, or what the field held when a Deferred merge began */
	#shownBy(session: SessionRange): string {
		return session.deferred?.field ?? this.#text.slice(session.start, session.end)
	}

	/**
	 * replace each `[start, end)` from outside the Edit session (last first, as `textEdits` gives them),
	 * keeping highlights and the session's range on their own text, with one reparse for them all
	 */
	#splice(edits: readonly TextEdit[]): void {
		if (edits.length === 0) return
		const session = this.#session
		const shown = session ? this.#shownBy(session) : ''
		let text = this.#text
		let overlapped = false
		for (const { start, end, insert } of edits) {
			this.#shiftHighlights(start, end, insert.length)
			text = text.slice(0, start) + insert + text.slice(end)
			if (!session || start >= session.end) continue

			const delta = insert.length - (end - start)
			if (end <= session.start) {
				session.start += delta
				session.end += delta
				continue
			}
			session.start = Math.min(session.start, start)
			session.end = Math.max(session.end + delta, start + insert.length)
			overlapped = true
		}
		this.#setText(text)
		if (session && overlapped) this.#deferIfChanged(session, shown)
	}

	/**
	 * widen the range to whole Blocks (an agent line appended to the active paragraph belongs to it),
	 * then a Slice that no longer matches what the field shows becomes a Deferred merge.
	 */
	#deferIfChanged(range: SessionRange, shown: string): void {
		for (const block of this.#blocks) {
			if (block.start <= range.end && range.start <= block.end) {
				range.start = Math.min(range.start, block.start)
				range.end = Math.max(range.end, block.end)
			}
		}
		const slice = this.#text.slice(range.start, range.end)
		range.deferred = slice === shown ? null : { field: shown, slice }
	}

	/**
	 * keep highlights on their text when `[start, end)` becomes `insertLength` characters, and Deletions between
	 * theirs: one at `start` stays before what is typed there, one inside the replaced text moves to its start
	 */
	#shiftHighlights(start: number, end: number, insertLength: number): void {
		const delta = insertLength - (end - start)
		for (const deletion of this.#deletions) {
			if (deletion.offset <= start) continue
			deletion.offset = deletion.offset >= end ? deletion.offset + delta : start
		}
		for (const highlight of this.#highlights) {
			if (highlight.end <= start) continue
			if (highlight.start >= end) {
				highlight.start += delta
				highlight.end += delta
			} else {
				// a start inside the replaced text moves past what replaces it, which is not the highlight's
				if (highlight.start > start) highlight.start = start + insertLength
				highlight.end = Math.max(highlight.start, highlight.end + delta)
				// its text changed under it, so the runs no longer name what is painted
				delete highlight.runs
			}
		}
		// a highlight whose text is gone is dropped, as editmd's decorations are (highlights.ts:145-150, 169-170)
		this.#highlights = this.#highlights.filter((highlight) => highlight.end > highlight.start)
	}

	#setText(text: string): void {
		this.#text = text
		this.#blocks = parseBlocks(text)
	}
}
