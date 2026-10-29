import { describe, expect, test } from 'vitest'
import { type AgentAuthor, OUTSIDE_EDIT } from '../core/agentEdits.ts'
import type { Deletion, Highlight } from '../core/document.ts'
import { AgentLegend } from './agentLegend.ts'

const claude: AgentAuthor = { id: 'abc', name: 'Claude · plan' }
const codex: AgentAuthor = { id: 'def', name: 'Codex' }

/** one highlight per `[author, start, end]`, in document order as `Document.highlights` keeps them */
const highlights = (...entries: [AgentAuthor, number, number][]): Highlight[] =>
	entries.map(([author, start, end]) => ({ author, start, end, at: 0 }))

describe('AgentLegend.agents', () => {
	test('lists each Agent once, in order of arrival, with its colour slot and its number of highlights', () => {
		const legend = new AgentLegend()
		// codex arrives first, although its highlight sits further down the Document
		legend.agents(highlights([codex, 20, 30]))

		expect(legend.agents(highlights([claude, 0, 5], [codex, 20, 30], [claude, 40, 50]))).toEqual([
			{ id: 'def', name: 'Codex', slot: 0, count: 1 },
			{ id: 'abc', name: 'Claude · plan', slot: 1, count: 2 }
		])
	})

	test('lists Outside edit last, in no colour slot, as editmd’s UNKNOWN agent', () => {
		const legend = new AgentLegend()

		expect(legend.agents(highlights([OUTSIDE_EDIT, 0, 5], [claude, 10, 20]))).toEqual([
			{ id: 'abc', name: 'Claude · plan', slot: 0, count: 1 },
			{ id: '', name: 'Outside edit', slot: null, count: 1 }
		])
	})

	test('an Agent keeps its slot once others’ highlights are cleared', () => {
		const legend = new AgentLegend()
		legend.agents(highlights([claude, 0, 5], [codex, 10, 20]))

		expect(legend.agents(highlights([codex, 10, 20]))).toEqual([
			{ id: 'def', name: 'Codex', slot: 1, count: 1 }
		])
	})

	// editmd's legend counts every resolved highlight, its `deleted` ones included (highlights.ts:145-150, 174-176)
	test('a Deletion counts for its Agent as a highlight does, and lists an Agent that has only Deletions', () => {
		const legend = new AgentLegend()
		const deletions: Deletion[] = [
			{ author: claude, offset: 6, at: 0, text: 'gone' },
			{ author: codex, offset: 9, at: 0, text: 'gone too' }
		]

		expect(legend.agents(highlights([claude, 0, 5]), deletions)).toEqual([
			{ id: 'abc', name: 'Claude · plan', slot: 0, count: 2 },
			{ id: 'def', name: 'Codex', slot: 1, count: 1 }
		])
	})

	test('a second Agent of the same name is named apart, as editmd’s `Agents.agent`', () => {
		const legend = new AgentLegend()
		const second: AgentAuthor = { id: 'ghi', name: 'Claude · plan' }
		const third: AgentAuthor = { id: 'jkl', name: 'Claude · plan' }

		expect(
			legend
				.agents(highlights([claude, 0, 5], [second, 10, 15], [third, 20, 25]))
				.map(({ name }) => name)
		).toEqual(['Claude · plan', 'Claude · plan (2)', 'Claude · plan (3)'])
	})
})

describe('AgentLegend.rename', () => {
	test('the new name sticks for the Agent’s later highlights', () => {
		const legend = new AgentLegend()
		legend.agents(highlights([claude, 0, 5]))

		expect(legend.rename('abc', 'Planner')).toBe(true)
		expect(legend.agents(highlights([claude, 0, 5], [claude, 10, 15]))).toEqual([
			{ id: 'abc', name: 'Planner', slot: 0, count: 2 }
		])
	})

	// editmd keeps renames app-wide and names a later change's author with them (AgentEdits.swift:35, 39-45)
	test('a name given before the Agent was seen here, in this window or another, names it once it is', () => {
		const legend = new AgentLegend(new Map([['abc', 'Planner']]))

		expect(legend.agents(highlights([claude, 0, 5], [codex, 10, 15]))).toEqual([
			{ id: 'abc', name: 'Planner', slot: 0, count: 1 },
			{ id: 'def', name: 'Codex', slot: 1, count: 1 }
		])
	})

	test('an Agent not seen here, and Outside edit, which has no id, cannot be renamed', () => {
		const legend = new AgentLegend()
		legend.agents(highlights([OUTSIDE_EDIT, 0, 5]))

		expect([legend.rename('abc', 'Planner'), legend.rename('', 'Somebody')]).toEqual([false, false])
		expect(legend.agents(highlights([OUTSIDE_EDIT, 0, 5]))[0]?.name).toBe('Outside edit')
	})
})

describe('AgentLegend.nextBlock', () => {
	const blocks = [
		{ start: 0, end: 5 },
		{ start: 7, end: 12 },
		{ start: 14, end: 20 },
		{ start: 22, end: 30 }
	]

	test('steps through the Agent’s highlighted Blocks in document order and cycles back to the first', () => {
		const legend = new AgentLegend()
		const shown = highlights([claude, 7, 12], [codex, 14, 20], [claude, 22, 30])

		expect([1, 2, 3].map(() => legend.nextBlock('abc', shown, blocks))).toEqual([1, 3, 1])
		expect(legend.nextBlock('def', shown, blocks)).toBe(2)
	})

	// editmd's `reveal` steps through every highlight of the Agent by where it starts (highlights.ts:131-142)
	test('each of the Agent’s highlights is a stop, two in one Block too, and the stop names its highlight', () => {
		const legend = new AgentLegend()
		const shown = highlights([claude, 0, 5], [claude, 0, 5], [claude, 22, 30])

		expect(
			[1, 2, 3, 4].map(() => {
				const stop = legend.nextStop('abc', shown, blocks)
				return [stop?.index, stop?.highlight === null ? null : shown.indexOf(stop!.highlight)]
			})
		).toEqual([
			[0, 0],
			[0, 1],
			[3, 2],
			[0, 0]
		])
	})

	// editmd's `reveal` steps through every resolved highlight, a deletion's place among them (highlights.ts:131-142)
	test('a Deletion is a stop at the Block it paints above, or the last Block when it paints after every one', () => {
		const legend = new AgentLegend()
		const deletions: Deletion[] = [
			{ author: claude, offset: 13, at: 0, text: 'gone' },
			{ author: claude, offset: 31, at: 0, text: 'gone at the end' }
		]

		expect(
			[1, 2, 3, 4].map(() => legend.nextBlock('abc', highlights([claude, 0, 5]), blocks, deletions))
		).toEqual([0, 2, 3, 0])
	})

	test('an Agent with no highlight left has no Block to show', () => {
		expect(new AgentLegend().nextBlock('abc', [], blocks)).toBeNull()
	})
})
