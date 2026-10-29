/**
 * end to end: editmd's SelfTest `remoteImages` (Sources/editmd/SelfTest.swift@9e889e6, lines 422-483)
 * in a real window, against a loopback server like editmd's PixelServer that counts requests
 *
 * run: pnpm --dir . exec gpuix-svelte e2e/remoteImages.e2e.ts (unsandboxed: it opens a window)
 * editmd's paragraph mixes a remote and a local image with text; here each image has its own
 * paragraph (images inside text are not split out yet, docs/parity.md), and the mermaid image
 * shape is left out: pele draws no remote images
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import {
	check,
	editBlock,
	finish,
	openEditor,
	painted,
	pause,
	press,
	reaches,
	textOf,
	until
} from './support.ts'

// a 1x1 PNG
const PIXEL = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64'
)
const requests: string[] = []
const server = createServer((request, response) => {
	requests.push(request.url ?? '')
	// an image that is not there, for the failed load below
	if (request.url === '/missing.png') response.writeHead(404).end()
	else response.writeHead(200, { 'content-type': 'image/png' }).end(PIXEL)
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

// a short root: the window's agent socket inside it must fit macOS's 104-byte socket path limit
const folder = mkdtempSync('/tmp/eg-remote-')
const file = join(folder, 'remote.md')

try {
	writeFileSync(join(folder, 'local.png'), PIXEL)
	writeFileSync(file, `# Remote\n\n![pixel](${base}/image.png)\n\n![local](local.png)\n`)
	const app = await openEditor(file, folder, { EDITMD_GPUIX_DRY_RUN: join(folder, 'runs.jsonl') })

	await app.getByTestId('image-2-0').waitFor()
	await pause(1000)
	check('a document with remote images loads nothing from the network', requests.length === 0)
	check('a blocked image shows its alt text', (await textOf(app, 'image-blocked-1-0')) === 'pixel')

	await editBlock(app, 0, '# Kept Remote')
	await press(app, 'cmd-shift-/')
	const field = app.getByTestId('command-palette-field')
	await field.waitFor()
	await field.fill('load remote')
	await field.press('enter')
	await until('remote image fetched', () => requests.includes('/image.png'))
	check('Load Remote Images fetches them', requests.includes('/image.png'))
	await app.getByTestId('image-1-0').waitFor()

	await press(app, 'cmd-shift-/')
	await app.getByTestId('command-palette-field').waitFor()
	await app.getByTestId('command-palette-field').fill('load remote')
	await app.getByTestId('command-palette-field').press('enter')
	await pause(300)
	// enabled, Return ran it and closed the palette above; disabled, nothing is selected and it stays
	check(
		'and is then done for the window: Return on its palette entry does nothing',
		(await app.getByTestId('command-palette').count()) === 1 &&
			(await textOf(app, 'palette-title-0')) === 'Load Remote Images'
	)
	await app.getByTestId('command-palette-field').press('escape')

	check('loading them keeps unsaved edits', (await painted(app)).startsWith('Kept Remote'))
	await press(app, 'cmd-z')
	await until('undo shown', async () => (await painted(app)).startsWith('Remote'))
	check('and undo history', (await painted(app)).startsWith('Remote'))
	await app.close()

	/**
	 * a remote image that fails once allowed (a 404) paints its alt text, as a missing local file
	 * does, where GPUI's own "img: load failed" box pushed the text aside
	 */
	const missingFile = join(folder, 'missing.md')
	writeFileSync(missingFile, `![gone picture](${base}/missing.png) after it.\n`)
	const missing = await openEditor(missingFile, folder, {
		EDITMD_GPUIX_DRY_RUN: join(folder, 'runs.jsonl')
	})
	await press(missing, 'cmd-shift-/')
	await missing.getByTestId('command-palette-field').waitFor()
	await missing.getByTestId('command-palette-field').fill('load remote')
	await missing.getByTestId('command-palette-field').press('enter')
	await until('the missing image asked for', () => requests.includes('/missing.png'))
	const altShown = await reaches(
		async () => (await textOf(missing, 'image-missing-0-0')) === 'gone picture',
		3000
	)
	check(
		'a remote image that answers 404 paints its alt text, not GPUI’s load-failed box',
		altShown && (await missing.getByTestId('image-0-0').count()) === 0
	)
	await missing.close()
} catch (error) {
	check(`no error: ${error instanceof Error ? error.message : String(error)}`, false)
} finally {
	server.close()
	rmSync(folder, { recursive: true, force: true })
}

finish('remote images')
