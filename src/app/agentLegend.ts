import { AgentColours } from '../core/agentColours.ts'
import { type AgentAuthor, OUTSIDE_EDIT } from '../core/agentEdits.ts'
import { type Deletion, deletionSlot, type Highlight } from '../core/document.ts'

/** an Agent as the legend lists it: `slot` is its colour, null for Outside edit (`agent-unknown`) */
export type LegendAgent = { id: string; name: string; slot: number | null; count: number }

/** what the window knows of an Agent from its first sight on: the name it shows and its place in arrival order */
type KnownAgent = { name: string; slot: number; arrival: number }

/** a Block's offsets, all `nextBlock` needs of it */
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
	/** where `nextBlock` got to, per Agent, as editmd's `AgentHighlights.revealed` */
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
	 * last, with how many it has, a Deletion counting as one as editmd counts its `deleted` highlights
	 * (highlights.ts:145-150). an Agent not seen before is seen now, so call this whenever either changes
	 */
	agents(highlights: readonly Highlight[], deletions: readonly Deletion[] = []): LegendAgent[] {
		const counts = new Map<string, number>()
		let outsideEdits = 0
		for (const { author } of [...highlights, ...deletions]) {
			if (author.id === OUTSIDE_EDIT.id) {
				outsideEdits++
				continue
			}
			this.#see(author)
			counts.set(author.id, (counts.get(author.id) ?? 0) + 1)
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
	 * as editmd's `reveal` steps through every highlight (highlights.ts:131-142): the Block it is in, and the
	 * highlight itself (null for a Deletion), so the view can scroll to its run. null when the Agent has none left.
	 * a Deletion's stop is the Block it paints above, or the last Block when it paints after them all
	 */
	nextStop(
		id: string,
		highlights: readonly Highlight[],
		blocks: readonly BlockRange[],
		deletions: readonly Deletion[] = []
	): { index: number; highlight: Highlight | null } | null {
		const stops: { at: number; index: number; highlight: Highlight | null }[] = []
		for (const highlight of highlights) {
			if (highlight.author.id !== id) continue
			const { start, end } = highlight
			const index = blocks.findIndex((block) => start < block.end && end > block.start)
			if (index >= 0) stops.push({ at: start, index, highlight })
		}
		for (const { author, offset } of deletions) {
			if (author.id === id && blocks.length > 0)
				stops.push({
					at: offset,
					index: Math.min(deletionSlot(blocks, offset), blocks.length - 1),
					highlight: null
				})
		}
		// a stable sort keeps two highlights starting at the same place in the order they came
		stops.sort((a, b) => a.at - b.at)
		if (stops.length === 0) return null
		const next = ((this.#revealed.get(id) ?? -1) + 1) % stops.length
		this.#revealed.set(id, next)
		const { index, highlight } = stops[next]!
		return { index, highlight }
	}

	/** the Block of `nextStop`, for a view that scrolls to Blocks only */
	nextBlock(
		id: string,
		highlights: readonly Highlight[],
		blocks: readonly BlockRange[],
		deletions: readonly Deletion[] = []
	): number | null {
		return this.nextStop(id, highlights, blocks, deletions)?.index ?? null
	}

	/** editmd's `Agents.agent`: a new Agent's colour slot, and its name, set apart from any other of the same name */
	#see(author: AgentAuthor): void {
		if (this.#known.has(author.id)) return
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
