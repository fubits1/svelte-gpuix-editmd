import { describe, expect, test, vi } from 'vitest'
import { Attribution } from './attribution.ts'

const claude = { id: 'abc', name: 'Claude · notes' }

describe('Attribution', () => {
	test('a reported claim names the agent, through symlinked paths like /tmp', () => {
		let now = 0
		const attribution = new Attribution(() => now)

		attribution.report({ author: claude, phase: 'before', paths: ['/tmp/../tmp/notes.md'] })
		now = 30

		expect(attribution.authorOfChange('/private/tmp/notes.md')).toEqual(claude)
	})

	// editmd times claims on the system's uptime (AgentEdits.swift:33,74); a wall clock set forward an hour must not end a
	// 3s claim early, nor set back one stretch it
	test('claims run on a steady clock, whatever the wall clock does', () => {
		const attribution = new Attribution()
		attribution.report({ author: claude, phase: 'after', paths: ['/repo/a.md'] })
		const wall = Date.now()
		vi.spyOn(Date, 'now').mockReturnValue(wall + 3_600_000)
		try {
			expect(attribution.authorOfChange('/repo/a.md')).toEqual(claude)
		} finally {
			vi.restoreAllMocks()
		}
	})

	/**
	 * A change nobody reported is an Outside edit, whatever runs above the file: a guess from the running agent
	 * processes, which editmd makes (AgentEdits.swift:29-37), would credit the user's own edit in another editor to an
	 * agent working in a folder above it.
	 */
	test('a change no agent reported is credited to nobody', () => {
		const attribution = new Attribution(() => 0)

		expect(attribution.authorOfChange('/repo/a.md')).toBeNull()
	})
})
