/**
 * end to end: Tab and Shift-Tab in a Block's field and in Source mode, in the app's window (headless by default, a real
 * one with `test:e2e:window`), against editmd's Milkdown: `.use(indent)` with no config (editmd/web/src/editor.ts:48, 481), whose Tab inserts its default
 * indent of 2 spaces at the caret (@milkdown/plugin-indent src/index.ts:52, 63-71), after the commonmark
 * `listItemKeymap`, where Tab and Mod-] sink the list item and Shift-Tab and Mod-[ lift it
 * (@milkdown/preset-commonmark src/node/list-item.ts:212-225)
 */

import { expect, test } from 'vitest'
import {
	check,
	countChecks,
	type Editor,
	has,
	openBlock,
	pause,
	press,
	runInFolder,
	saveAfterEscape,
	sendKeystrokes,
	typeEach,
	waitForChange,
	withOpenOn
} from './support.ts'

/** Escape closes the field; the file once its save differs from `before`, or as it stands after 4s */
async function saveOnEscape(app: Editor, file: string, before: string): Promise<string> {
	await sendKeystrokes(app, 'escape')
	return waitForChange(file, before)
}

// every case but Source mode's opens Block 0's field with a click, which puts the caret at the end of its source
test('tab', async () => {
	await runInFolder('tab', async (folder) => {
		await withOpenOn(folder, 'para', 'para\n', 0, async (app, file) => {
			await sendKeystrokes(app, 'tab')
			await pause(200)
			const open = await has(app, 'block-editor')
			await sendKeystrokes(app, 'z')
			const text = await saveOnEscape(app, file, 'para\n')
			check(
				`Tab in a paragraph types 2 spaces at the caret, as editmd's plugin-indent does where no list item takes Tab, and the field stays open (indent src/index.ts:52, 63-71; list-item.ts:212-218) (open ${open}, file ${JSON.stringify(text)})`,
				open && text === 'para  z\n'
			)
		})

		await withOpenOn(folder, 'fast', 'para\n', 0, async (app, file) => {
			// one keystrokes call delivers its keys as one batch, ahead of the spaces Tab sends; separate calls arrive as a person's typing does
			await typeEach(app, ['tab', 'tab', 'z'], 0)
			const text = await saveOnEscape(app, file, 'para\n')
			check(
				`Tab, Tab and z as separate key events right after each other, as a person types them, each land: two indents of 2 spaces, then z (indent src/index.ts:63-71) (file ${JSON.stringify(text)})`,
				text === 'para    z\n'
			)
		})

		await withOpenOn(folder, 'list', '- a\n- b\n', 0, async (app, file) => {
			await sendKeystrokes(app, 'tab')
			const sunk = await saveOnEscape(app, file, '- a\n- b\n')
			check(
				`Tab in the second list item sinks it under the first (list-item.ts:212-218) (file ${JSON.stringify(sunk)})`,
				sunk === '- a\n  - b\n'
			)
			await openBlock(app, 0)
			await sendKeystrokes(app, 'shift-tab')
			const lifted = await saveOnEscape(app, file, sunk)
			check(
				`Shift-Tab in the sunk item lifts it back beside the first (list-item.ts:219-225) (file ${JSON.stringify(lifted)})`,
				lifted === '- a\n- b\n'
			)
		})

		await withOpenOn(folder, 'list-fast', '- a\n- b\n', 0, async (app, file) => {
			await typeEach(app, ['tab', 'z'], 0)
			const text = await saveOnEscape(app, file, '- a\n- b\n')
			check(
				`Tab and z as separate key events right after each other in the second list item each land: Tab sinks it under the first and z follows b (list-item.ts:212-218) (file ${JSON.stringify(text)})`,
				text === '- a\n  - bz\n'
			)
		})

		await withOpenOn(folder, 'list-batch', '- a\n- b\n', 0, async (app, file) => {
			await sendKeystrokes(app, 'tab z')
			const text = await saveOnEscape(app, file, '- a\n- b\n')
			check(
				`Tab and z in one keystrokes call in the second list item each land: Tab sinks it under the first and z follows b (list-item.ts:212-218) (file ${JSON.stringify(text)})`,
				text === '- a\n  - bz\n'
			)
		})

		await withOpenOn(folder, 'list-click', '- a\n- b\n\nnext\n', 0, async (app, file) => {
			await sendKeystrokes(app, 'tab z')
			await app.getByTestId('block-1').click()
			const [text, open] = await saveAfterEscape(app, file, '- a\n- b\n\nnext\n')
			check(
				`Tab and z in one keystrokes call in the second list item, then a click on the next Block at once: Tab sinks the item under the first and z follows b before the click opens the next Block, and Escape leaves no field open (list-item.ts:212-218) (open ${open}, file ${JSON.stringify(text)})`,
				!open && text === '- a\n  - bz\n\nnext\n'
			)
		})

		await withOpenOn(folder, 'indent-fast', '- a\n- b\n', 0, async (app, file) => {
			await typeEach(app, ['cmd-]', 'z'], 0)
			const text = await saveOnEscape(app, file, '- a\n- b\n')
			check(
				`⌘] (Indent, editmd's sinkListItem) and z as separate key events right after each other in the second list item each land: the item sinks under the first and z follows b (list-item.ts:212-218) (file ${JSON.stringify(text)})`,
				text === '- a\n  - bz\n'
			)
		})

		await withOpenOn(folder, 'indent-selection', '- a\n- b\n- c\n', 0, async (app, file) => {
			await sendKeystrokes(app, 'shift-up')
			await sendKeystrokes(app, 'cmd-]')
			const [text, open] = await saveAfterEscape(app, file, '- a\n- b\n- c\n')
			check(
				`⌘] (Indent, editmd's sinkListItem) over a selection from after b to after c sinks both items under the first, and Escape leaves no field open (list-item.ts:212-218) (open ${open}, file ${JSON.stringify(text)})`,
				!open && text === '- a\n  - b\n  - c\n'
			)
		})

		await withOpenOn(folder, 'single', '- a\n', 0, async (app, file) => {
			await sendKeystrokes(app, 'tab')
			await sendKeystrokes(app, 'z')
			const text = await saveOnEscape(app, file, '- a\n')
			check(
				`Tab in the only list item, where sinking is refused, inserts plugin-indent's 2 spaces at the caret (list-item.ts:212-218; indent src/index.ts:52, 63-71) (file ${JSON.stringify(text)})`,
				text === '- a  z\n'
			)
		})

		await withOpenOn(folder, 'lift', 'para\n', 0, async (app, file) => {
			await sendKeystrokes(app, 'shift-tab')
			await pause(200)
			const open = await has(app, 'block-editor')
			await sendKeystrokes(app, 'z')
			const text = await saveOnEscape(app, file, 'para\n')
			check(
				`Shift-Tab in a paragraph changes nothing, as no list item lifts and plugin-indent binds Tab alone, and the field stays open (list-item.ts:219-225; indent src/index.ts:62-75) (open ${open}, file ${JSON.stringify(text)})`,
				open && text === 'paraz\n'
			)
		})

		await withOpenOn(folder, 'selection', 'para\n', 0, async (app, file) => {
			await sendKeystrokes(app, 'shift-left shift-left')
			await sendKeystrokes(app, 'tab')
			const text = await saveOnEscape(app, file, 'para\n')
			check(
				`Tab over a selection replaces it with 2 spaces, as in VS Code (user decision); editmd's plugin-indent would keep it (file ${JSON.stringify(text)})`,
				text === 'pa  \n'
			)
		})

		await withOpenOn(folder, 'source', 'para\n', null, async (app, file) => {
			await press(app, 'cmd-/')
			await app.getByTestId('source-editor').waitFor()
			await sendKeystrokes(app, 'tab')
			await sendKeystrokes(app, 'z')
			// Source mode keeps Escape in its field, so the 1s autosave writes the file
			const text = await waitForChange(file, 'para\n')
			check(
				`Tab in Source mode puts no tab character and no 2 spaces into the file: editmd's source view is a plain textarea with no Tab handler of its own (editor.ts:159-163) (file ${JSON.stringify(text)})`,
				!text.includes('\t') && !text.includes('  ')
			)
		})
	})
})

test('every check ran', () => expect(countChecks()).toBe(13))
