/**
 * end to end: editmd's SelfTest `links` (Sources/editmd/SelfTest.swift@9e889e6, lines 350-405) in a
 * real window, where the order of GPUI's link and Block click events is the one a user gets
 *
 * run: pnpm exec gpuix-svelte e2e/links.e2e.ts (unsandboxed: it opens a window)
 * EDITMD_GPUIX_DRY_RUN logs what the app would start, so nothing opens in Finder or the browser.
 * editmd puts the five links in one paragraph; here each has its own, so a Cmd-click at the start
 * of its Block lands on it (GPUI offers no hit test of a link run)
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, has, openEditor, suite, until } from './support.ts'

await suite('links', 'links', async (folder) => {
	const root = realpathSync(folder)
	const file = join(folder, 'links.md')
	const log = join(folder, 'runs.jsonl')

	/** what the app would have started, symlinks in paths resolved for comparison, as editmd's `decision` */
	function runs(): string[] {
		if (!existsSync(log)) return []
		return readFileSync(log, 'utf8')
			.trim()
			.split('\n')
			.map((line) => {
				const [command, args] = JSON.parse(line) as [string, (string | null)[]]
				const resolved = args.map((arg) => (arg?.startsWith('/') ? arg.replace(folder, root) : arg))
				return `${command} ${resolved.join(' ')}`
			})
	}

	mkdirSync(join(folder, 'tools', 'Tool.app', 'Contents', 'MacOS'), { recursive: true })
	writeFileSync(join(folder, 'other notes.md'), '# Other\n')
	writeFileSync(
		file,
		'# Links\n\n[app](tools/Tool.app)\n\n[doc](other%20notes.md)\n\n[loc](x.fileloc)\n\n[web](https://example.com)\n\n[tel](tel:+15551234)\n'
	)
	const app = await openEditor(file, folder, { EDITMD_GPUIX_DRY_RUN: log })

	/** a click at the start of Block `block`, where its link is, `modifiers` held */
	const clickStart = async (block: number, modifiers?: string) => {
		const bounds = await app.getByTestId(`block-${block}`).bounds()
		await app.mouse.click({ x: bounds.x + 4, y: bounds.y + bounds.height / 2 }, { modifiers })
	}

	for (const block of [1, 2, 3, 4]) await clickStart(block, 'cmd')
	await until('four links followed', () => runs().length === 4)
	check(
		`Cmd-clicked links reveal apps and other files, open text files here and web pages outside (${runs().join(' | ')})`,
		JSON.stringify(runs()) ===
			JSON.stringify([
				`open -R ${root}/tools/Tool.app`,
				`openInEditor ${root}/other notes.md`,
				`open -R ${root}/x.fileloc`,
				'open https://example.com/'
			])
	)
	check('following a link opens no editor', !(await has(app, 'block-editor')))

	await clickStart(5, 'cmd')
	await app.getByTestId('confirm-link').waitFor()
	check('a link of another scheme asks first and starts nothing', runs().length === 4)
	await app.getByTestId('confirm-link-cancel').click()

	// a plain click edits, as in editmd, where only a Cmd-click follows a link
	await clickStart(4)
	await app.getByTestId('block-editor').waitFor()
	check(
		'a plain click on a link opens its Block for editing and starts nothing',
		runs().length === 4
	)
	await app.close()
})
