import { markdownToMdast, type MdastNode } from 'satteri'
import { type TextEdit, textEdits } from './merge.ts'

/** where a reference resolved to: its definition's URL and title */
type Target = { url: string; title: string | null }

type Reference = {
	start: number
	end: number
	identifier: string
	label: string
	referenceType: 'full' | 'collapsed' | 'shortcut'
	image: boolean
}

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff)

/** a definition line somewhere in the text, so a text without one is never parsed for nothing */
const DEFINITION_LINE = /^ {0,3}\[[^\]\n]+\]:/m

function walk(node: MdastNode, visit: (node: MdastNode) => void): void {
	visit(node)
	if ('children' in node) for (const child of node.children) walk(child as MdastNode, visit)
}

/** definitions by identifier, the first for a label winning as in markdown; and every reference with its span */
function referencesIn(text: string): { targets: Map<string, Target>; references: Reference[] } {
	// the parser drops a leading byte order mark, which the text's offsets still count
	const shift = text.startsWith(BYTE_ORDER_MARK) ? 1 : 0
	const targets = new Map<string, Target>()
	const references: Reference[] = []
	walk(markdownToMdast(text, { position: true }), (node) => {
		if (node.type === 'definition') {
			if (!targets.has(node.identifier)) {
				targets.set(node.identifier, { url: node.url, title: node.title ?? null })
			}
			return
		}
		if (node.type !== 'linkReference' && node.type !== 'imageReference') return
		const { position } = node
		if (!position) return
		references.push({
			start: position.start.offset! + shift,
			end: position.end.offset! + shift,
			identifier: node.identifier,
			label: node.label ?? node.identifier,
			referenceType: node.referenceType,
			image: node.type === 'imageReference'
		})
	})
	return { targets, references }
}

const sameTarget = (a: Target | undefined, b: Target | undefined) =>
	a !== undefined && b !== undefined && a.url === b.url && (a.title || null) === (b.title || null)

/** a destination as mdast-util-to-markdown writes it: in angle brackets when empty or holding whitespace */
const destination = (url: string) =>
	url === '' || /\s/.test(url) || [...url].some((char) => char <= '\u001f' || char === '\u007f')
		? `<${url}>`
		: url

const titled = (title: string | null) => (title ? ` "${title.replaceAll('"', '\\"')}"` : '')

/** the reference's text as written: what its first brackets hold, or the label for a collapsed or shortcut one */
function textOf(source: string, reference: Reference): string {
	const inner = source.slice(reference.image ? 2 : 1)
	if (reference.referenceType === 'shortcut') return inner.slice(0, -1)
	if (reference.referenceType === 'collapsed') return inner.slice(0, -3)
	return inner.slice(0, -(reference.label.length + 3))
}

/** where the span [start, end) of `before` sits in `after`, or null when an edit touched it */
function mapped(edits: readonly TextEdit[], start: number, end: number): number | null {
	let shift = 0
	for (const edit of edits) {
		if (edit.start < end && (edit.end > start || edit.start > start)) return null
		if (edit.end <= start) shift += edit.insert.length - (edit.end - edit.start)
	}
	return start + shift
}

/**
 * `after` with each reference written inline whose definition `before` had and `after` no longer has, or has
 * with another URL or title: it keeps the URL and title it resolved to, as editmd writes a reference out
 * once its definition is gone or says something else (web/src/markdown/references.ts:32-60). the references
 * come from `before`, since one whose definition is gone no longer parses as a reference; one the edit
 * itself touched is left as typed
 */
export function settleReferences(before: string, after: string): string {
	if (!DEFINITION_LINE.test(before)) return after
	const { targets: was, references } = referencesIn(before)
	const { targets } = referencesIn(after)
	const edits = textEdits(before, after)

	let settled = after
	for (const reference of references.toReversed()) {
		const target = was.get(reference.identifier)
		if (!target || sameTarget(target, targets.get(reference.identifier))) continue
		const start = mapped(edits, reference.start, reference.end)
		if (start === null) continue
		const length = reference.end - reference.start
		const source = after.slice(start, start + length)
		const inline = `${reference.image ? '!' : ''}[${textOf(source, reference)}](${destination(target.url)}${titled(target.title)})`
		settled = settled.slice(0, start) + inline + settled.slice(start + length)
	}
	return settled
}
