/**
 * end to end: Return and Backspace in the app's window (headless by default, a real one with `test:e2e:window`), on an
 * existing file and on an empty one, each sequence typed one key per call (as a person types slowly) and as one batch
 * (one call: the field takes every key before the controller hears any of them, as fast typing delivers them), against
 * editmd's own keymaps run in its editor: ProseMirror's base keymap and Milkdown's list, hard break and code keymaps
 * (@milkdown/core src/internal-plugin/keymap.ts:11-17, 32-41; @milkdown/preset-commonmark
 * src/node/list-item.ts:167-206, src/node/hardbreak.ts)
 *
 * Every check asserts the file ⌘S saves exactly, so a stray character fails it, and that Escape leaves no field open on
 * raw markdown.
 */

import { expect, test } from 'vitest'
import {
	AFTER,
	check,
	countChecks,
	describeRun,
	type Editor,
	loadPaintedText,
	pause,
	pressBackspace,
	runInFolder,
	saveAfterEscape,
	sendKeystrokes,
	toKeys,
	typeEach,
	withOpenOn
} from './support.ts'

/**
 * one step of a sequence: keystrokes, or a Backspace pressed as a person does, key down then up; `rolled` types `then`
 * while it is still down, as fast typing rolls keys
 */
type Step = string | { backspace: 'press' } | { backspace: 'rolled'; then: string }

type Case = {
	name: string
	/**
	 * the Block text an existing file holds before `Second`, and the keys that type it into an empty one, by default its
	 * own characters
	 */
	source: string
	setup?: string[]
	/**
	 * the Block clicked in the existing file, 0 by default; the keys that put the caret where the sequence starts, by
	 * default `cmd-down`
	 */
	block?: number
	caret?: string
	steps: Step[]
	/** what editmd saves, without the existing file's `Second` */
	saved: string
}

const CASES: Case[] = [
	{
		name: 'paragraph end, Return, `next`',
		source: 'Hello world',
		steps: ['enter', ...toKeys('next')],
		saved: 'Hello world\n\nnext'
	},
	{
		name: 'heading end, Return, `body`',
		source: '# Title',
		steps: ['enter', ...toKeys('body')],
		saved: '# Title\n\nbody'
	},
	{
		name: 'Return between `one` and `two`, `x`',
		source: 'onetwo',
		caret: 'cmd-down left left left',
		steps: ['enter', 'x'],
		saved: 'one\n\nxtwo'
	},
	{
		name: 'Shift-Return, `more` (hard break)',
		source: 'Hello world',
		steps: ['shift-enter', ...toKeys('more')],
		saved: 'Hello world\\\nmore'
	},
	{
		name: 'list item end, Return, `three`',
		source: '- one\n- two',
		setup: [...toKeys('- one'), 'enter', ...toKeys('two')],
		steps: ['enter', ...toKeys('three')],
		saved: '- one\n- two\n- three'
	},
	{
		name: 'list item end, Return, Backspace, `!` (the new bullet goes)',
		source: '- one\n- two',
		setup: [...toKeys('- one'), 'enter', ...toKeys('two')],
		steps: ['enter', 'backspace', '!'],
		saved: '- one\n- two\n\n  !'
	},
	{
		name: 'list item end, Return, Return, `after` (leaves the list)',
		source: '- one\n- two',
		setup: [...toKeys('- one'), 'enter', ...toKeys('two')],
		steps: ['enter', 'enter', ...toKeys('after')],
		saved: '- one\n- two\n\nafter'
	},
	{
		name: 'quote end, Return, `more`',
		source: '> quoted',
		steps: ['enter', ...toKeys('more')],
		saved: '> quoted\n>\n> more'
	},
	{
		name: 'quote end, Return, Return, `after` (leaves the quote)',
		source: '> quoted',
		steps: ['enter', 'enter', ...toKeys('after')],
		saved: '> quoted\n\nafter'
	},
	{
		name: 'code end, Return, `y` (the newline stays in the code)',
		source: '```js\nx\n```',
		setup: [...toKeys('```js'), 'enter', 'x'],
		caret: 'cmd-down up cmd-right',
		steps: ['enter', 'y'],
		saved: '```js\nx\ny\n```'
	},
	{
		name: 'Backspace at a paragraph’s start (joins it onto the one above)',
		source: 'one\n\ntwo',
		setup: [...toKeys('one'), 'enter', ...toKeys('two')],
		block: 1,
		caret: 'cmd-up',
		steps: [{ backspace: 'press' }],
		saved: 'onetwo'
	},
	{
		name: 'Backspace at a paragraph’s start, `X` typed before it goes up (joins, `X` where they meet)',
		source: 'one\n\ntwo',
		setup: [...toKeys('one'), 'enter', ...toKeys('two')],
		block: 1,
		caret: 'cmd-up',
		steps: [{ backspace: 'rolled', then: 'X' }],
		saved: 'oneXtwo'
	}
]

/** the steps one key per call, or every run of keystrokes between Backspace presses as one call */
async function runSteps(app: Editor, steps: Step[], batch: boolean): Promise<void> {
	const keys: string[] = []
	const flush = async () => {
		if (keys.length > 0) await (batch ? sendKeystrokes(app, keys.join(' ')) : typeEach(app, keys))

		keys.length = 0
	}
	for (const step of steps) {
		if (typeof step === 'string') {
			keys.push(step)
		} else {
			await flush()
			await pressBackspace(app, step.backspace === 'rolled' ? step.then : undefined)
		}
	}
	await flush()
}

test('editing', async () => {
	await runInFolder('edit', async (folder) => {
		for (const [index, testCase] of CASES.entries()) {
			const caret = testCase.caret ?? 'cmd-down'
			for (const existing of [true, false]) {
				for (const batch of [false, true]) {
					const text = existing ? `${testCase.source}${AFTER}` : ''
					const want = existing ? `${testCase.saved}${AFTER}` : `${testCase.saved}\n`
					const name = `case-${index}-${existing}-${batch}`
					await withOpenOn(folder, name, text, testCase.block ?? 0, async (app, file) => {
						if (existing) {
							await sendKeystrokes(app, caret)
						} else {
							await typeEach(app, testCase.setup ?? toKeys(testCase.source))
							if (caret === 'cmd-up' || caret.includes('left')) await sendKeystrokes(app, caret)
						}
						await pause(200)
						// what the window paints with the caret placed, before the sequence: a stray character shows here first
						const placed = await loadPaintedText(app)
						await runSteps(app, testCase.steps, batch)
						const typed = await loadPaintedText(app)
						const [saved, open] = await saveAfterEscape(app, file, text)
						check(
							`${testCase.name}, ${describeRun(existing, batch)}: ⌘S saves ${JSON.stringify(want)} and Escape leaves no field open (saved ${JSON.stringify(saved)}, field open ${open}, painted with the caret placed ${JSON.stringify(placed)}, after the keys ${JSON.stringify(typed)})`,
							saved === want && !open
						)
					})
				}
			}
		}
	})
})

test('every check ran', () => expect(countChecks()).toBe(48))
