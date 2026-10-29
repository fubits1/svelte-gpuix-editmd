import { describe, expect, test } from 'vitest'
import { listAgentProcesses, parseLsofDirectories, parsePs } from './agentProcesses.ts'

describe('parsePs', () => {
	test('keeps known agents by executable name, with their start time', () => {
		const output = [
			'  412 Sat Oct 25 09:12:03 2026     /usr/local/bin/claude',
			' 9001 Sat Oct 25 10:00:00 2026     /bin/zsh',
			'77231 Sat Oct 25 11:30:59 2026     codex'
		].join('\n')

		expect(parsePs(output)).toEqual([
			{ pid: 412, started: Date.parse('Sat Oct 25 09:12:03 2026') / 1000, command: 'claude' },
			{ pid: 77231, started: Date.parse('Sat Oct 25 11:30:59 2026') / 1000, command: 'codex' }
		])
	})
})

describe('parseLsofDirectories', () => {
	test('maps each pid to its working directory from lsof -Fpn', () => {
		expect(parseLsofDirectories('p412\nfcwd\nn/Users/me/notes\np77231\nfcwd\nn/repo\n')).toEqual(
			new Map([
				[412, '/Users/me/notes'],
				[77231, '/repo']
			])
		)
	})
})

describe('listAgentProcesses', () => {
	test('runs on this machine and only ever returns known agents', () => {
		for (const process of listAgentProcesses()) {
			expect([
				'claude',
				'codex',
				'gemini',
				'aider',
				'opencode',
				'amp',
				'goose',
				'cursor-agent'
			]).toContain(process.command)
			expect(process.directory.startsWith('/')).toBe(true)
		}
	})
})
