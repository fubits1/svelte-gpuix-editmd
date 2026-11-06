/**
 * The ProseMirror half of editmd's sync.ts (stateOf, docOf, editTowards, syncFragment) is not ported: editmd-gpuix
 * edits source text, so documents live in a Y.Text and only the text merge applies (ADR-0004).
 */

/**
 * the merge core
 *
 * Documents are Yjs CRDTs only inside a merge, passed around within it as encoded states (`Uint8Array`s): every
 * exported function here takes text and returns new text or edits, so none of them touch the editor. The editor applies
 * the results.
 *
 * The file on disk has no CRDT history, only text. When it changes, the change is replayed as edits against the text
 * it was last known to hold (the base), and Yjs merges those edits with whatever the user did since.
 */

import * as Y from 'yjs'
import { commonEnds, diff, lines } from './diff.ts'

type State = Uint8Array

/** an encoded empty document */
const EMPTY: State = Y.encodeStateAsUpdate(new Y.Doc())

/**
 * a document holding `state`, which will write as `client`
 *
 * The id is set after loading: Yjs takes an update carrying its own id as a sign of a clash and picks a new one, but
 * continuing a history is fine.
 */
function load(state: State, client: number): Y.Doc {
	const ydoc = new Y.Doc()
	Y.applyUpdate(ydoc, state)
	ydoc.clientID = client
	return ydoc
}

// MARK: Plain text

const TEXT = 'text'
const BASE_CLIENT = 1
const MINE_CLIENT = 2
const THEIRS_CLIENT = 3

/**
 * three-way merge of plain text: both sides' changes to `base`, combined
 *
 * Where both changed the same characters, both versions are kept. `cursor`, an offset into `mine`, comes back mapped
 * into the result.
 */
export function mergeText(
	base: string,
	mine: string,
	theirs: string,
	cursor = 0
): { text: string; cursor: number } {
	const { text, cursors } = mergeTextMapping(base, mine, theirs, [cursor])
	return { text, cursor: cursors[0]! }
}

/**
 * `mergeText` mapping several offsets into `mine` at once, such as both ends of a range
 *
 * A cursor whose index is in `ends` keeps to the text before it, so what the other side inserted right there stays
 * after it (a range's end does not grow over a section appended right after the range); any other cursor keeps to the
 * text after it.
 */
export function mergeTextMapping(
	base: string,
	mine: string,
	theirs: string,
	cursors: readonly number[],
	ends: ReadonlySet<number> = new Set()
): { text: string; cursors: number[] } {
	if (theirs === base || theirs === mine) return { text: mine, cursors: [...cursors] }
	const start = load(EMPTY, BASE_CLIENT)
	start.getText(TEXT).insert(0, base)
	const baseState = Y.encodeStateAsUpdate(start)

	const ours = load(baseState, MINE_CLIENT)
	const myEdits = textEdits(base, mine)
	applyEdits(ours.getText(TEXT), myEdits)
	const anchors = cursors.map((cursor, index) =>
		Y.createRelativePositionFromTypeIndex(ours.getText(TEXT), cursor, ends.has(index) ? -1 : 0)
	)

	const theirEdits = textEdits(base, theirs)
	dropAtDeletedLineEnds(ours.getText(TEXT), base, myEdits, theirEdits)
	const other = load(baseState, THEIRS_CLIENT)
	applyEdits(other.getText(TEXT), theirEdits)

	// only what the other side added goes into ours: Yjs converges on the same text in any order, and the anchors
	// already belong to ours.
	Y.applyUpdate(ours, Y.encodeStateAsUpdate(other, Y.encodeStateVector(ours)))
	const text = ours.getText(TEXT).toString()
	const mapped = anchors.map(
		(anchor) => Y.createAbsolutePositionFromRelativePosition(anchor, ours)?.index ?? text.length
	)
	return { text, cursors: mapped }
}

/** `textEdits`' edits, last first, made on `ytext` */
function applyEdits(ytext: Y.Text, edits: readonly TextEdit[]) {
	for (const { start, end, insert } of edits) {
		/**
		 * The new text goes in before the old comes out: inserted after a deletion, Yjs anchors it past the deleted
		 * characters, where the other side's typing right after them would be ordered against it by client id ("a
		 * one" rewritten to "ONE" while " two" is typed after it merged as "a  twoONE", where editmd gives "a ONE two").
		 */
		if (insert) ytext.insert(start, insert)
		if (end > start) ytext.delete(start + insert.length, end - start)
	}
}

/**
 * the typing in `ytext` (`mine`'s edits of `base`) that sits at the end of a line the other side deleted whole, taken
 * out, as editmd's editor drops it (the kit's f-merge-open "line two" case)
 *
 * Typing anywhere else stays. Both edit lists are `textEdits`' of `base`, last first.
 */
function dropAtDeletedLineEnds(
	ytext: Y.Text,
	base: string,
	mine: readonly TextEdit[],
	theirs: readonly TextEdit[]
) {
	const deletedLines = theirs.filter(
		({ start, end, insert }) =>
			insert === '' && (start === 0 || base[start - 1] === '\n') && base[end - 1] === '\n'
	)
	const atLineEnd = (edit: TextEdit) =>
		edit.start === edit.end &&
		edit.insert !== '' &&
		base[edit.start] === '\n' &&
		deletedLines.some(({ start, end }) => start < edit.start && edit.start < end)
	// Last first, an edit's offset in `ytext` is its offset in the base moved by the edits before it.
	mine.forEach((edit, index) => {
		if (!atLineEnd(edit)) return
		const moved = mine
			.slice(index + 1)
			.reduce((delta, before) => delta + before.insert.length - (before.end - before.start), 0)
		ytext.delete(edit.start + moved, edit.insert.length)
	})
}

const isHighSurrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdbff
const isLowSurrogate = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff

/** one replacement of `from[start, end)` by `insert` */
export type TextEdit = { start: number; end: number; insert: string }

/**
 * the edits from `from` to `to`, line by line, last first so each one's offsets still hold when it is applied after
 * the ones before it
 *
 * Within each changed run of lines only the characters that differ are replaced, so two edits to different parts of
 * one line merge cleanly.
 */
export function textEdits(from: string, to: string): TextEdit[] {
	const a = lines(from)
	const b = lines(to)
	const offsets = [0]
	for (const line of a) offsets.push(offsets.at(-1)! + line.length)
	const edits: TextEdit[] = []
	for (const hunk of diff(a, b).reverse()) {
		const start = offsets[hunk.aStart]!
		const removed = from.slice(start, offsets[hunk.aEnd])
		const added = b.slice(hunk.bStart, hunk.bEnd).join('')
		const common = commonEnds(removed, added)
		let prefix = common.start
		let suffix = removed.length - common.aEnd
		// never between the two halves of a surrogate pair: Yjs writes U+FFFD for a lone half (👍 to 👎 share the first)
		if (prefix > 0 && isHighSurrogate(removed.charCodeAt(prefix - 1))) prefix--
		if (suffix > 0 && isLowSurrogate(removed.charCodeAt(removed.length - suffix))) suffix--
		edits.push({
			start: start + prefix,
			end: start + removed.length - suffix,
			insert: added.slice(prefix, added.length - suffix)
		})
	}
	return edits
}
