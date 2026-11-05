/**
 * end to end: editmd's SelfTest `fileFormats` (Sources/editmd/SelfTest.swift@9e889e6, lines 226-282)
 * against the app in its window (headless by default, a real one with `test:e2e:window`), through
 * `gpuix-svelte/automation`
 *
 * every file and the app's support folder live in a temp folder (EDITMD_GPUIX_SUPPORT)
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { App } from 'gpuix-svelte/automation'
import { expect, test } from 'vitest'
import {
	check,
	countChecks,
	editBlock,
	has,
	loadText,
	openEditor,
	pause,
	press,
	runInFolder,
	waitUntil,
	writeAtomically
} from './support.ts'

/** Windows-1252 bytes for text made of ASCII and é only, as `.windowsCP1252` would write it */
const toWindows1252 = (text: string) =>
	Buffer.from([...text].map((character) => (character === 'é' ? 0xe9 : character.charCodeAt(0))))
const toUtf16 = (text: string) =>
	Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])

/** "Saved" in the label: a save really ran, so an untouched file's bytes are a save's result, not a skipped one */
const waitForSaved = (app: App) =>
	waitUntil('Saved shown', async () => (await loadText(app, 'save-status')) === 'Saved', 3000)

test('file formats', async () => {
	await runInFolder('formats', async (folder) => {
		const file = join(folder, 'selftest-format.md')
		const readDisk = () => readFileSync(file)

		const windows1252 = toWindows1252('# Café\r\n\r\nThé.\r\n')
		writeFileSync(file, windows1252)
		let app = await openEditor(file, folder)
		await press(app, 'cmd-s')
		await waitForSaved(app)
		check('an untouched Windows-1252 file keeps its bytes', readDisk().equals(windows1252))

		await editBlock(app, 0, '# Le Café')
		await press(app, 'cmd-s')
		await waitUntil('the save', () => !readDisk().equals(windows1252))
		check(
			'an edited one stays Windows-1252 with CRLF',
			readDisk().equals(toWindows1252('# Le Café\r\n\r\nThé.\r\n'))
		)

		await editBlock(app, 0, '# 😀 Le Café')
		await press(app, 'cmd-s')
		await waitUntil('the UTF-8 save', () => readDisk().includes(Buffer.from('😀')))
		check(
			'an edit Windows-1252 can’t hold saves as UTF-8',
			readDisk().equals(Buffer.from('# 😀 Le Café\r\n\r\nThé.\r\n', 'utf8'))
		)
		await app.close()

		// UTF-16, mostly CRLF with one LF
		const mixedEndings = toUtf16('# Über\r\n\r\nText.\n')
		writeFileSync(file, mixedEndings)
		app = await openEditor(file, folder)
		await press(app, 'cmd-s')
		await waitForSaved(app)
		check(
			'an untouched UTF-16 file with mixed line endings keeps its bytes',
			readDisk().equals(mixedEndings)
		)

		// another program changes only the line endings, atomically; editmd waits a second first
		await pause(1000)
		const lfOnly = toUtf16('# Über\n\nText.\n')
		writeAtomically(file, lfOnly)
		/**
		 * a Document the change made dirty autosaves 1s after the merge and shows Saved for 2s after that, so 2.5s
		 * after the write the label is not empty, whatever the watcher's delay within its first second. whether the
		 * app noticed the write at all cannot be told from here: a later save re-reads a changed file anyway
		 */
		await pause(2500)
		check(
			'a change to line endings alone leaves the Document clean: no save rewrites it and the label stays empty',
			readDisk().equals(lfOnly) && !(await has(app, 'save-status'))
		)

		await editBlock(app, 0, '# New Über')
		await press(app, 'cmd-s')
		await waitUntil('the UTF-16 save', () => !readDisk().equals(lfOnly))
		check(
			'an edited UTF-16 file stays UTF-16 with its new line endings',
			readDisk().equals(toUtf16('# New Über\n\nText.\n'))
		)
		await app.close()
	})
})

test('every check ran', () => expect(countChecks()).toBe(6))
