/**
 * end to end: typing into an empty Document's field in a real window, as a user does, against editmd's Milkdown:
 * Return is ProseMirror's base keymap (`newlineInCode`, `createParagraphNear`, `liftEmptyBlock`, `splitBlock`), which
 * Milkdown keeps (@milkdown/core src/internal-plugin/keymap.ts:11-17, 32-41), with the commonmark `listItemKeymap`'s
 * Enter first in a list (@milkdown/preset-commonmark src/node/list-item.ts:200-206), and `# ` or a fence turn the
 * Block into a heading or code as they are typed (src/node/heading.ts:112-133, src/node/code-block.ts:100-110)
 */

import { expect, test } from 'vitest'
import {
	check,
	countChecks,
	type Editor,
	has,
	isMetWithin,
	loadPaintedText,
	loadText,
	openOn,
	press,
	runInFolder,
	toKeys,
	typeEach,
	waitForChange
} from './support.ts'

/**
 * the save-status label's texts (controller.svelte.ts `label`), which paint beside the Blocks while a file saves and
 * change between two reads, so they are left out by text rather than read once and removed
 */
const SAVE_LABELS = new Set(['Saving…', 'Saved', 'Not Saved'])

/** the Blocks' painted lines: the menu bar's titles and the save-status label left out */
const loadPaintedLines = async (app: Editor) =>
	(await loadPaintedText(app)).split('\n').filter((line) => line !== '' && !SAVE_LABELS.has(line))

/**
 * the open field's painted height, 0 while there is not exactly one: the input rule mounts a fresh field, and two can
 * be there for a frame
 */
async function loadFieldHeight(app: Editor): Promise<number> {
	const field = app.getByTestId('block-editor')
	return (await field.count()) === 1 ? (await field.bounds()).height : 0
}

/**
 * each window is on a new empty file of its own, so a launch never finds the last window still holding it and exits;
 * its field is open from the load as editmd focuses its editor (main.ts:80-84), and clicked, as the user's click puts
 * the keyboard in it. the keys go one call per key, as a person types them
 */
test('typing', async () => {
	await runInFolder('typing', async (folder) => {
		{
			const { app, file } = await openOn(folder, 'heading', '', null)
			try {
				const paragraphHeight = await loadFieldHeight(app)
				await typeEach(app, toKeys('# '), 0)
				let headingHeight = 0
				let rule = false
				const headingAtOnce = await isMetWithin(async () => {
					headingHeight = await loadFieldHeight(app)
					rule = await has(app, 'block-editor-rule')
					return headingHeight > paragraphHeight && rule
				}, 500)
				check(
					`typing \`# \` into an empty field shows the heading look at once, before Return, as editmd's input rule makes the heading on the space: the field grows from the body's line to an h1's, over its rule (heading.ts:112-133) (height ${paragraphHeight} then ${headingHeight}, rule ${rule})`,
					headingAtOnce
				)

				await typeEach(app, [...toKeys('Title'), 'enter', ...toKeys('body'), 'escape'], 0)
				await isMetWithin(() => has(app, 'block-1'), 4000)
				const lines = await loadPaintedLines(app)
				const heading = await has(app, 'heading-rule-0')
				const paragraph = (await has(app, 'block-1')) && !(await has(app, 'heading-rule-1'))
				const third = await has(app, 'block-2')
				check(
					`Return at the end of \`# Title\` ends the heading and \`body\` goes into a new paragraph below it, as editmd's splitBlock does: Block 0 paints as an h1 over its rule, Block 1 as a plain paragraph (heading ${heading}, paragraph ${paragraph}, third Block ${third}, painted ${JSON.stringify(lines)})`,
					heading &&
						paragraph &&
						!third &&
						JSON.stringify(lines) === JSON.stringify(['Title', 'body'])
				)
				await press(app, 'cmd-s')
				const text = await waitForChange(file, '')
				check(
					`\`# Title\`, Return, \`body\`, Escape, ⌘S saves the heading, a blank line and the paragraph, ending in a newline as editmd's serializer does (file ${JSON.stringify(text)})`,
					text === '# Title\n\nbody\n'
				)
			} finally {
				await app.close().catch(() => {})
			}
		}

		{
			const { app, file } = await openOn(folder, 'list', '', null)
			try {
				await typeEach(
					app,
					[...toKeys('- a'), 'enter', 'b', 'enter', 'enter', ...toKeys('after'), 'escape'],
					0
				)
				await isMetWithin(() => has(app, 'block-1'), 4000)
				const list = await has(app, 'list-0')
				const after = (await has(app, 'block-1')) && !(await has(app, 'list-1'))
				const third = await has(app, 'block-2')
				check(
					`Return on the empty third item leaves the list, as editmd's liftEmptyBlock does, and \`after\` paints as a paragraph below it (list-item.ts:200-206) (list ${list}, paragraph after ${after}, third Block ${third})`,
					list && after && !third
				)
				await press(app, 'cmd-s')
				const text = await waitForChange(file, '')
				check(
					`\`- a\`, Return, \`b\`, Return, Return, \`after\`, Escape, ⌘S saves two items and a paragraph after the list (file ${JSON.stringify(text)})`,
					text === '- a\n- b\n\nafter\n'
				)
			} finally {
				await app.close().catch(() => {})
			}
		}

		{
			const { app, file } = await openOn(folder, 'code', '', null)
			try {
				await typeEach(app, [...toKeys('```js'), 'enter', 'x', 'enter'], 0)
				// a split would close the code at the fence line, paint it as Block 0 and open a paragraph's field, no card
				const inCode = await isMetWithin(
					async () => (await has(app, 'block-editor-card')) && !(await has(app, 'block-0')),
					1000
				)
				check(
					`Return after \`\`\`js and after \`x\` keeps each newline in the code, as editmd's newlineInCode does: the field stays in its code card and no Block is split off (keymap.ts:11-17, 32-41)`,
					inCode
				)
				await typeEach(app, ['escape'], 0)
				await isMetWithin(() => has(app, 'code-card-0'), 4000)
				const card = await has(app, 'code-card-0')
				const label = await loadText(app, 'code-label-0')
				const second = await has(app, 'block-1')
				await press(app, 'cmd-s')
				const text = await waitForChange(file, '')
				check(
					`Escape leaves one code Block labelled js holding \`x\`, and ⌘S saves it (card ${card}, label ${JSON.stringify(label)}, second Block ${second}, file ${JSON.stringify(text)})`,
					card && label === 'js' && !second && text.startsWith('```js\nx\n')
				)
			} finally {
				await app.close().catch(() => {})
			}
		}
	})
})

test('every check ran', () => expect(countChecks()).toBe(7))
