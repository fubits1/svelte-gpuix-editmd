import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'
import { type AgentProcess, KNOWN_AGENTS } from '../core/agentEdits.ts'
import { withUtf8Locale } from './locale.ts'

type RunningAgent = Omit<AgentProcess, 'directory'>

const PS_LINE = /^\s*(\d+)\s+(\w{3} \w{3}\s+\d+ \d{2}:\d{2}:\d{2} \d{4})\s+(.+)$/

/** `ps -o pid=,lstart=,comm=` lines of known agents; `started` in seconds tells a reused pid apart */
export function parsePs(output: string): RunningAgent[] {
	return output.split('\n').flatMap((line) => {
		const match = PS_LINE.exec(line)
		if (!match) return []
		const command = basename(match[3]!.trim())
		if (KNOWN_AGENTS[command] === undefined) return []
		return [{ pid: Number(match[1]), started: Date.parse(match[2]!) / 1000, command }]
	})
}

/** pid to working directory from `lsof -a -d cwd -Fpn` output */
export function parseLsofDirectories(output: string): Map<number, string> {
	const directories = new Map<number, string>()
	let pid: number | null = null
	for (const line of output.split('\n')) {
		if (line.startsWith('p')) pid = Number(line.slice(1))
		else if (line.startsWith('n') && pid !== null) directories.set(pid, line.slice(1))
	}
	return directories
}

function run(command: string, args: string[]): string {
	try {
		// with no locale (a Finder launch) lsof escapes a working folder's bytes outside ASCII
		return execFileSync(command, args, {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			env: withUtf8Locale(process.env)
		})
	} catch (error) {
		// lsof exits 1 when one pid vanished between calls; what it printed for the rest is still good
		return typeof error === 'object' && error !== null && 'stdout' in error
			? String(error.stdout ?? '')
			: ''
	}
}

/** this user's running coding agents and where they work (editmd's AgentEdits.runningAgents, via ps and lsof) */
export function listAgentProcesses(): AgentProcess[] {
	const agents = parsePs(
		run('ps', ['-U', String(process.getuid?.() ?? ''), '-o', 'pid=,lstart=,comm='])
	)
	if (agents.length === 0) return []

	const directories = parseLsofDirectories(
		run('lsof', ['-a', '-d', 'cwd', '-p', agents.map(({ pid }) => pid).join(','), '-Fpn'])
	)
	return agents.flatMap((agent) => {
		const directory = directories.get(agent.pid)
		return directory ? [{ ...agent, directory }] : []
	})
}
