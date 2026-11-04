/**
 * end to end: the seeded typing sequences in test/fixtures/differential/editmd-typing.json, typed into a real window
 * on an existing file and on an empty one, one key per call (each Backspace pressed as a person does, key down then up)
 * and as one batch, against what editmd saves for the same keys in its own editor (kit harness scripts/parity/editmd-differential.test.mjs). every check asserts the file ⌘S
 * saves exactly and that Escape leaves no field open; EDITMD_GPUIX_DIFF_OUT, when set, names a JSON file that gets
 * every result, so the two editors can be compared case by case
 *
 * run: pnpm exec gpuix-svelte e2e/differential.e2e.ts (unsandboxed: it opens windows and takes the keyboard)
 * the files, the app's support folder and the agents it counts live in a temp folder, so nothing reaches the real ones
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import {
	check,
	finish,
	keystrokes,
	openOn,
	pause,
	pressBackspace,
	saveAfterEscape,
	typeEach
} from './support.ts'

type Case = {
	name: string
	/** the text Block 0 of an existing file holds before `after`, and the keys that type it into an empty one */
	source: string
	setup: string[]
	/** the keys that put the caret where the steps start in the existing file's clicked Block */
	caret: string
	block: number
	steps: string[]
	/** what editmd saves for the existing file, or null when `source` is empty and there is none */
	existing: string | null
	/** what editmd saves for the empty file */
	empty: string
}

type Fixture = { seed: number; after: string; cases: Case[] }

type Result = {
	name: string
	existing: boolean
	batch: boolean
	expected: string
	saved: string
	open: boolean
}

const fixture: Fixture = JSON.parse(
	readFileSync('test/fixtures/differential/editmd-typing.json', 'utf8')
)

// a short root: the window's agent socket inside it must fit macOS's 104-byte socket path limit
const folder = mkdtempSync('/tmp/eg-diff-')

const results: Result[] = []

try {
	for (const [index, each] of fixture.cases.entries()) {
		for (const existing of [true, false]) {
			const expected = existing ? each.existing : each.empty
			if (expected === null) continue
			for (const batch of [false, true]) {
				const text = existing ? `${each.source}${fixture.after}` : ''
				const { app, file } = await openOn(
					folder,
					`case-${index}-${existing}-${batch}`,
					text,
					each.block
				)
				try {
					if (existing) await keystrokes(app, each.caret)
					else await typeEach(app, each.setup)
					await pause(200)
					if (batch) await keystrokes(app, each.steps.join(' '))
					else {
						for (const step of each.steps) {
							await (step === 'backspace' ? pressBackspace(app) : typeEach(app, [step]))
						}
					}
					const [saved, open] = await saveAfterEscape(app, file, text)
					results.push({ name: each.name, existing, batch, expected, saved, open })
					check(
						`${each.name}, ${existing ? 'existing file' : 'empty file'}, ${batch ? 'one batch' : 'one key per call'}: ⌘S saves editmd's ${JSON.stringify(expected)} and Escape leaves no field open (saved ${JSON.stringify(saved)}, field open ${open})`,
						saved === expected && !open
					)
				} finally {
					await app.close().catch(() => {})
				}
			}
		}
	}
} catch (error) {
	check(`no error: ${error instanceof Error ? error.message : String(error)}`, false)
} finally {
	rmSync(folder, { recursive: true, force: true })
	const out = process.env.EDITMD_GPUIX_DIFF_OUT
	if (out) writeFileSync(out, `${JSON.stringify(results, null, '\t')}\n`)
}

finish('differential')
