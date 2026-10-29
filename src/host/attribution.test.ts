import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import type { AgentProcess } from '../core/agentEdits.ts'
import { Attribution } from './attribution.ts'

const claude = { id: 'abc', name: 'Claude · notes' }

describe('Attribution', () => {
	test('a reported claim names the agent, through symlinked paths like /tmp', () => {
		let now = 0
		const attribution = new Attribution(
			() => [],
			() => now
		)

		attribution.report({ author: claude, phase: 'before', paths: ['/tmp/../tmp/notes.md'] })
		now = 30

		expect(attribution.authorOfChange('/private/tmp/notes.md')).toEqual(claude)
	})

	test('with no claim, the agent process working above the file is named', () => {
		const processes: AgentProcess[] = [{ pid: 7, started: 1, command: 'codex', directory: '/repo' }]
		const attribution = new Attribution(
			() => processes,
			() => 0
		)

		expect(attribution.authorOfChange('/repo/docs/plan.md')).toEqual({
			id: 'process:7:1',
			name: 'Codex · repo'
		})
	})

	// lsof reports a process's folder resolved (/private/tmp/…); editmd compares the file's resolved path too (AgentEdits.swift:32-34)
	test('the agent process is found for a file opened through a symlinked path like /tmp', () => {
		const folder = mkdtempSync('/tmp/eg-attribution-')
		const processes: AgentProcess[] = [
			{ pid: 9, started: 1, command: 'claude', directory: realpathSync(folder) }
		]
		const attribution = new Attribution(
			() => processes,
			() => 0
		)

		expect(attribution.authorOfChange(join(folder, 'notes.md'))?.id).toBe('process:9:1')
		rmSync(folder, { recursive: true, force: true })
	})

	// editmd times claims on the system's uptime (AgentEdits.swift:33,74); a wall clock set forward an hour must not end a
	// 3s claim early, nor set back one stretch it
	test('claims run on a steady clock, whatever the wall clock does', () => {
		const attribution = new Attribution(() => [])
		attribution.report({ author: claude, phase: 'after', paths: ['/repo/a.md'] })
		const wall = Date.now()
		vi.spyOn(Date, 'now').mockReturnValue(wall + 3_600_000)
		try {
			expect(attribution.authorOfChange('/repo/a.md')).toEqual(claude)
		} finally {
			vi.restoreAllMocks()
		}
	})

	test('nobody known: null, so the change shows as an outside edit', () => {
		const attribution = new Attribution(
			() => [],
			() => 0
		)

		expect(attribution.authorOfChange('/repo/a.md')).toBeNull()
	})
})
