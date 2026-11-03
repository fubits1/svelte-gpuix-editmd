/**
 * end to end: inline marks in a real window, on an existing file and on an empty one, each sequence sent one key per
 * call (as a person types slowly) and as one batch (one call: the field takes every key before the controller hears
 * any of them, so typing lands while a toggle's probe is still reading the selection). markdown typed into a field is
 * saved as typed and painted without its marks; Bold, Italic, Inline Code and Strikethrough toggle as editmd's
 * ProseMirror toggleMark does, measured in editmd's own editor (kit harness scripts/parity/editmd-commands.test.mjs,
 * `e-inline-format`); with no field open Bold acts at editmd's load caret, as test.ts's load-caret Bold check has it.
 * every check asserts the file ⌘S saves exactly, so a stray character fails it, and that Escape leaves no field open;
 * the painted text after each step is printed, so a stray character shows where it came from
 *
 * run: pnpm --dir . exec gpuix-svelte e2e/inline.e2e.ts (unsandboxed: it opens windows and takes the keyboard)
 * the files, the app's support folder and the agents it counts live in a temp folder, so nothing reaches the real ones
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from 'gpuix-svelte/automation'
import {
	agentsIn,
	check,
	type Editor,
	finish,
	openEditor,
	painted,
	pause,
	press,
	reaches
} from './support.ts'

// a short root: the window's agent socket inside it must fit macOS's 104-byte socket path limit
const folder = mkdtempSync('/tmp/eg-inline-')

/** one step of a sequence: a key, or a Format menu row clicked through the in-window menu bar */
type Step = string | { menu: 'Format'; row: number; title: string }

/**
 * the saved Block text, or, where the harness measured no such case, a looser rule: the text with every `mark` taken
 * out is `without`, and `mark` is in it exactly twice (one pair)
 */
type Want = string | { without: string; mark: string }

type Case = {
	name: string
	/** the Block text an existing file holds before `Second`, and the keys that type it into an empty one */
	source: string
	setup: string[]
	/** the keys that put the caret or the selection where the sequence starts, in Block 0's field */
	caret: string
	steps: Step[]
	/** what editmd saves, without the existing file's `Second` */
	saved: Want
	/** the text the closed Block paints, its marks gone (no `*`, backtick or `~` painted anywhere) */
	paints?: string
	/** no field open when the sequence starts: the existing file is opened and nothing clicked (no empty-file run) */
	closed?: boolean
}

/** `text` as the keys that type it, one per character */
const keysOf = (text: string) =>
	[...text].map((character) => (character === ' ' ? 'space' : character))

/** the caret after `one two` in `one two three`, then `two` selected word-wise, as a person selects it */
const SELECT_TWO = 'cmd-left right right right right right right right shift-alt-left'
const ONE_TWO_THREE = keysOf('one two three')
const FORMAT_BOLD: Step = { menu: 'Format', row: 0, title: 'Bold' }

const CASES: Case[] = [
	{
		name: 'typed `**two**`, `*it*`, a backtick pair and `~~gone~~` (saved as typed, painted without the marks)',
		source: 'start',
		setup: keysOf('start'),
		caret: 'cmd-right',
		steps: keysOf(' one **two** three *it* `code` ~~gone~~'),
		saved: 'start one **two** three *it* `code` ~~gone~~',
		paints: 'start one two three it code gone'
	},
	{
		name: '⌘B on `two` (bold on "two" on "one two three")',
		source: 'one two three',
		setup: ONE_TWO_THREE,
		caret: SELECT_TWO,
		steps: ['cmd-b'],
		saved: 'one **two** three'
	},
	{
		name: '⌘I on `two` (italic on "two" on "one two three")',
		source: 'one two three',
		setup: ONE_TWO_THREE,
		caret: SELECT_TWO,
		steps: ['cmd-i'],
		saved: 'one _two_ three'
	},
	{
		name: '⌘E on `two` (code on "two" on "one two three")',
		source: 'one two three',
		setup: ONE_TWO_THREE,
		caret: SELECT_TWO,
		steps: ['cmd-e'],
		saved: 'one `two` three'
	},
	{
		name: '⇧⌘X on `two` (strikethrough on "two" on "one two three")',
		source: 'one two three',
		setup: ONE_TWO_THREE,
		caret: SELECT_TWO,
		steps: ['cmd-shift-x'],
		saved: 'one ~~two~~ three'
	},
	{
		name: '⌘B twice on `two` (the second takes the mark off: bold on "two" on "one **two** three")',
		source: 'one two three',
		setup: ONE_TWO_THREE,
		caret: SELECT_TWO,
		steps: ['cmd-b', 'cmd-b'],
		saved: 'one two three'
	},
	{
		name: '⌘B at the end of `one two`, `x` (bold on "", then "x" typed on "one two")',
		source: 'one two',
		setup: keysOf('one two'),
		caret: 'cmd-right',
		steps: ['cmd-b', 'x'],
		saved: 'one two**x**'
	},
	{
		name: '⌘I after `one `, `x` (italic on "", then "x" typed on "one two")',
		source: 'one two',
		setup: keysOf('one two'),
		caret: 'cmd-left right right right right',
		steps: ['cmd-i', 'x'],
		saved: 'one _x_two'
	},
	{
		name: '⌘B after `one `, `bold` (no harness case: one pair, `bold` once, nothing else)',
		source: 'one two three',
		setup: ONE_TWO_THREE,
		caret: 'cmd-left right right right right',
		steps: ['cmd-b', ...keysOf('bold')],
		saved: { without: 'one boldtwo three', mark: '**' }
	},
	{
		name: '⌘B on `two`, Right, ` x` (no harness case: one pair, ` x` once, nothing else)',
		source: 'one two three',
		setup: ONE_TWO_THREE,
		caret: SELECT_TWO,
		steps: ['cmd-b', 'right', ...keysOf(' x')],
		saved: { without: 'one two x three', mark: '**' }
	},
	{
		name: 'Format > Bold from the menu bar on `two` (the same as ⌘B)',
		source: 'one two three',
		setup: ONE_TWO_THREE,
		caret: SELECT_TWO,
		steps: [FORMAT_BOLD],
		saved: 'one **two** three'
	},
	{
		name: 'no field open, ⌘B, `x` (at the load caret: `**x**one`, as test.ts)',
		source: 'one two three',
		setup: [],
		caret: '',
		steps: ['cmd-b', 'x'],
		saved: '**x**one two three',
		closed: true
	},
	{
		name: 'no field open, ⌘B, nothing typed (the empty pair comes out: the file as it was, as test.ts)',
		source: 'one two three',
		setup: [],
		caret: '',
		steps: ['cmd-b'],
		saved: 'one two three',
		closed: true
	}
]

/** the existing file's Blocks after the case's, which no key may touch */
const AFTER = '\n\nSecond\n'

/**
 * a window on `text` in `name`.md: an existing file's Block 0 clicked open (left closed with `closed`), or an empty
 * file's own field
 */
async function openOn(
	name: string,
	text: string,
	closed: boolean
): Promise<{ app: Editor; file: string }> {
	const file = join(folder, `${name}.md`)
	writeFileSync(file, text)
	if (text !== '') {
		const app = await openEditor(file, folder)
		if (!closed) {
			await app.getByTestId('block-0').click()
			await app.getByTestId('block-editor').waitFor()
		}
		return { app, file }
	}
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

const keystrokes = (app: Editor, keys: string) => app.call('keystrokes', { keys })

/**
 * one call per key, two frames apart as automation waits, and a pause for a remounted field's caret; a command key
 * (⌘, ⇧⌘) waits longer, as a person who presses a shortcut does, so its probe settles before the next key
 */
async function typeEach(app: Editor, keys: string[], shown: string[]): Promise<void> {
	for (const key of keys) {
		await keystrokes(app, key)
		await pause(key.startsWith('cmd-') ? 300 : 60)
		shown.push(`${key}: ${JSON.stringify(await painted(app))}`)
	}
}

/** the in-window menu bar's `step.menu`, then its row `step.row` */
async function chooseMenu(app: Editor, step: Exclude<Step, string>): Promise<void> {
	await app.getByTestId('menu-title-2').click()
	const row = app.getByTestId(`menu-row-${step.row}`)
	await row.waitFor()
	await row.click()
	await pause(300)
}

/**
 * the steps one key per call, or every run of keys between menu rows as one call; returns the painted text after each
 * key (one key per call) or each run (one batch), labelled by what was sent
 */
async function runSteps(app: Editor, steps: Step[], batch: boolean): Promise<string[]> {
	const shown: string[] = []
	const keys: string[] = []
	const flush = async () => {
		if (keys.length === 0) return
		if (batch) {
			await keystrokes(app, keys.join(' '))
			await pause(300)
			shown.push(`${keys.join(' ')}: ${JSON.stringify(await painted(app))}`)
		} else await typeEach(app, keys, shown)
		keys.length = 0
	}
	for (const step of steps) {
		if (typeof step === 'string') keys.push(step)
		else {
			await flush()
			await chooseMenu(app, step)
			shown.push(`${step.menu} > ${step.title}: ${JSON.stringify(await painted(app))}`)
		}
	}
	await flush()
	return shown
}

/** Escape and ⌘S: the file once it differs from `before`, or as it stands after 4s, and whether a field is still open */
async function saveAfterEscape(
	app: Editor,
	file: string,
	before: string
): Promise<[string, boolean]> {
	await pause(300)
	await keystrokes(app, 'escape')
	await pause(200)
	const open = (await app.getByTestId('block-editor').count()) > 0
	await press(app, 'cmd-s')
	await reaches(() => readFileSync(file, 'utf8') !== before, 4000)
	return [readFileSync(file, 'utf8'), open]
}

/** whether the saved file is what the case wants, the Blocks after it (`suffix`) as they were */
function holds(saved: string, want: Want, suffix: string): boolean {
	if (typeof want === 'string') return saved === `${want}${suffix}`
	if (!saved.endsWith(suffix)) return false
	const body = saved.slice(0, saved.length - suffix.length)
	return body.split(want.mark).length === 3 && body.replaceAll(want.mark, '') === want.without
}

/** the closed Block paints `text`, split into runs or not, and no mark character anywhere */
function paintsPlain(shown: string, text: string): boolean {
	return shown.replaceAll('\n', '').includes(text) && !/[*`~]/.test(shown)
}

try {
	for (const [index, each] of CASES.entries()) {
		for (const existing of each.closed ? [true] : [true, false]) {
			for (const batch of [false, true]) {
				const text = existing ? `${each.source}${AFTER}` : ''
				const suffix = existing ? AFTER : '\n'
				const want =
					typeof each.saved === 'string'
						? JSON.stringify(`${each.saved}${suffix}`)
						: `${JSON.stringify(each.saved.without)} with one ${each.saved.mark} pair`
				const { app, file } = await openOn(
					`case-${index}-${existing}-${batch}`,
					text,
					each.closed === true
				)
				try {
					if (!existing) await typeEach(app, each.setup, [])
					if (each.caret !== '') await keystrokes(app, each.caret)
					await pause(200)
					// what the window paints with the caret placed, before the sequence: a stray character shows here first
					const placed = await painted(app)
					const shown = await runSteps(app, each.steps, batch)
					const [saved, open] = await saveAfterEscape(app, file, text)
					const closedPaint = await painted(app)
					const paints = each.paints === undefined || paintsPlain(closedPaint, each.paints)
					check(
						`${each.name}, ${existing ? 'existing file' : 'empty file'}, ${batch ? 'one batch' : 'one key per call'}: ⌘S saves ${want}${each.paints === undefined ? '' : `, the closed Block paints ${JSON.stringify(each.paints)} without marks`} and Escape leaves no field open (saved ${JSON.stringify(saved)}, field open ${open}, painted with the caret placed ${JSON.stringify(placed)}, after each step [${shown.join('; ')}], closed ${JSON.stringify(closedPaint)})`,
						holds(saved, each.saved, suffix) && paints && !open
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

finish('inline')
