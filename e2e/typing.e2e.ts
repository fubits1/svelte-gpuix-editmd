/**
 * end to end: typing into an empty Document's field in a real window, as a user does, against editmd's Milkdown:
 * Return is ProseMirror's base keymap (`newlineInCode`, `createParagraphNear`, `liftEmptyBlock`, `splitBlock`), which
 * Milkdown keeps (@milkdown/core src/internal-plugin/keymap.ts:11-17, 32-41), with the commonmark `listItemKeymap`'s
 * Enter first in a list (@milkdown/preset-commonmark src/node/list-item.ts:200-206), and `# ` or a fence turn the
 * Block into a heading or code as they are typed (src/node/heading.ts:112-133, src/node/code-block.ts:100-110)
 *
 * run: pnpm --dir . exec gpuix-svelte e2e/typing.e2e.ts (unsandboxed: it opens a window)
 * the files, the app's support folder and the agents it counts live in a temp folder, so nothing reaches the real ones
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from 'gpuix-svelte/automation'
import { agentsIn, check, type Editor, finish, painted, press, reaches, textOf } from './support.ts'

// a short root: the window's agent socket inside it must fit macOS's 104-byte socket path limit
const folder = mkdtempSync('/tmp/eg-typing-')

/**
 * a window on a new empty file `name`.md, its field open from the load as editmd focuses its editor (main.ts:80-84);
 * the click puts the keyboard in it as the user's does. not support's `openEditor`, which waits for a Block 0 an empty
 * file has not got. each window has its own file, so a launch never finds the last window still holding it and exits
 */
async function openEmpty(name: string): Promise<{ app: Editor; file: string }> {
	const file = join(folder, `${name}.md`)
	writeFileSync(file, '')
	const app = await launch({
		entry: 'standalone.ts',
		args: [file],
		env: { EDITMD_GPUIX_SUPPORT: join(folder, 'support'), ...agentsIn(folder) }
	})
	const field = app.getByTestId('block-editor')
	await field.waitFor({ timeoutMs: 10_000 })
	await field.click()
	return { app, file }
}

/** one keystrokes call per key: one call delivers its keys as one batch, separate calls arrive as a person types */
async function typeEach(app: Editor, keys: string[]): Promise<void> {
	for (const key of keys) await app.call('keystrokes', { keys: key })
}

/** `text` as the keys that type it */
const keysOf = (text: string) =>
	[...text].map((character) => (character === ' ' ? 'space' : character))

const has = async (app: Editor, testId: string) => (await app.getByTestId(testId).count()) > 0

/**
 * the save-status label's texts (controller.svelte.ts `label`), which paint beside the Blocks while a file saves and
 * change between two reads, so they are left out by text rather than read once and removed
 */
const SAVE_LABELS = new Set(['Saving…', 'Saved', 'Not Saved'])

/** the Blocks' painted lines: the menu bar's titles and the save-status label left out */
const paintedLines = async (app: Editor) =>
	(await painted(app)).split('\n').filter((line) => line !== '' && !SAVE_LABELS.has(line))

/**
 * the open field's painted height, 0 while there is not exactly one: the input rule mounts a fresh field, and two can
 * be there for a frame
 */
async function fieldHeight(app: Editor): Promise<number> {
	const field = app.getByTestId('block-editor')
	return (await field.count()) === 1 ? (await field.bounds()).height : 0
}

/** ⌘S, then the file once it holds the save, or as it stands after 4s */
async function savedText(app: Editor, file: string): Promise<string> {
	await press(app, 'cmd-s')
	await reaches(() => readFileSync(file, 'utf8') !== '', 4000)
	return readFileSync(file, 'utf8')
}

try {
	{
		const { app, file } = await openEmpty('heading')
		try {
			const paragraphHeight = await fieldHeight(app)
			await typeEach(app, keysOf('# '))
			let headingHeight = 0
			let rule = false
			const headingAtOnce = await reaches(async () => {
				headingHeight = await fieldHeight(app)
				rule = await has(app, 'block-editor-rule')
				return headingHeight > paragraphHeight && rule
			}, 500)
			check(
				`typing \`# \` into an empty field shows the heading look at once, before Return, as editmd's input rule makes the heading on the space: the field grows from the body's line to an h1's, over its rule (heading.ts:112-133) (height ${paragraphHeight} then ${headingHeight}, rule ${rule})`,
				headingAtOnce
			)

			await typeEach(app, [...keysOf('Title'), 'enter', ...keysOf('body'), 'escape'])
			await reaches(() => has(app, 'block-1'), 4000)
			const lines = await paintedLines(app)
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
			const text = await savedText(app, file)
			check(
				`\`# Title\`, Return, \`body\`, Escape, ⌘S saves the heading, a blank line and the paragraph, ending in a newline as editmd's serializer does (file ${JSON.stringify(text)})`,
				text === '# Title\n\nbody\n'
			)
		} finally {
			await app.close().catch(() => {})
		}
	}

	{
		const { app, file } = await openEmpty('list')
		try {
			await typeEach(app, [
				...keysOf('- a'),
				'enter',
				'b',
				'enter',
				'enter',
				...keysOf('after'),
				'escape'
			])
			await reaches(() => has(app, 'block-1'), 4000)
			const list = await has(app, 'list-0')
			const after = (await has(app, 'block-1')) && !(await has(app, 'list-1'))
			const third = await has(app, 'block-2')
			check(
				`Return on the empty third item leaves the list, as editmd's liftEmptyBlock does, and \`after\` paints as a paragraph below it (list-item.ts:200-206) (list ${list}, paragraph after ${after}, third Block ${third})`,
				list && after && !third
			)
			const text = await savedText(app, file)
			check(
				`\`- a\`, Return, \`b\`, Return, Return, \`after\`, Escape, ⌘S saves two items and a paragraph after the list (file ${JSON.stringify(text)})`,
				text === '- a\n- b\n\nafter\n'
			)
		} finally {
			await app.close().catch(() => {})
		}
	}

	{
		const { app, file } = await openEmpty('code')
		try {
			await typeEach(app, [...keysOf('```js'), 'enter', 'x', 'enter'])
			// a split would close the code at the fence line, paint it as Block 0 and open a paragraph's field, no card
			const inCode = await reaches(
				async () => (await has(app, 'block-editor-card')) && !(await has(app, 'block-0')),
				1000
			)
			check(
				`Return after \`\`\`js and after \`x\` keeps each newline in the code, as editmd's newlineInCode does: the field stays in its code card and no Block is split off (keymap.ts:11-17, 32-41)`,
				inCode
			)
			await typeEach(app, ['escape'])
			await reaches(() => has(app, 'code-card-0'), 4000)
			const card = await has(app, 'code-card-0')
			const label = await textOf(app, 'code-label-0')
			const second = await has(app, 'block-1')
			const text = await savedText(app, file)
			check(
				`Escape leaves one code Block labelled js holding \`x\`, and ⌘S saves it (card ${card}, label ${JSON.stringify(label)}, second Block ${second}, file ${JSON.stringify(text)})`,
				card && label === 'js' && !second && text.startsWith('```js\nx\n')
			)
		} finally {
			await app.close().catch(() => {})
		}
	}
} catch (error) {
	check(`no error: ${error instanceof Error ? error.message : String(error)}`, false)
} finally {
	rmSync(folder, { recursive: true, force: true })
}

finish('typing')
