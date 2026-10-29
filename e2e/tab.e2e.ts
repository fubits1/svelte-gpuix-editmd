/**
 * end to end: Tab and Shift-Tab in a Block's field and in Source mode, in a real window, against editmd's
 * Milkdown: `.use(indent)` with no config (editmd/web/src/editor.ts:48, 481), whose Tab inserts its default
 * indent of 2 spaces at the caret (@milkdown/plugin-indent src/index.ts:52, 63-71), after the commonmark
 * `listItemKeymap`, where Tab and Mod-] sink the list item and Shift-Tab and Mod-[ lift it
 * (@milkdown/preset-commonmark src/node/list-item.ts:212-225)
 *
 * run: pnpm --dir . exec gpuix-svelte e2e/tab.e2e.ts (unsandboxed: it opens a window)
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, type Editor, finish, openEditor, pause, press, reaches } from './support.ts'

// a short root: the window's agent socket inside it must fit macOS's 104-byte socket path limit
const folder = mkdtempSync('/tmp/eg-tab-')

/** space-separated keystrokes, sent to the focused element the way a user types them */
const typeKeys = (app: Editor, keys: string) => app.call('keystrokes', { keys })

const isFieldOpen = async (app: Editor) => (await app.getByTestId('block-editor').count()) > 0

/** a click on Block 0 opens its field with the caret at the end of its source */
async function openBlock(app: Editor): Promise<void> {
	await app.getByTestId('block-0').click()
	await app.getByTestId('block-editor').waitFor()
}

async function launchOn(name: string, text: string): Promise<{ app: Editor; file: string }> {
	const file = join(folder, `${name}.md`)
	writeFileSync(file, text)
	return { app: await openEditor(file, folder), file }
}

/** Escape closes the field; the file once its save differs from `before`, or as it stands after 4s */
async function saveOnEscape(app: Editor, file: string, before: string): Promise<string> {
	await typeKeys(app, 'escape')
	await reaches(() => readFileSync(file, 'utf8') !== before, 4000)
	return readFileSync(file, 'utf8')
}

try {
	{
		const { app, file } = await launchOn('para', 'para\n')
		await openBlock(app)
		await typeKeys(app, 'tab')
		await pause(200)
		const open = await isFieldOpen(app)
		await typeKeys(app, 'z')
		const text = await saveOnEscape(app, file, 'para\n')
		check(
			`Tab in a paragraph types 2 spaces at the caret, as editmd's plugin-indent does where no list item takes Tab, and the field stays open (indent src/index.ts:52, 63-71; list-item.ts:212-218) (open ${open}, file ${JSON.stringify(text)})`,
			open && text === 'para  z\n'
		)
		await app.close().catch(() => {})
	}

	{
		const { app, file } = await launchOn('fast', 'para\n')
		await openBlock(app)
		// One keystrokes call delivers its keys as one batch, ahead of the spaces Tab sends; separate calls arrive as a person's typing does.
		for (const key of ['tab', 'tab', 'z']) await typeKeys(app, key)
		const text = await saveOnEscape(app, file, 'para\n')
		check(
			`Tab, Tab and z as separate key events right after each other, as a person types them, each land: two indents of 2 spaces, then z (indent src/index.ts:63-71) (file ${JSON.stringify(text)})`,
			text === 'para    z\n'
		)
		await app.close().catch(() => {})
	}

	{
		const { app, file } = await launchOn('list', '- a\n- b\n')
		await openBlock(app)
		await typeKeys(app, 'tab')
		const sunk = await saveOnEscape(app, file, '- a\n- b\n')
		check(
			`Tab in the second list item sinks it under the first (list-item.ts:212-218) (file ${JSON.stringify(sunk)})`,
			sunk === '- a\n  - b\n'
		)
		await openBlock(app)
		await typeKeys(app, 'shift-tab')
		const lifted = await saveOnEscape(app, file, sunk)
		check(
			`Shift-Tab in the sunk item lifts it back beside the first (list-item.ts:219-225) (file ${JSON.stringify(lifted)})`,
			lifted === '- a\n- b\n'
		)
		await app.close().catch(() => {})
	}

	{
		const { app, file } = await launchOn('single', '- a\n')
		await openBlock(app)
		await typeKeys(app, 'tab')
		await typeKeys(app, 'z')
		const text = await saveOnEscape(app, file, '- a\n')
		check(
			`Tab in the only list item, where sinking is refused, inserts plugin-indent's 2 spaces at the caret (list-item.ts:212-218; indent src/index.ts:52, 63-71) (file ${JSON.stringify(text)})`,
			text === '- a  z\n'
		)
		await app.close().catch(() => {})
	}

	{
		const { app, file } = await launchOn('lift', 'para\n')
		await openBlock(app)
		await typeKeys(app, 'shift-tab')
		await pause(200)
		const open = await isFieldOpen(app)
		await typeKeys(app, 'z')
		const text = await saveOnEscape(app, file, 'para\n')
		check(
			`Shift-Tab in a paragraph changes nothing, as no list item lifts and plugin-indent binds Tab alone, and the field stays open (list-item.ts:219-225; indent src/index.ts:62-75) (open ${open}, file ${JSON.stringify(text)})`,
			open && text === 'paraz\n'
		)
		await app.close().catch(() => {})
	}

	{
		const { app, file } = await launchOn('selection', 'para\n')
		await openBlock(app)
		await typeKeys(app, 'shift-left shift-left')
		await typeKeys(app, 'tab')
		const text = await saveOnEscape(app, file, 'para\n')
		check(
			`Tab over a selection replaces it with 2 spaces, as in VS Code (user decision); editmd's plugin-indent would keep it (file ${JSON.stringify(text)})`,
			text === 'pa  \n'
		)
		await app.close().catch(() => {})
	}

	{
		const { app, file } = await launchOn('source', 'para\n')
		await press(app, 'cmd-/')
		await app.getByTestId('source-editor').waitFor()
		await typeKeys(app, 'tab')
		await typeKeys(app, 'z')
		// Source mode keeps Escape in its field, so the 1s autosave writes the file
		await reaches(() => readFileSync(file, 'utf8') !== 'para\n', 4000)
		const text = readFileSync(file, 'utf8')
		check(
			`Tab in Source mode puts no tab character and no 2 spaces into the file: editmd's source view is a plain textarea with no Tab handler of its own (editor.ts:159-163) (file ${JSON.stringify(text)})`,
			!text.includes('\t') && !text.includes('  ')
		)
		await app.close().catch(() => {})
	}
} catch (error) {
	check(`no error: ${error instanceof Error ? error.message : String(error)}`, false)
} finally {
	rmSync(folder, { recursive: true, force: true })
}

finish('tab')
