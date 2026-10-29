import { describe, expect, test } from 'vitest'
import { AgentColours } from './agentColours.ts'

describe('AgentColours', () => {
	test('agents get slots in order of first sight', () => {
		const colours = new AgentColours()
		expect(['a', 'b', 'c'].map((id) => colours.slotOf(id))).toEqual([0, 1, 2])
	})

	test('an agent keeps its slot after others appear', () => {
		const colours = new AgentColours()
		colours.slotOf('a')
		colours.slotOf('b')
		expect(colours.slotOf('b')).toBe(1)
		expect(colours.slotOf('a')).toBe(0)
	})

	test('the seventh agent wraps around to the first colour', () => {
		const colours = new AgentColours()
		const slots = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => colours.slotOf(id))
		expect(slots.at(-1)).toBe(0)
	})
})
