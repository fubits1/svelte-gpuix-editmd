/**
 * end to end: editmd's SelfTest `fileFormats` (Sources/editmd/SelfTest.swift@9e889e6, lines 226-282)
 * against the real app in a window, through `gpuix-svelte/automation`
 *
 * run: pnpm exec gpuix-svelte e2e/fileFormats.e2e.ts (unsandboxed: it opens windows)
 * every file and the app's support folder live in a temp folder (EDITMD_GPUIX_SUPPORT)
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { App } from 'gpuix-svelte/automation'
import { check, editBlock, has, openEditor, pause, press, suite, textOf, until } from './support.ts'

/** Windows-1252 bytes for text made of ASCII and é only, as `.windowsCP1252` would write it */
const windows1252 = (text: string) =>
	Buffer.from([...text].map((character) => (character === 'é' ? 0xe9 : character.charCodeAt(0))))
const utf16 = (text: string) =>
	Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])

/** "Saved" in the label: a save really ran, so an untouched file's bytes are a save's result, not a skipped one */
const savedShown = (app: App) =>
	until('Saved shown', async () => (await textOf(app, 'save-status')) === 'Saved', 3000)

await suite('file formats', 'formats', async (folder) => {
	const file = join(folder, 'selftest-format.md')
	const onDisk = () => readFileSync(file)

	writeFileSync(file, windows1252('# Café\r\n\r\nThé.\r\n'))
	let app = await openEditor(file, folder)
	await press(app, 'cmd-s')
	await savedShown(app)
	check(
		'an untouched Windows-1252 file keeps its bytes',
		onDisk().equals(windows1252('# Café\r\n\r\nThé.\r\n'))
	)

	await editBlock(app, 0, '# Le Café')
	await press(app, 'cmd-s')
	await until('the save', () => !onDisk().equals(windows1252('# Café\r\n\r\nThé.\r\n')))
	check(
		'an edited one stays Windows-1252 with CRLF',
		onDisk().equals(windows1252('# Le Café\r\n\r\nThé.\r\n'))
	)

	await editBlock(app, 0, '# 😀 Le Café')
	await press(app, 'cmd-s')
	await until('the UTF-8 save', () => onDisk().includes(Buffer.from('😀')))
	check(
		'an edit Windows-1252 can’t hold saves as UTF-8',
		onDisk().equals(Buffer.from('# 😀 Le Café\r\n\r\nThé.\r\n', 'utf8'))
	)
	await app.close()

	// UTF-16, mostly CRLF with one LF
	writeFileSync(file, utf16('# Über\r\n\r\nText.\n'))
	app = await openEditor(file, folder)
	await press(app, 'cmd-s')
	await savedShown(app)
	check(
		'an untouched UTF-16 file with mixed line endings keeps its bytes',
		onDisk().equals(utf16('# Über\r\n\r\nText.\n'))
	)

	// another program changes only the line endings, atomically; editmd waits a second first
	await pause(1000)
	writeFileSync(`${file}.tmp`, utf16('# Über\n\nText.\n'))
	renameSync(`${file}.tmp`, file)
	/**
	 * a Document the change made dirty autosaves 1s after the merge and shows Saved for 2s after that, so 2.5s
	 * after the write the label is not empty, whatever the watcher's delay within its first second. whether the
	 * app noticed the write at all cannot be told from here: a later save re-reads a changed file anyway
	 */
	await pause(2500)
	check(
		'a change to line endings alone leaves the Document clean: no save rewrites it and the label stays empty',
		onDisk().equals(utf16('# Über\n\nText.\n')) && !(await has(app, 'save-status'))
	)

	await editBlock(app, 0, '# New Über')
	await press(app, 'cmd-s')
	await until('the UTF-16 save', () => !onDisk().equals(utf16('# Über\n\nText.\n')))
	check(
		'an edited UTF-16 file stays UTF-16 with its new line endings',
		onDisk().equals(utf16('# New Über\n\nText.\n'))
	)
	await app.close()
})
