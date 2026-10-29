import { describe, expect, test } from 'vitest'
import {
	AgentEditClaims,
	type AgentAuthor,
	type AgentEditPhase,
	type AgentEditReport,
	type AgentProcess,
	parseAgentEditReport,
	processAuthorOfChange
} from './agentEdits.ts'

describe('parseAgentEditReport', () => {
	test('a Claude edit before it runs', () => {
		const found = parseAgentEditReport(
			JSON.stringify({
				session_id: 'abc',
				cwd: '/Users/me/notes',
				hook_event_name: 'PreToolUse',
				transcript_path: '/Users/me/.claude/projects/x/abc.jsonl',
				tool_name: 'Edit',
				tool_input: { file_path: '/Users/me/notes/plan.md', old_string: 'a', new_string: 'b' }
			})
		)
		expect(found).toEqual({
			author: { id: 'abc', name: 'Claude · notes' },
			phase: 'before',
			paths: ['/Users/me/notes/plan.md']
		})
	})

	test('after it runs, with relative paths', () => {
		const found = parseAgentEditReport(
			JSON.stringify({
				session_id: 'abc',
				cwd: '/Users/me/notes',
				hook_event_name: 'PostToolUse',
				tool_input: { file_path: 'sub/../plan.md' }
			})
		)
		expect(found?.phase).toBe('after')
		expect(found?.paths).toEqual(['/Users/me/notes/plan.md'])
	})

	test('Codex patches name their files', () => {
		const patch =
			'*** Begin Patch\n*** Update File: a.md\n@@\n-x\n+y\n*** Add File: /abs/b.md\n+new\n*** Delete File: c.md\n*** End Patch\n'
		const found = parseAgentEditReport(
			JSON.stringify({
				session_id: 's',
				cwd: '/w',
				transcript_path: '/Users/me/.codex/sessions/s.jsonl',
				tool_name: 'apply_patch',
				tool_input: { command: ['apply_patch', patch] }
			})
		)
		expect(found?.author.name).toBe('Codex · w')
		expect(found?.paths).toEqual(['/w/a.md', '/abs/b.md'])
	})

	test('subagents and given names', () => {
		const json = JSON.stringify({
			session_id: 'abc',
			agent_id: 'x1',
			agent_type: 'Explore',
			cwd: '/w',
			tool_input: { file_path: '/w/a.md' }
		})
		expect(parseAgentEditReport(json)?.author).toEqual({
			id: 'abc/x1',
			name: 'Claude · w · Explore'
		})
		expect(parseAgentEditReport(json, { EDITMD_AGENT_NAME: 'Reviewer' })?.author.name).toBe(
			'Reviewer · Explore'
		)
	})

	// editmd's own AgentEdits.swift run on the same payloads: Foundation's
	// URL(filePath:) expands `~`, drops a trailing slash, and an empty cwd is the hook process's own folder
	test('paths and names as Foundation reads them: the root, an empty cwd, `~` and a trailing slash', () => {
		const at = { home: '/Users/me', workingDirectory: '/Users/me/hook' }
		const report = (cwd: string, file: string) =>
			parseAgentEditReport(
				JSON.stringify({ session_id: 's', cwd, tool_input: { file_path: file } }),
				{},
				at
			)
		expect([
			report('/', 'x.md'),
			report('', '/q.md'),
			report('/p', '~/q.md'),
			report('/p', '/a//b/c.md/')
		]).toEqual([
			{ author: { id: 's', name: 'Claude · /' }, phase: 'before', paths: ['/x.md'] },
			{ author: { id: 's', name: 'Claude · hook' }, phase: 'before', paths: ['/q.md'] },
			{ author: { id: 's', name: 'Claude · p' }, phase: 'before', paths: ['/Users/me/q.md'] },
			{ author: { id: 's', name: 'Claude · p' }, phase: 'before', paths: ['/a/b/c.md'] }
		])
	})

	// editmd's AgentEdits.swift run on these payloads: Swift splits
	// a patch at every newline character, trims only spaces and tabs, sorts keys by code point, and leaves a bare `~`
	test('as editmd reads patches, keys and a bare `~`', () => {
		const at = { home: '/Users/me', workingDirectory: '/hook' }
		const paths = (toolInput: unknown) =>
			parseAgentEditReport(
				JSON.stringify({ session_id: 's', cwd: '/p', tool_input: toolInput }),
				{},
				at
			)?.paths
		const patch = (body: string) => ({ input: `*** Begin Patch\n${body}\n*** End Patch` })
		expect([
			paths({ file_path: '~' }),
			paths(patch('*** Update File: a.md\u0085*** Add File: b.md')),
			paths(patch('*** Update File: a.md\u000b*** Add File: b.md')),
			paths(patch('*** Update File: a.md *** Add File: b.md')),
			paths(patch('*** Update File: ﻿a.md')),
			paths({ '😀': { path: '/em' }, '￿': { path: '/ff' } })
		]).toEqual([
			['/p/~'],
			['/p/a.md', '/p/b.md'],
			['/p/a.md', '/p/b.md'],
			['/p/a.md', '/p/b.md'],
			['/p/﻿a.md'],
			['/ff', '/em']
		])
	})

	// JSONSerialization reads a payload after a byte order mark; Foundation's path writes a NUL as `%00`
	test('a payload after a byte order mark, and a NUL in a path, as editmd reads them', () => {
		const payload = JSON.stringify({ session_id: 's', tool_input: { file_path: '/p/\u0000a' } })
		expect(parseAgentEditReport(`\u{FEFF}${payload}`)?.paths).toEqual(['/p/%00a'])
	})

	test('nothing to report', () => {
		expect(
			parseAgentEditReport('{"session_id": "abc", "tool_input": {"command": "ls"}}')
		).toBeNull()
		expect(parseAgentEditReport('{"tool_input": {"file_path": "/a.md"}}')).toBeNull()
		expect(parseAgentEditReport('not json')).toBeNull()
	})
})

describe('AgentEditClaims', () => {
	const claude: AgentAuthor = { id: '1', name: 'Claude' }
	const codex: AgentAuthor = { id: '2', name: 'Codex' }
	const claim = (author: AgentAuthor, phase: AgentEditPhase, path = '/a.md'): AgentEditReport => ({
		author,
		phase,
		paths: [path]
	})

	test("a change is the claimant's until shortly after its write", () => {
		const claims = new AgentEditClaims()
		claims.report(claim(claude, 'before'), 0)
		expect(claims.authorOfChange('/a.md', 120)).toEqual(claude) // after a permission prompt
		expect(claims.authorOfChange('/b.md', 120)).toBeNull()
		claims.report(claim(claude, 'after'), 121)
		expect(claims.authorOfChange('/a.md', 123)).toEqual(claude)
		expect(claims.authorOfChange('/a.md', 125)).toBeNull()
	})

	test('unanswered claims run out', () => {
		const claims = new AgentEditClaims()
		claims.report(claim(claude, 'before'), 0) // the write was denied
		expect(claims.authorOfChange('/a.md', 601)).toBeNull()
	})

	test('the latest claimant wins', () => {
		const claims = new AgentEditClaims()
		claims.report(claim(claude, 'before'), 0)
		claims.report(claim(codex, 'before'), 1)
		expect(claims.authorOfChange('/a.md', 2)).toEqual(codex)
		claims.report(claim(codex, 'after'), 2)
		expect(claims.authorOfChange('/a.md', 10)).toEqual(claude)
	})

	test('paths are compared through symlinks', () => {
		expect(AgentEditClaims.key('/tmp/../tmp/x.md')).toBe(AgentEditClaims.key('/private/tmp/x.md'))
	})
})

describe('processAuthorOfChange', () => {
	const agent = (pid: number, command: string, directory: string): AgentProcess => ({
		pid,
		started: 7,
		command,
		directory
	})

	test('the agent working above the file', () => {
		const found = processAuthorOfChange('/repo/docs/plan.md', [
			agent(1, 'claude', '/repo'),
			agent(2, 'zsh', '/repo/docs'),
			agent(3, 'codex', '/other')
		])
		expect(found).toEqual({ id: 'process:1:7', name: 'Claude · repo' })
	})

	test('the deepest folder wins', () => {
		const found = processAuthorOfChange('/repo/docs/plan.md', [
			agent(1, 'claude', '/repo'),
			agent(2, 'codex', '/repo/docs')
		])
		expect(found?.name).toBe('Codex · docs')
	})

	test('nobody when ambiguous or absent', () => {
		expect(
			processAuthorOfChange('/repo/a.md', [
				agent(1, 'claude', '/repo'),
				agent(2, 'claude', '/repo')
			])
		).toBeNull()
		expect(processAuthorOfChange('/repo/a.md', [agent(1, 'claude', '/rep')])).toBeNull()
		expect(processAuthorOfChange('/repo/a.md', [])).toBeNull()
	})
})
