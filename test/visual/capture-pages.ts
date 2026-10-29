/**
 * the page pictures of the migration check: every rendering fixture through the app's own `--snapshot` mode, light and
 * dark, 860 wide, into OUT/<fixture>-<appearance>.png; no window opens
 *
 * run: node test/visual/capture-pages.ts OUT_FOLDER
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { FIXTURES, fixtureFile } from './fixtures.ts'

const out = process.argv[2]
if (!out) throw new Error('usage: test/visual/capture-pages.ts OUT_FOLDER')
mkdirSync(out, { recursive: true })

const GPUIX_BIN = join('node_modules', 'gpuix-svelte', 'bin', 'gpuix-svelte.js')
let failed = 0
for (const id of FIXTURES) {
	for (const appearance of ['light', 'dark'] as const) {
		const file = join(out, `${id}-${appearance}.png`)
		const flags = appearance === 'dark' ? ['--dark'] : []
		const run = spawnSync(
			process.execPath,
			[GPUIX_BIN, 'standalone.ts', '--snapshot', fixtureFile(id), file, ...flags, '--width', '860'],
			{ encoding: 'utf8', timeout: 120_000 }
		)
		if (run.status !== 0) {
			failed++
			console.log('FAIL', id, appearance, run.stderr.trim().split('\n').at(-1))
		}
	}
}
console.log(failed === 0 ? `${FIXTURES.length * 2} pictures in ${out}` : `${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
