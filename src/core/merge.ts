/**
 * the ProseMirror half of editmd's sync.ts (stateOf, docOf, editTowards, syncFragment) is not ported: editmd-gpuix
 * edits source text, so documents live in a Y.Text and only the text merge applies (ADR-0004)
 */

// The merge core. Documents are Yjs CRDTs, passed around as encoded states
// (`Uint8Array`s): every function here takes states and returns new ones, so
// none of them touch the editor. The editor applies the results.
//
// The file on disk has no CRDT history, only text. When it changes, the
// change is replayed as edits against the state it was last known to hold
// (the base), and Yjs merges those edits with whatever the user did since.

import * as Y from 'yjs'
import { diff, lines } from './diff.ts'

type State = Uint8Array

/** An encoded empty document. */
const EMPTY: State = Y.encodeStateAsUpdate(new Y.Doc())

/** Everything in both states. */
function merge(a: State, b: State): State {
	return Y.mergeUpdates([a, b])
}

/**
 * A document holding `state`, which will write as `client`. The id is set
 * after loading: Yjs takes an update carrying its own id as a sign of a
 * clash and picks a new one, but continuing a history is fine.
 */
function load(state: State, client?: number): Y.Doc {
	const ydoc = new Y.Doc()
	Y.applyUpdate(ydoc, state)
	if (client !== undefined) ydoc.clientID = client
	return ydoc
}

// MARK: Plain text

const TEXT = 'text'
const BASE_CLIENT = 1
const MINE_CLIENT = 2
const THEIRS_CLIENT = 3

/**
 * Three-way merge of plain text: both sides' changes to `base`, combined.
 * Where both changed the same characters, both versions are kept. `cursor`, an
 * offset into `mine`, comes back mapped into the result.
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
 * `mergeText` mapping several offsets into `mine` at once, such as both ends of a range. a cursor whose index is in
 * `ends` keeps to the text before it, so what the other side inserted right there stays after it (a range's end does
 * not grow over a section appended right after the range); any other cursor keeps to the text after it
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
	editText(ours.getText(TEXT), base, mine)
	const anchors = cursors.map((cursor, index) =>
		Y.createRelativePositionFromTypeIndex(ours.getText(TEXT), cursor, ends.has(index) ? -1 : 0)
	)

	const other = load(baseState, THEIRS_CLIENT)
	editText(other.getText(TEXT), base, theirs)

	const result = load(merge(Y.encodeStateAsUpdate(ours), Y.encodeStateAsUpdate(other)))
	const text = result.getText(TEXT).toString()
	const mapped = anchors.map(
		(anchor) => Y.createAbsolutePositionFromRelativePosition(anchor, result)?.index ?? text.length
	)
	return { text, cursors: mapped }
}

/**
 * Edit `ytext` from `from` to `to`, line by line. Within each changed run of
 * lines only the characters that differ are replaced, so two edits to
 * different parts of one line merge cleanly.
 */
export function editText(ytext: Y.Text, from: string, to: string) {
	for (const { start, end, insert } of textEdits(from, to)) {
		// the new text goes in before the old comes out: inserted after a deletion, Yjs anchors it past the deleted
		// characters, where the other side's typing right after them would be ordered against it by client id ("a
		// one" rewritten to "ONE" while " two" is typed after it merged as "a  twoONE", where editmd gives "a ONE two")
		if (insert) ytext.insert(start, insert)
		if (end > start) ytext.delete(start + insert.length, end - start)
	}
}

const isHighSurrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdbff
const isLowSurrogate = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff

/** one replacement of `from[start, end)` by `insert` */
export type TextEdit = { start: number; end: number; insert: string }

/**
 * the edits `editText` makes, last first so each one's offsets still hold
 * when it is applied after the ones before it
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
		let prefix = 0
		while (prefix < removed.length && prefix < added.length && removed[prefix] === added[prefix])
			prefix++
		let suffix = 0
		while (
			suffix < removed.length - prefix &&
			suffix < added.length - prefix &&
			removed[removed.length - 1 - suffix] === added[added.length - 1 - suffix]
		)
			suffix++
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
