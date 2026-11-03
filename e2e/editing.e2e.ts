/**
 * end to end: Return and Backspace in a real window, on an existing file and on an empty one, each sequence typed one
 * key per call (as a person types slowly) and as one batch (one call: the field takes every key before the controller
 * hears any of them, as fast typing delivers them), against editmd's own keymaps run in its editor (kit harness
 * scripts/parity/editmd-keys.test.mjs): ProseMirror's base keymap and Milkdown's list, hard break and code keymaps
 * (@milkdown/core src/internal-plugin/keymap.ts:11-17, 32-41; @milkdown/preset-commonmark src/node/list-item.ts:167-206,
 * src/node/hardbreak.ts). every check asserts the file ⌘S saves exactly, so a stray character fails it, and that
 * Escape leaves no field open on raw markdown
 *
 * run: pnpm --dir . exec gpuix-svelte e2e/editing.e2e.ts (unsandboxed: it opens windows and takes the keyboard)
 * the files, the app's support folder and the agents it counts live in a temp folder, so nothing reaches the real ones
 */

import { mkdtempSync, rmSync } from 'node:fs'
import {
	check,
	type Editor,
	finish,
	keystrokes,
	openOn,
	painted,
	pause,
	saveAfterEscape,
	typeEach
} from './support.ts'

// a short root: the window's agent socket inside it must fit macOS's 104-byte socket path limit
const folder = mkdtempSync('/tmp/eg-edit-')

/** one step of a sequence: keystrokes, or a Backspace pressed as a person does, key down then up */
type Step = string | { backspace: 'press' | 'rolled'; then?: string }

type Case = {
	name: string
	/** the Block text an existing file holds before `Second`, and the keys that type it into an empty one */
	source: string
	setup: string[]
	/** the Block clicked in the existing file; the keys that put the caret where the sequence starts */
	block: number
	caret: string
	steps: Step[]
	/** what editmd saves, without the existing file's `Second` */
	saved: string
}

/** `text` as the keys that type it, one per character */
const keysOf = (text: string) =>
	[...text].map((character) => (character === ' ' ? 'space' : character))

const CASES: Case[] = [
	{
		name: 'paragraph end, Return, `next`',
		source: 'Hello world',
		setup: keysOf('Hello world'),
		block: 0,
		caret: 'cmd-down',
		steps: ['enter', ...keysOf('next')],
		saved: 'Hello world\n\nnext'
	},
	{
		name: 'heading end, Return, `body`',
		source: '# Title',
		setup: keysOf('# Title'),
		block: 0,
		caret: 'cmd-down',
		steps: ['enter', ...keysOf('body')],
		saved: '# Title\n\nbody'
	},
	{
		name: 'Return between `one` and `two`, `x`',
		source: 'onetwo',
		setup: keysOf('onetwo'),
		block: 0,
		caret: 'cmd-down left left left',
		steps: ['enter', 'x'],
		saved: 'one\n\nxtwo'
	},
	{
		name: 'Shift-Return, `more` (hard break)',
		source: 'Hello world',
		setup: keysOf('Hello world'),
		block: 0,
		caret: 'cmd-down',
		steps: ['shift-enter', ...keysOf('more')],
		saved: 'Hello world\\\nmore'
	},
	{
		name: 'list item end, Return, `three`',
		source: '- one\n- two',
		setup: [...keysOf('- one'), 'enter', ...keysOf('two')],
		block: 0,
		caret: 'cmd-down',
		steps: ['enter', ...keysOf('three')],
		saved: '- one\n- two\n- three'
	},
	{
		name: 'list item end, Return, Backspace, `!` (the new bullet goes)',
		source: '- one\n- two',
		setup: [...keysOf('- one'), 'enter', ...keysOf('two')],
		block: 0,
		caret: 'cmd-down',
		steps: ['enter', 'backspace', '!'],
		saved: '- one\n- two\n\n  !'
	},
	{
		name: 'list item end, Return, Return, `after` (leaves the list)',
		source: '- one\n- two',
		setup: [...keysOf('- one'), 'enter', ...keysOf('two')],
		block: 0,
		caret: 'cmd-down',
		steps: ['enter', 'enter', ...keysOf('after')],
		saved: '- one\n- two\n\nafter'
	},
	{
		name: 'quote end, Return, `more`',
		source: '> quoted',
		setup: keysOf('> quoted'),
		block: 0,
		caret: 'cmd-down',
		steps: ['enter', ...keysOf('more')],
		saved: '> quoted\n>\n> more'
	},
	{
		name: 'quote end, Return, Return, `after` (leaves the quote)',
		source: '> quoted',
		setup: keysOf('> quoted'),
		block: 0,
		caret: 'cmd-down',
		steps: ['enter', 'enter', ...keysOf('after')],
		saved: '> quoted\n\nafter'
	},
	{
		name: 'code end, Return, `y` (the newline stays in the code)',
		source: '```js\nx\n```',
		setup: [...keysOf('```js'), 'enter', 'x'],
		block: 0,
		caret: 'cmd-down up cmd-right',
		steps: ['enter', 'y'],
		saved: '```js\nx\ny\n```'
	},
	{
		name: 'Backspace at a paragraph’s start (joins it onto the one above)',
		source: 'one\n\ntwo',
		setup: [...keysOf('one'), 'enter', ...keysOf('two')],
		block: 1,
		caret: 'cmd-up',
		steps: [{ backspace: 'press' }],
		saved: 'onetwo'
	},
	{
		name: 'Backspace at a paragraph’s start, `X` typed before it goes up (joins, `X` where they meet)',
		source: 'one\n\ntwo',
		setup: [...keysOf('one'), 'enter', ...keysOf('two')],
		block: 1,
		caret: 'cmd-up',
		steps: [{ backspace: 'rolled', then: 'X' }],
		saved: 'oneXtwo'
	}
]

/** the existing file's Blocks after the case's, which no key may touch */
const AFTER = '\n\nSecond\n'

/** a Backspace as a person presses it; `rolled` types `then` while it is still down, as fast typing rolls keys */
async function backspace(app: Editor, step: Exclude<Step, string>): Promise<void> {
	await app.call('keyDown', { key: 'backspace' })
	if (step.backspace === 'rolled' && step.then) await keystrokes(app, step.then)
	await app.call('keyUp', { key: 'backspace' })
	await pause(150)
	if (step.backspace === 'press' && step.then) await typeEach(app, keysOf(step.then))
}

/** the steps one key per call, or every run of keystrokes between Backspace presses as one call */
async function runSteps(app: Editor, steps: Step[], batch: boolean): Promise<void> {
	const keys: string[] = []
	const flush = async () => {
		if (keys.length > 0) await (batch ? keystrokes(app, keys.join(' ')) : typeEach(app, keys))
		keys.length = 0
	}
	for (const step of steps) {
		if (typeof step === 'string') keys.push(step)
		else {
			await flush()
			await backspace(app, step)
		}
	}
	await flush()
}

try {
	for (const [index, each] of CASES.entries()) {
		for (const existing of [true, false]) {
			for (const batch of [false, true]) {
				const text = existing ? `${each.source}${AFTER}` : ''
				const want = existing ? `${each.saved}${AFTER}` : `${each.saved}\n`
				const { app, file } = await openOn(
					folder,
					`case-${index}-${existing}-${batch}`,
					text,
					each.block
				)
				try {
					if (existing) await keystrokes(app, each.caret)
					else {
						await typeEach(app, each.setup)
						if (each.caret === 'cmd-up' || each.caret.includes('left'))
							await keystrokes(app, each.caret)
					}
					await pause(200)
					// what the window paints with the caret placed, before the sequence: a stray character shows here first
					const placed = await painted(app)
					await runSteps(app, each.steps, batch)
					const typed = await painted(app)
					const [saved, open] = await saveAfterEscape(app, file, text)
					check(
						`${each.name}, ${existing ? 'existing file' : 'empty file'}, ${batch ? 'one batch' : 'one key per call'}: ⌘S saves ${JSON.stringify(want)} and Escape leaves no field open (saved ${JSON.stringify(saved)}, field open ${open}, painted with the caret placed ${JSON.stringify(placed)}, after the keys ${JSON.stringify(typed)})`,
						saved === want && !open
					)
				} finally {
					await app.close().catch(() => {})
				}
			}
		}
	}
} catch (error) {
	check(`no error: ${error instanceof Error ? error.message : String(error)}`, false)
} finally {
	rmSync(folder, { recursive: true, force: true })
}

finish('editing')
