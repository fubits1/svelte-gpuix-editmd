import { blur, get_native, type HighlightSpec, TextSearch } from 'gpuix-svelte'
import {
	anchoredIndex,
	type Direction,
	type Match,
	matchesFrom,
	steppedIndex,
	type Wash
} from './findMatches.ts'
import type { Palette } from './palette.ts'

type FindOptions = {
	/** the washes the last frame painted; native's `getPaintedHighlights` by default */
	readWashes?: () => readonly Wash[]
	/** ms between two reads of the paint while a query is set */
	pollInterval?: number
}

const paintedWashes = (): readonly Wash[] => get_native()?.getPaintedHighlights() ?? []

/**
 * editmd's Find (Edit > Find, Cmd-F, Cmd-G, Cmd-Shift-G): the find bar's state and the matches it steps
 * through, case-insensitive and wrapping. its own class rather than fields on DocumentController, as
 * ADR-0011 names it: the bar is window chrome whose query and visibility outlive any one Document's text,
 * and the matches are read back from native's paint, which DocumentController never touches.
 * `TextSearch` holds the query and builds the `highlight` spec; the count and the active match are this
 * class's own, because TextSearch counts through `matchCount`, which is 0 for <markdown> (`findMatches.ts`)
 */
class FindController {
	#search = new TextSearch()
	#readWashes: () => readonly Wash[]
	#pollInterval: number
	/** the match active when the query last changed, which the next read re-finds (`anchoredIndex`) */
	#anchor: Match | null = null
	#reanchor = false
	/** an empty read right after a query change may be a frame painted before it, so the first is skipped */
	#skipEmpty = false
	/** set by the view, which alone holds the Blocks' nodes to scroll */
	#revealMatch: ((match: Match) => void) | null = null
	/** the texts other highlights wash in the same paint (an Agent's changed runs), which are no match of Find's */
	#foreignTexts: ReadonlySet<string> = new Set()
	/** the bar shows, above the document */
	visible = $state(false)
	/** what the field mounts with; typing does not write it back, so the caret stays where the user put it */
	fieldSource = $state('')
	/** bumped to mount a fresh field: Cmd-F focuses it, Shift-Enter takes back the newline it typed */
	fieldRevision = $state(0)
	/** every match, in native's `activeIndex` order */
	matches = $state.raw<readonly Match[]>([])
	/** the active match's index into `matches`, 0-based like `activeIndex` */
	active = $state(0)
	total = $derived(this.matches.length)
	/** editmd turns the field's text red when the query matches nothing (`setResult(found: false)`) */
	notFound = $derived(this.#search.query !== '' && this.matches.length === 0)

	constructor({ readWashes = paintedWashes, pollInterval = 100 }: FindOptions = {}) {
		this.#readWashes = readWashes
		this.#pollInterval = pollInterval
	}

	get query(): string {
		return this.#search.query
	}

	/**
	 * the `highlight` for the container of every painted Block, in `palette`'s colours: only the active match is marked,
	 * in `find-active`, as editmd's WebKit find indicator marks only the match it lands on (editmd's screenshot); the
	 * other matches take a transparent wash, so they are still painted and counted, and Cmd-G still has matches to step
	 * through after Done
	 */
	highlight(palette: Palette): HighlightSpec | null {
		const spec = this.#search.spec
		if (!spec) return null
		return {
			...spec,
			activeIndex: this.active,
			color: 'transparent',
			activeColor: palette['find-active']
		}
	}

	/**
	 * Edit > Find, Cmd-F: shows the bar and focuses its field, its query selected, as NSSearchField selects its text when
	 * it becomes first responder; the view selects it through the field's own keys (`takeSelectQuery`)
	 */
	show(): void {
		this.visible = true
		this.fieldSource = this.#search.query
		this.#selectQuery = this.#search.query !== ''
		this.fieldRevision++
	}

	/** the field mounted by `show` holds a query to select; read once, by the field it was mounted for */
	#selectQuery = false

	/** whether the field just mounted should select its query, which only `show` asks for; true once */
	takeSelectQuery(): boolean {
		const select = this.#selectQuery
		this.#selectQuery = false
		return select
	}

	/** Escape in the field, or Done: hides the bar and hands the keys back to the document */
	close(): void {
		this.visible = false
		blur()
	}

	/**
	 * the field's text changed. Shift-Enter arrives here too: the field is a one-row <textarea>, whose
	 * `onsubmit` takes Enter and leaves Shift-Enter to insert a newline, where an <input> swallows Shift-Enter
	 * without any event. a newline is never part of a query, so the field remounts without it
	 */
	typeInField(value: string): void {
		if (!value.includes('\n')) {
			this.#setQuery(value)
			return
		}
		const query = value.replaceAll('\n', '')
		this.fieldSource = query
		this.fieldRevision++
		if (query === this.#search.query) this.previous()
		else this.#setQuery(query)
	}

	/**
	 * the search field's clear button (NSSearchField's cancel button, EditorWindowController.swift:240): the query
	 * empties, and a fresh field mounts empty and focused
	 */
	clear(): void {
		this.fieldSource = ''
		this.fieldRevision++
		this.#setQuery('')
	}

	/** Enter in the field, the right chevron */
	next(): void {
		this.#step('next')
	}

	/** Shift-Enter in the field, the left chevron */
	previous(): void {
		this.#step('previous')
	}

	/** Edit > Find Next and Find Previous, Cmd-G and Cmd-Shift-G: search again, or show the bar to type a query */
	findAgain(direction: Direction): void {
		if (this.#search.query === '') this.show()
		else this.#step(direction)
	}

	/**
	 * the texts the view washes with highlights of its own (an Agent's changed runs, which paint every occurrence of
	 * their text, transparent but the one): native lists those washes with Find's, so they are left out of its matches,
	 * unless one spells part of the query, which a stale Find wash could
	 */
	setForeignTexts(texts: Iterable<string>): void {
		this.#foreignTexts = new Set(texts)
	}

	/** the view scrolls the active match, as painted, into view; returns the unsubscribe */
	onReveal(reveal: (match: Match) => void): () => void {
		this.#revealMatch = reveal
		return () => {
			if (this.#revealMatch === reveal) this.#revealMatch = null
		}
	}

	/**
	 * reads the paint while a query is set, so the count follows typing, edits and Disk merges; returns the
	 * stop. gpuix has no paint event, so this polls, like its own window size; the view that paints the
	 * highlight calls it from an `$effect`
	 */
	start(): () => void {
		const poll = setInterval(() => this.#read(), this.#pollInterval)
		return () => clearInterval(poll)
	}

	#setQuery(query: string): void {
		if (query === this.#search.query) return
		this.#anchor = this.matches[this.active] ?? null
		this.#reanchor = true
		this.#skipEmpty = true
		this.#search.query = query
	}

	#step(direction: Direction): void {
		this.#read()
		if (this.matches.length === 0) return
		this.active = steppedIndex(this.active, this.matches.length, direction)
		this.#reveal()
	}

	/** the matches as last painted; a frame that still shows an earlier query changes nothing */
	#read(): void {
		const query = this.#search.query
		if (query === '') {
			if (this.matches.length > 0) this.matches = []
			this.active = 0
			return
		}
		const needle = query.toLowerCase()
		const washes = this.#readWashes().filter(({ text, start, end }) => {
			const piece = text.slice(start, end)
			return !this.#foreignTexts.has(piece) || needle.includes(piece.toLowerCase())
		})
		const matches = matchesFrom(washes, query)
		if (!matches) return
		if (matches.length === 0 && this.#skipEmpty) {
			this.#skipEmpty = false
			return
		}
		this.#skipEmpty = false
		if (!sameMatches(matches, this.matches)) this.matches = matches
		if (this.#reanchor && matches.length > 0) {
			this.#reanchor = false
			this.active = anchoredIndex(matches, this.#anchor)
			this.#reveal()
			return
		}
		this.active = Math.min(this.active, Math.max(matches.length - 1, 0))
	}

	#reveal(): void {
		const match = this.matches[this.active]
		if (match) this.#revealMatch?.(match)
	}
}

function sameMatches(left: readonly Match[], right: readonly Match[]): boolean {
	return (
		left.length === right.length &&
		left.every(
			(match, index) =>
				match.elementId === right[index]?.elementId && match.start === right[index]?.start
		)
	)
}

/** the one window's FindController (one window per process, ADR-0008) */
export const findController = new FindController()
