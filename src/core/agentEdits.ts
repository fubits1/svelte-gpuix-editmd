// `EDITMD_AGENT_NAME` keeps editmd's name so existing hook setups work unchanged

import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix } from 'node:path'

/** An agent that edits files, as the page names it. `id` is stable for one agent session (and one subagent within it). */
export type AgentAuthor = { id: string; name: string }

/** a change nobody is credited with: editmd's UNKNOWN agent (web/src/highlights.ts), colour `agent-unknown`, listed last */
export const OUTSIDE_EDIT: AgentAuthor = { id: '', name: 'Outside edit' }

/** `before`: the tool is about to run (PreToolUse), perhaps after a permission prompt. `after`: it has run (PostToolUse). */
export type AgentEditPhase = 'before' | 'after'

/** What an agent's tool hook says it is about to edit, or has just edited. `paths` are absolute. */
export type AgentEditReport = { author: AgentAuthor; phase: AgentEditPhase; paths: string[] }

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

const PATH_KEYS = new Set(['file_path', 'notebook_path', 'path'])
const PATCH_HEADERS = ['*** Add File: ', '*** Update File: ', '*** Move to: ']

function stringField(object: { [key: string]: Json }, key: string): string | null {
	const value = object[key]
	return typeof value === 'string' ? value : null
}

/** Swift's `isNewline` characters, which editmd's `split(whereSeparator: \.isNewline)` splits a patch at */
const NEWLINES = /\r\n|[\n\v\f\r\u0085\u2028\u2029]/

/** Swift's `trimmingCharacters(in: .whitespaces)`: spaces and tabs, not U+FEFF as JavaScript's `trim` takes too */
const trimWhitespace = (text: string) => text.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, '')

function patchedFiles(text: string): string[] {
	if (!text.includes('*** Begin Patch')) return []
	return text.split(NEWLINES).flatMap((line) => {
		const header = PATCH_HEADERS.find((prefix) => line.startsWith(prefix))
		return header ? [trimWhitespace(line.slice(header.length))] : []
	})
}

/** by code point, as Swift compares strings, not by UTF-16 unit as `sort()` does */
const byCodePoint = (a: string, b: string) => {
	const [left, right] = [[...a], [...b]]
	for (let i = 0; i < Math.min(left.length, right.length); i++) {
		const difference = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!
		if (difference !== 0) return difference
	}
	return left.length - right.length
}

/** File paths in a tool's input: the fields edit tools name their file with, and the file headers of an `apply_patch` patch. */
function pathsIn(input: Json | undefined): string[] {
	const found: string[] = []
	const visit = (value: Json | undefined, key: string | null) => {
		if (Array.isArray(value)) {
			for (const item of value) visit(item, key)
		} else if (typeof value === 'string') {
			if (key !== null && PATH_KEYS.has(key)) found.push(value)
			else found.push(...patchedFiles(value))
		} else if (value !== null && typeof value === 'object') {
			for (const childKey of Object.keys(value).sort(byCodePoint)) visit(value[childKey], childKey)
		}
	}
	visit(input, null)
	return found.filter((path) => path !== '')
}

/** where relative paths in a hook payload start: the user's home for `~`, and the hook process's folder */
export type FileSystemPlace = { home?: string; workingDirectory?: string }

/** `~/…` under the home folder, as Foundation's URL(filePath:) expands it; a bare `~` is a name like any other there */
const expandHome = (path: string, home: string) =>
	path.startsWith('~/') ? home + path.slice(1) : path

/**
 * The report in a hook payload (the JSON a Claude Code or Codex hook receives on stdin),
 * or null if it names no file or no session. Agents are told apart by session, and named
 * after the harness and the folder they run in unless `EDITMD_AGENT_NAME` gives a name.
 */
export function parseAgentEditReport(
	payload: string,
	environment: Record<string, string | undefined> = {},
	{ home = homedir(), workingDirectory = process.cwd() }: FileSystemPlace = {}
): AgentEditReport | null {
	let json: Json
	try {
		// JSONSerialization reads a payload after a byte order mark too
		json = JSON.parse(payload.replace(/^\u{FEFF}/u, '')) as Json
	} catch {
		return null
	}
	if (json === null || typeof json !== 'object' || Array.isArray(json)) return null

	const session = stringField(json, 'session_id')
	if (!session) return null

	// as Foundation's URL(filePath:) reads them (AgentEdits.swift:43-46): `~` is the home folder, a relative path or an
	// empty cwd starts in this process's folder, and the standardized path has no trailing slash
	const written = stringField(json, 'cwd')
	const cwd = written === null ? null : posix.resolve(workingDirectory, expandHome(written, home))
	const paths = pathsIn(json.tool_input).map((path) => {
		const expanded = expandHome(path, home)
		const absolute = posix.resolve(
			expanded.startsWith('/') ? '/' : (cwd ?? workingDirectory),
			expanded
		)
		// Foundation's path writes a NUL, which no file name holds, as `%00`
		return absolute.replaceAll('\0', '%00')
	})
	if (paths.length === 0) return null

	let id = session
	let name: string
	const given = environment.EDITMD_AGENT_NAME
	if (given) {
		name = given
	} else {
		name = (stringField(json, 'transcript_path') ?? '').includes('/.codex/') ? 'Codex' : 'Claude'
		// the folder's last component, `/` for the root, as Foundation's `lastPathComponent`
		if (cwd !== null) name += ` · ${cwd === '/' ? '/' : posix.basename(cwd)}`
	}

	const agent = stringField(json, 'agent_id')
	if (agent) {
		id += `/${agent}`
		name += ` · ${stringField(json, 'agent_type') ?? 'subagent'}`
	}

	return {
		author: { id, name },
		phase: stringField(json, 'hook_event_name') === 'PostToolUse' ? 'after' : 'before',
		paths: [...new Set(paths)]
	}
}

export type ClaimsPolicy = {
	/** How long a claim made before writing lasts. */
	waiting: number
	/** How long a claim lasts once the agent says it has written. */
	settle: number
}

type Claim = { author: AgentAuthor; reported: number; expires: number }

function realPath(path: string): string | null {
	try {
		return realpathSync(path)
	} catch {
		return null
	}
}

/**
 * Which agent changed a file, going by the reports agents send.
 *
 * An agent reports before it writes and again after. The first report
 * claims the file for as long as the tool may wait on a permission prompt;
 * the second shortens the claim to the moment the file change takes to be
 * noticed. A change is the most recent claimant's. Changes with no live
 * claim belong to nobody known.
 */
export class AgentEditClaims {
	readonly policy: ClaimsPolicy
	/** By path, then by author id. */
	#claims = new Map<string, Map<string, Claim>>()

	constructor(policy: ClaimsPolicy = { waiting: 600, settle: 3 }) {
		this.policy = policy
	}

	/**
	 * The form both sides compare paths in: `/tmp/x` and `/private/tmp/x`,
	 * or a path through a symlinked folder, name the same file.
	 * A file that does not exist yet goes by its folder's real path.
	 */
	static key(path: string): string {
		const normalized = posix.normalize(path)
		const real = realPath(normalized)
		if (real) return real
		const folder = realPath(posix.dirname(normalized))
		return folder ? posix.join(folder, posix.basename(normalized)) : normalized
	}

	report(report: AgentEditReport, now: number): void {
		const lasts = report.phase === 'before' ? this.policy.waiting : this.policy.settle
		for (const path of report.paths) {
			const byAuthor = this.#claims.get(path) ?? new Map<string, Claim>()
			byAuthor.set(report.author.id, { author: report.author, reported: now, expires: now + lasts })
			this.#claims.set(path, byAuthor)
		}
		this.#prune(now)
	}

	/** The agent that changed the file at `path`, if any has claimed it. */
	authorOfChange(path: string, now: number): AgentAuthor | null {
		this.#prune(now)
		let latest: Claim | null = null
		for (const claim of this.#claims.get(path)?.values() ?? []) {
			if (latest === null || claim.reported > latest.reported) latest = claim
		}
		return latest?.author ?? null
	}

	#prune(now: number): void {
		for (const [path, byAuthor] of this.#claims) {
			for (const [id, claim] of byAuthor) if (claim.expires < now) byAuthor.delete(id)
			if (byAuthor.size === 0) this.#claims.delete(path)
		}
	}
}

/** A running process that may be a coding agent. `started` tells a reused pid apart; `command` is `ps -o comm=`'s name. */
export type AgentProcess = { pid: number; started: number; command: string; directory: string }

/** The display names of the agents recognized, by executable name. */
export const KNOWN_AGENTS: Record<string, string> = {
	claude: 'Claude',
	codex: 'Codex',
	gemini: 'Gemini',
	aider: 'Aider',
	opencode: 'OpenCode',
	amp: 'Amp',
	goose: 'Goose',
	'cursor-agent': 'Cursor'
}

/**
 * The agent behind a change to the file at `path` when no agent reported
 * it: the one working in the deepest folder that holds the file. Nobody,
 * if no agent works above the file, or two work in that same folder.
 */
export function processAuthorOfChange(
	path: string,
	processes: readonly AgentProcess[]
): AgentAuthor | null {
	const candidates = processes.filter(
		(process) =>
			KNOWN_AGENTS[process.command] !== undefined &&
			path.startsWith(process.directory.endsWith('/') ? process.directory : process.directory + '/')
	)
	if (candidates.length === 0) return null

	const deepest = Math.max(...candidates.map((process) => process.directory.length))
	const closest = candidates.filter((process) => process.directory.length === deepest)
	if (closest.length !== 1) return null

	const process = closest[0]!
	const folder = posix.basename(process.directory)
	return {
		id: `process:${process.pid}:${process.started}`,
		name: `${KNOWN_AGENTS[process.command]} · ${folder === '' ? '/' : folder}`
	}
}
