import { AgentColours } from '../core/agentColours.ts'
import { type AgentAuthor, OUTSIDE_EDIT } from '../core/agentEdits.ts'
import type { ChangedRun } from '../core/changedText.ts'
import { type Deletion, deletionSlot, type Highlight } from '../core/document.ts'

/** an Agent as the legend lists it: `slot` is its colour, null for Outside edit (`agent-unknown`) */
export type LegendAgent = { id: string; name: string; slot: number | null; count: number }

/** what the window knows of an Agent from its first sight on: the name it shows and its place in arrival order */
type KnownAgent = { name: string; slot: number; arrival: number }

/** where Reveal goes: the Block, the highlight (null for a Deletion) and, for one of several changes, its first run */
type Stop = { index: number; highlight: Highlight | null; run?: ChangedRun }

/** a Block's offsets, all `nextStop` needs of it */
type BlockRange = { start: number; end: number }

/**
 * the Agents seen in this window, as editmd's `Agents` and its legend (web/src/highlights.ts): each keeps its
 * colour and its name from first sight on, a second Agent with a name already shown is named apart
 * ("Claude (2)"), and a rename sticks for the Agent's later changes. Outside edit, editmd's UNKNOWN agent, is
 * no Agent seen here: it takes no colour slot, has no id to rename and is listed last
 */
export class AgentLegend {
	#colours = new AgentColours()
	#known = new Map<string, KnownAgent>()
	/** where `nextStop` got to, per Agent, as editmd's `AgentHighlights.revealed` */
	#revealed = new Map<string, number>()
	/** the names the user gave Agents in any window, by id, which name an Agent first seen here later */
	#names: ReadonlyMap<string, string>

	/**
	 * `names` holds the renames of every window (editmd's `AgentEdits.names`, AgentEdits.swift:18-19, 35), read
	 * each time an Agent is first seen, so a change that arrives after a rename comes in under the new name
	 */
	constructor(names: ReadonlyMap<string, string> = new Map()) {
		this.#names = names
	}

	/**
	 * the legend's rows for `highlights` and `deletions`: every Agent with one, in order of arrival and Outside edit
	 * last, with how many changes it has, as editmd counts its highlights (highlights.ts:145-150): each change in a
	 * Block (`Highlight.changes`), and a Deletion as one, as editmd's `deleted` highlight. an Agent not seen before is seen now, so call this whenever either changes
	 */
	agents(highlights: readonly Highlight[], deletions: readonly Deletion[] = []): LegendAgent[] {
		const counts = new Map<string, number>()
		let outsideEdits = 0
		for (const change of [...highlights, ...deletions]) {
			const { author } = change
			const count = 'changes' in change ? (change.changes ?? 1) : 1
			if (author.id === OUTSIDE_EDIT.id) {
				outsideEdits += count
				continue
			}
			this.see(author)
			counts.set(author.id, (counts.get(author.id) ?? 0) + count)
		}
		const agents: LegendAgent[] = [...counts]
			.map(([id, count]) => ({ id, count, known: this.#known.get(id)! }))
			.sort((a, b) => a.known.arrival - b.known.arrival)
			.map(({ id, count, known }) => ({ id, name: known.name, slot: known.slot, count }))
		if (outsideEdits > 0) {
			agents.push({ id: OUTSIDE_EDIT.id, name: OUTSIDE_EDIT.name, slot: null, count: outsideEdits })
		}
		return agents
	}

	/** call the Agent with this id `name` from now on; false when it is no Agent seen here */
	rename(id: string, name: string): boolean {
		const known = this.#known.get(id)
		if (!known) return false
		known.name = name
		return true
	}

	/**
	 * the Agent's next highlight or Deletion after the one shown last, by where it starts, cycling back to the first,
	 * as editmd's `reveal` steps through every highlight (highlights.ts:131-142): the Block it is in, the highlight
	 * itself (null for a Deletion), and for a Block with several changes the run the change starts with, a stop each,
	 * so the view can scroll to it. null when the Agent has none left. a Deletion's stop is the Block it paints above,
	 * or the last Block when it paints after them all
	 */
	nextStop(
		id: string,
		highlights: readonly Highlight[],
		blocks: readonly BlockRange[],
		deletions: readonly Deletion[] = []
	): Stop | null {
		const stops: { at: number; stop: Stop }[] = []
		for (const highlight of highlights) {
			if (highlight.author.id !== id) continue
			const { start, end } = highlight
			const index = blocks.findIndex((block) => start < block.end && end > block.start)
			if (index < 0) continue
			if (!highlight.firsts) stops.push({ at: start, stop: { index, highlight } })
			for (const first of highlight.firsts ?? []) {
				stops.push({ at: start, stop: { index, highlight, run: highlight.runs![first]! } })
			}
		}
		for (const { author, offset } of deletions) {
			if (author.id !== id || blocks.length === 0) continue
			const index = Math.min(deletionSlot(blocks, offset), blocks.length - 1)
			stops.push({ at: offset, stop: { index, highlight: null } })
		}
		// a stable sort keeps two highlights starting at the same place in the order they came
		stops.sort((a, b) => a.at - b.at)
		if (stops.length === 0) return null
		const next = ((this.#revealed.get(id) ?? -1) + 1) % stops.length
		this.#revealed.set(id, next)
		return stops[next]!.stop
	}

	/**
	 * editmd's `Agents.agent`: a new Agent's colour slot, and its name, set apart from any other of the same name. call
	 * it for every merge credited to an Agent, as editmd does before it looks for changes (editor.ts:226); Outside edit
	 * takes no slot
	 */
	see(author: AgentAuthor): void {
		if (author.id === OUTSIDE_EDIT.id || this.#known.has(author.id)) return
		const given = this.#names.get(author.id) ?? author.name
		const namesakes = [...this.#known.values()].filter(
			({ name }) => name === given || name.startsWith(`${given} (`)
		)
		this.#known.set(author.id, {
			name: namesakes.length === 0 ? given : `${given} (${namesakes.length + 1})`,
			slot: this.#colours.slotOf(author.id),
			arrival: this.#known.size
		})
	}
}
