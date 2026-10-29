/**
 * the window pictures of the migration check: every rendering fixture opened in the real app window, menu bar and all,
 * into OUT/<fixture>.png. The window follows the Mac's light or dark mode and its size follows the screen, so both are
 * written to OUT/settings.json, and a run whose settings differ from BEFORE_SETTINGS stops before opening any window.
 * The windows take the keyboard while they are open.
 *
 * run: node node_modules/gpuix-svelte/bin/gpuix-svelte.js test/visual/capture-window.ts OUT_FOLDER [BEFORE_SETTINGS]
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from 'gpuix-svelte/automation'
import { systemAppearance } from '../../src/host/appearance.ts'
import { readVisibleScreen } from '../../src/host/screen.ts'
import { FIXTURES, fixtureFile } from './fixtures.ts'

const [out, beforeSettings] = process.argv.slice(2)
if (!out) throw new Error('usage: test/visual/capture-window.ts OUT_FOLDER [BEFORE_SETTINGS]')
mkdirSync(out, { recursive: true })

const settings = JSON.stringify({ appearance: systemAppearance(), screen: readVisibleScreen() })
if (beforeSettings && existsSync(beforeSettings)) {
	const before = readFileSync(beforeSettings, 'utf8').trim()
	if (before !== settings) {
		console.log(`the Mac's settings differ from the before run: before ${before}, now ${settings}`)
		process.exit(1)
	}
}
writeFileSync(join(out, 'settings.json'), `${settings}\n`)

for (const id of FIXTURES) {
	const support = mkdtempSync(join(tmpdir(), 'eg-visual-'))
	const app = await launch({
		entry: 'standalone.ts',
		args: [resolve(fixtureFile(id))],
		env: { EDITMD_GPUIX_SUPPORT: join(support, 'support') }
	})
	try {
		// an empty document has no Block to wait for
		await app
			.getByTestId('block-0')
			.waitFor({ timeoutMs: 10_000 })
			.catch(() => undefined)
		// images measure their column on a 250ms poll, and diagrams render once
		await new Promise((done) => setTimeout(done, 800))
		await app.screenshot({ path: resolve(join(out, `${id}.png`)) })
	} finally {
		await app.close()
		rmSync(support, { recursive: true, force: true })
	}
}
console.log(`${FIXTURES.length} pictures in ${out}`)
process.exit(0)
