import { realpathSync } from 'node:fs'
import { sep } from 'node:path'
import type { AgentProcess } from '../core/agentEdits.ts'
import { listAgentProcesses } from '../host/agentProcesses.ts'

export type AgentProcessesOptions = { listAgentProcesses?: () => AgentProcess[] }

/** `path` with its symlinks followed (`/tmp` is `/private/tmp`), or as given when it cannot be resolved */
function realPathOf(path: string): string {
	try {
		return realpathSync(path)
	} catch {
		return path
	}
}

/**
 * `EDITMD_GPUIX_AGENT_ROOT=<folder>`: only the coding agents working in that folder or below it count as running
 * (`list`, the machine's `ps` and `lsof` by default), so an end-to-end run credits outside writes the same on any
 * machine: an agent the user runs elsewhere, Codex at `/` say, whose folder holds every file, is left out, and a
 * stand-in agent the run starts in its own folder still counts. unset, the app sees every agent running
 */
export function agentProcessesOptions(
	env: Record<string, string | undefined>,
	list: () => AgentProcess[] = listAgentProcesses
): AgentProcessesOptions {
	const root = env.EDITMD_GPUIX_AGENT_ROOT
	if (!root) return {}
	const roots = [root, realPathOf(root)]
	const inside = (directory: string) =>
		roots.some((folder) => directory === folder || directory.startsWith(`${folder}${sep}`))
	return { listAgentProcesses: () => list().filter(({ directory }) => inside(directory)) }
}
