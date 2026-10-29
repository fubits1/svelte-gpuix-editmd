/**
 * end to end: editmd's SelfTest `fileFormats` (Sources/editmd/SelfTest.swift@9e889e6, lines 226-282)
 * against the real app in a window, through `gpuix-svelte/automation`
 *
 * run: pnpm --dir . exec node e2e/fileFormats.e2e.ts (unsandboxed: it opens windows)
 * every file and the app's support folder live in a temp folder (EDITMD_GPUIX_SUPPORT)
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type App, launch } from 'gpuix-svelte/automation'

// a short root: the window's agent socket inside it must fit macOS's 104-byte socket path limit
const folder = mkdtempSync('/tmp/eg-formats-')
const file = join(folder, 'selftest-format.md')
const results: [string, boolean][] = []

function check(label: string, passed: boolean): void {
	results.push([label, passed])
	console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}`)
}

/** Windows-1252 bytes for text made of ASCII and é only, as `.windowsCP1252` would write it */
const windows1252 = (text: string) =>
	Buffer.from([...text].map((character) => (character === 'é' ? 0xe9 : character.charCodeAt(0))))
const utf16 = (text: string) =>
	Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
const onDisk = () => readFileSync(file)

async function until(label: string, condition: () => boolean, timeoutMs = 5000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
}

async function openApp(): Promise<App & { close(): Promise<void> }> {
	const app = await launch({
		entry: 'standalone.ts',
		args: [file],
		env: { EDITMD_GPUIX_SUPPORT: join(folder, 'support') }
	})
	await app.getByTestId('block-0').waitFor({ timeoutMs: 10_000 })
	return app
}

/** editmd's `type(_:intoFirst: "h1")` puts text before the heading's words; the field starts with the whole Slice */
async function editHeading(app: App, source: string): Promise<void> {
	await app.getByTestId('block-0').click()
	const field = app.getByTestId('block-editor')
	await field.waitFor()
	await field.fill(source)
	await field.press('escape')
}

const save = (app: App) => app.getByTestId('block-0').press('cmd-s')

/** "Saved" in the label: a save really ran, so an untouched file's bytes are a save's result, not a skipped one */
async function savedShown(app: App): Promise<void> {
	const label = app.getByTestId('save-status')
	await label.waitFor({ timeoutMs: 3000 })
	if ((await label.textContent()) !== 'Saved')
		throw new Error('no save ran: the label is not Saved')
}

try {
	writeFileSync(file, windows1252('# Café\r\n\r\nThé.\r\n'))
	let app = await openApp()
	await save(app)
	await savedShown(app)
	check(
		'an untouched Windows-1252 file keeps its bytes',
		onDisk().equals(windows1252('# Café\r\n\r\nThé.\r\n'))
	)

	await editHeading(app, '# Le Café')
	await save(app)
	await until('the save', () => !onDisk().equals(windows1252('# Café\r\n\r\nThé.\r\n')))
	check(
		'an edited one stays Windows-1252 with CRLF',
		onDisk().equals(windows1252('# Le Café\r\n\r\nThé.\r\n'))
	)

	await editHeading(app, '# 😀 Le Café')
	await save(app)
	await until('the UTF-8 save', () => onDisk().includes(Buffer.from('😀')))
	check(
		'an edit Windows-1252 can’t hold saves as UTF-8',
		onDisk().equals(Buffer.from('# 😀 Le Café\r\n\r\nThé.\r\n', 'utf8'))
	)
	await app.close()

	// UTF-16, mostly CRLF with one LF
	writeFileSync(file, utf16('# Über\r\n\r\nText.\n'))
	app = await openApp()
	await save(app)
	await savedShown(app)
	check(
		'an untouched UTF-16 file with mixed line endings keeps its bytes',
		onDisk().equals(utf16('# Über\r\n\r\nText.\n'))
	)

	// another program changes only the line endings, atomically; editmd waits a second first
	await new Promise((resolve) => setTimeout(resolve, 1000))
	writeFileSync(`${file}.tmp`, utf16('# Über\n\nText.\n'))
	const { renameSync } = await import('node:fs')
	renameSync(`${file}.tmp`, file)
	/**
	 * a Document the change made dirty autosaves 1s after the merge and shows Saved for 2s after that, so 2.5s
	 * after the write the label is not empty, whatever the watcher's delay within its first second. whether the
	 * app noticed the write at all cannot be told from here: a later save re-reads a changed file anyway
	 */
	await new Promise((resolve) => setTimeout(resolve, 2500))
	check(
		'a change to line endings alone leaves the Document clean: no save rewrites it and the label stays empty',
		onDisk().equals(utf16('# Über\n\nText.\n')) &&
			(await app.getByTestId('save-status').count()) === 0
	)

	await editHeading(app, '# New Über')
	await save(app)
	await until('the UTF-16 save', () => !onDisk().equals(utf16('# Über\n\nText.\n')))
	check(
		'an edited UTF-16 file stays UTF-16 with its new line endings',
		onDisk().equals(utf16('# New Über\n\nText.\n'))
	)
	await app.close()
} catch (error) {
	check(`no error: ${error instanceof Error ? error.message : String(error)}`, false)
} finally {
	rmSync(folder, { recursive: true, force: true })
}

const failed = results.filter(([, passed]) => !passed).length
console.log(failed === 0 ? `\nfile formats ok (${results.length})` : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
