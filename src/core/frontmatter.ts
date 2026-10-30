import * as Y from 'yjs'
import { editText } from './merge.ts'

/** A leading YAML (`---`) or TOML (`+++`) block, which may be empty. */
const FRONTMATTER =
	/^(?:---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)|\+\+\+[ \t]*\r?\n(?:[\s\S]*?\r?\n)?\+\+\+)[ \t]*(?:\r?\n|$)/

/** Split a leading YAML or TOML front matter block off the markdown body. */
export function splitFrontmatter(text: string): { frontmatter: string; body: string } {
	const match = FRONTMATTER.exec(text)
	if (!match) return { frontmatter: '', body: text }
	return { frontmatter: match[0], body: text.slice(match[0].length) }
}

export function joinFrontmatter(frontmatter: string, body: string): string {
	if (!frontmatter) return body
	const withNewline = frontmatter.endsWith('\n') ? frontmatter : frontmatter + '\n'
	return body.trim() === '' ? withNewline : withNewline + '\n' + body.replace(/^\n+/, '')
}

/** Where the caret goes after `before` became `after`: the end of what changed. */
export function caretAfter(before: string, after: string): number {
	let suffix = 0
	const max = Math.min(before.length, after.length)
	while (suffix < max && before[before.length - 1 - suffix] === after[after.length - 1 - suffix])
		suffix++
	return after.length - suffix
}

/** The Yjs transaction origin for the user's typing, the only one undo tracks. */
const USER = 'user'

/**
 * The front matter's text with an undo history of its own. Like the body, it
 * keeps its text in Yjs, so that undo takes back only what the user typed:
 * text merged in from the file is applied untracked and stays when the
 * user's edits around it are undone.
 */
export class FrontmatterHistory {
	#ydoc = new Y.Doc()
	#history = this.#track()
	#value = ''

	get text(): string {
		return this.#value
	}

	/** Start over with `text` for a newly loaded document, with no history. */
	reset(text: string): void {
		this.#history.destroy()
		this.#ydoc.destroy()
		this.#ydoc = new Y.Doc()
		this.#history = this.#track()
		this.#ydoc.getText().insert(0, text)
		this.#value = text
	}

	/** The user typed: `next` is the field's whole new text. */
	edit(next: string): void {
		this.#ydoc.transact(() => editText(this.#ytext, this.#value, next), USER)
		this.#value = next
	}

	/** `text` from somewhere other than the user (a merge), not as an undoable edit. */
	update(text: string): void {
		if (text !== this.#value) editText(this.#ytext, this.#value, text)
		this.#value = text
	}

	/** Undo the user's last edit: the caret offset to restore, or null if there was none. */
	undo(): number | null {
		return this.#step(() => this.#history.undo())
	}

	redo(): number | null {
		return this.#step(() => this.#history.redo())
	}

	get #ytext(): Y.Text {
		return this.#ydoc.getText()
	}

	#track(): Y.UndoManager {
		return new Y.UndoManager(this.#ydoc.getText(), { trackedOrigins: new Set([USER]) })
	}

	#step(apply: () => ReturnType<Y.UndoManager['undo']>): number | null {
		const before = this.#value
		if (!apply()) return null
		this.#value = this.#ytext.toString()
		return caretAfter(before, this.#value)
	}
}
