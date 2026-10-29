import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { dryRunOptions } from './dryRun.ts'

const folder = mkdtempSync(join(tmpdir(), 'eg-dry-'))
afterAll(() => rmSync(folder, { recursive: true, force: true }))

describe('dryRunOptions', () => {
	test('no EDITMD_GPUIX_DRY_RUN, no options: the app spawns for real', () => {
		expect(dryRunOptions({})).toEqual({})
	})

	test('with it, every process the app would start is written to that file instead, one JSON line each', () => {
		const log = join(folder, 'runs.jsonl')
		const options = dryRunOptions({ EDITMD_GPUIX_DRY_RUN: log })

		options.run?.('open', ['https://example.com/'])
		options.openInEditor?.('/tmp/notes.md')
		options.openWindow?.(null)

		expect(
			readFileSync(log, 'utf8')
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line))
		).toEqual([
			['open', ['https://example.com/']],
			['openInEditor', ['/tmp/notes.md']],
			['openWindow', [null]]
		])
	})
})
