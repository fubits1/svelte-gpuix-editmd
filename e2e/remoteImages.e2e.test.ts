/**
 * end to end: editmd's SelfTest `remoteImages` (Sources/editmd/SelfTest.swift@9e889e6, lines 422-483)
 * in a real window, against a loopback server like editmd's PixelServer that counts requests
 *
 * editmd's paragraph mixes a remote and a local image with text; here each image has its own
 * paragraph, and the mermaid image shape is left out: pele draws no remote images
 */

import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import {
	check,
	countChecks,
	editBlock,
	type Editor,
	has,
	isMetWithin,
	loadPaintedText,
	loadText,
	openEditor,
	pause,
	press,
	runInFolder,
	waitUntil
} from './support.ts'

// a 1x1 PNG
const PIXEL = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64'
)
const requests: string[] = []
const server = createServer((request, response) => {
	requests.push(request.url ?? '')
	// an image that is not there, for the `missing.md` check that a remote image answering 404 paints its alt text
	if (request.url === '/missing.png') {
		response.writeHead(404).end()
	} else {
		response.writeHead(200, { 'content-type': 'image/png' }).end(PIXEL)
	}
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
afterAll(() => {
	server.close()
})
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

/** ⇧⌘/ opens the command palette, `load remote` filters it, and Return runs the selected entry */
async function loadRemoteImages(app: Editor): Promise<void> {
	await press(app, 'cmd-shift-/')
	const field = app.getByTestId('command-palette-field')
	await field.waitFor()
	await field.fill('load remote')
	await field.press('enter')
}

test('remote images', async () => {
	await runInFolder('remote', async (folder) => {
		const file = join(folder, 'remote.md')
		const dryRun = { EDITMD_GPUIX_DRY_RUN: join(folder, 'runs.jsonl') }
		writeFileSync(join(folder, 'local.png'), PIXEL)
		writeFileSync(file, `# Remote\n\n![pixel](${base}/image.png)\n\n![local](local.png)\n`)
		const app = await openEditor(file, folder, dryRun)

		await app.getByTestId('image-2-0').waitFor()
		await pause(1000)
		check('a document with remote images loads nothing from the network', requests.length === 0)
		check(
			'a blocked image shows its alt text',
			(await loadText(app, 'image-blocked-1-0')) === 'pixel'
		)

		await editBlock(app, 0, '# Kept Remote')
		await loadRemoteImages(app)
		check(
			'Load Remote Images fetches them',
			await isMetWithin(() => requests.includes('/image.png'))
		)
		await app.getByTestId('image-1-0').waitFor()

		await loadRemoteImages(app)
		await pause(300)
		// enabled, the first Return ran it and closed the palette; disabled, nothing is selected and it stays
		check(
			'and is then done for the window: Return on its palette entry does nothing',
			(await app.getByTestId('command-palette').count()) === 1 &&
				(await loadText(app, 'palette-title-0')) === 'Load Remote Images'
		)
		await app.getByTestId('command-palette-field').press('escape')

		check(
			'loading them keeps unsaved edits',
			(await loadPaintedText(app)).startsWith('Kept Remote')
		)
		await press(app, 'cmd-z')
		check(
			'and undo history',
			await isMetWithin(async () => (await loadPaintedText(app)).startsWith('Remote'))
		)
		await app.close()

		// a remote image that fails once allowed (a 404) paints its alt text, as a missing local file does
		const missingFile = join(folder, 'missing.md')
		writeFileSync(missingFile, `![gone picture](${base}/missing.png) after it.\n`)
		const missing = await openEditor(missingFile, folder, dryRun)
		await loadRemoteImages(missing)
		await waitUntil('the missing image asked for', () => requests.includes('/missing.png'))
		const altShown = await isMetWithin(
			async () => (await loadText(missing, 'image-missing-0-0')) === 'gone picture',
			3000
		)
		check(
			'a remote image that answers 404 paints its alt text, not GPUI’s load-failed box',
			altShown && !(await has(missing, 'image-0-0'))
		)
		await missing.close()
	})
})

test('every check ran', () => expect(countChecks()).toBe(7))
