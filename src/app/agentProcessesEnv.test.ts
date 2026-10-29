import { describe, expect, test } from 'vitest'
import type { AgentProcess } from '../core/agentEdits.ts'
import { agentProcessesOptions } from './agentProcessesEnv.ts'

const agent = (pid: number, directory: string): AgentProcess => ({
	pid,
	started: 1,
	command: 'claude',
	directory
})

describe('agentProcessesOptions', () => {
	test('no EDITMD_GPUIX_AGENT_ROOT, no option: the app sees every agent running on the machine', () => {
		expect(agentProcessesOptions({})).toEqual({})
	})

	test('with it, only the agents working in that folder or below it count; one at / or beside it does not', () => {
		const running = [
			agent(1, '/'),
			agent(2, '/tmp/eg-run'),
			agent(3, '/tmp/eg-run/scratch'),
			agent(4, '/tmp/eg-running')
		]
		const options = agentProcessesOptions({ EDITMD_GPUIX_AGENT_ROOT: '/tmp/eg-run' }, () => running)
		expect(options.listAgentProcesses?.().map(({ pid }) => pid)).toEqual([2, 3])
	})
})
