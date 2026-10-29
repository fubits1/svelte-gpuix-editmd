import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { listenForReports } from '../host/agentIpc.ts'
import { reportEdit } from './reportEdit.ts'

const directory = mkdtempSync(join(tmpdir(), 'eg-report-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

describe('reportEdit', () => {
	test("a hook's payload reaches every open editor as a Report", async () => {
		const received = vi.fn()
		const close = await listenForReports(directory, received)
		const payload = JSON.stringify({
			session_id: 'abc',
			cwd: '/Users/me/notes',
			hook_event_name: 'PostToolUse',
			tool_input: { file_path: 'plan.md' }
		})

		await reportEdit(payload, {}, directory)

		await vi.waitFor(() =>
			expect(received).toHaveBeenCalledWith({
				author: { id: 'abc', name: 'Claude · notes' },
				phase: 'after',
				paths: ['/Users/me/notes/plan.md']
			})
		)
		await close()
	})

	test('a payload that names no file sends nothing and does not throw', async () => {
		await expect(reportEdit('not json', {}, directory)).resolves.toBeUndefined()
	})
})
