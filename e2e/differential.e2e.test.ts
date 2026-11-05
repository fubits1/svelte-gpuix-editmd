/**
 * end to end: the seeded typing sequences in test/fixtures/differential/editmd-typing.json, typed into a real window
 * on an existing file and on an empty one, one key per call (each Backspace pressed as a person does, key down then up)
 * and as one batch, against what editmd saves for the same keys in its own editor. every check asserts the file ⌘S saves
 * exactly and that Escape leaves no field open; EDITMD_GPUIX_DIFF_OUT, when set, names a JSON file that gets every
 * result, so the two editors can be compared case by case
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import {
	check,
	countChecks,
	openOn,
	pause,
	pressBackspace,
	runInFolder,
	saveAfterEscape,
	sendKeystrokes,
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

const results: Result[] = []

test('differential', async () => {
	await runInFolder('diff', async (folder) => {
		try {
			for (const [index, testCase] of fixture.cases.entries()) {
				for (const existing of [true, false]) {
					const expected = existing ? testCase.existing : testCase.empty
					if (expected === null) continue

					for (const batch of [false, true]) {
						const text = existing ? `${testCase.source}${fixture.after}` : ''
						const { app, file } = await openOn(
							folder,
							`case-${index}-${existing}-${batch}`,
							text,
							testCase.block
						)
						try {
							if (existing) {
								await sendKeystrokes(app, testCase.caret)
							} else {
								await typeEach(app, testCase.setup)
							}

							await pause(200)
							if (batch) {
								await sendKeystrokes(app, testCase.steps.join(' '))
							} else {
								for (const step of testCase.steps) {
									await (step === 'backspace' ? pressBackspace(app) : typeEach(app, [step]))
								}
							}
							const [saved, open] = await saveAfterEscape(app, file, text)
							results.push({ name: testCase.name, existing, batch, expected, saved, open })
							check(
								`${testCase.name}, ${existing ? 'existing file' : 'empty file'}, ${batch ? 'one batch' : 'one key per call'}: ⌘S saves editmd's ${JSON.stringify(expected)} and Escape leaves no field open (saved ${JSON.stringify(saved)}, field open ${open})`,
								saved === expected && !open
							)
						} finally {
							await app.close().catch(() => {})
						}
					}
				}
			}
		} finally {
			const outPath = process.env.EDITMD_GPUIX_DIFF_OUT
			if (outPath) writeFileSync(outPath, `${JSON.stringify(results, null, '\t')}\n`)
		}
	})
})

test('every check ran', () => expect(countChecks()).toBe(90))
