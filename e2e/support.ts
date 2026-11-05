/**
 * what every end-to-end scenario shares: checks that print `ok`/`FAIL` lines and assert them, waiting on a condition,
 * the app launched on one file with its support folder (sockets, Open Recent) kept in `folder`, the keys typed into
 * it and the file ⌘S saves
 */

import { type ChildProcess, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { type App, launch } from 'gpuix-svelte/automation'
import { expect } from 'vitest'
import { keysOf } from '../src/app/menu.ts'

/**
 * the gpuix-svelte bin `pnpm exec gpuix-svelte` resolves, relative to the port folder the suites run from; spawned
 * with `process.execPath`, so a mode runs under the suite's own Node and its inspector, which `NODE_V8_COVERAGE`
 * needs and the standalone pnpm binary disables
 */
export const GPUIX_BIN = join('node_modules', 'gpuix-svelte', 'bin', 'gpuix-svelte.js')

const HEADLESS_ENTRY = 'e2e/headless-app.ts'

/** the entry every launch runs: the headless app, or EDITMD_E2E_ENTRY (`standalone.ts` for real windows) */
export const getAppEntry = () => process.env.EDITMD_E2E_ENTRY ?? HEADLESS_ENTRY

const headless = getAppEntry() === HEADLESS_ENTRY

/** the checks each suite file is known to fail: `always`, or only with the headless entry, keyed by the file's name */
const knownFailures: Record<string, { always: string[]; headless: string[] }> = JSON.parse(
	readFileSync(join(import.meta.dirname, 'known-failures.json'), 'utf8')
)

/** a label with the numbers in its parentheses masked, as they carry measurements */
const toMasked = (label: string) =>
	label.replace(/\(([^()]*)\)/g, (_, inner: string) => `(${inner.replace(/-?\d+(\.\d+)?/g, '#')})`)

/** whether the running suite file is known to fail `label` with this entry */
function isKnownToFail(label: string): boolean {
	const suite = basename(expect.getState().testPath ?? '', '.e2e.test.ts')
	const { always, headless: headlessOnly } = knownFailures[suite] ?? { always: [], headless: [] }
	return [...always, ...(headless ? headlessOnly : [])].some(
		(known) => toMasked(known) === toMasked(label)
	)
}

let checks = 0

/** prints `ok`/`FAIL` and the label, then asserts the outcome known-failures.json expects */
export function check(label: string, passed: boolean): void {
	checks++
	console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}`)
	expect.soft(passed, label).toBe(!isKnownToFail(label))
}

export const countChecks = () => checks

/**
 * `body` in a short temp folder that holds a suite's files and the app's support folder, so nothing reaches the real
 * ones: an error is one failed check, then the folder goes
 */
export async function runInFolder(
	prefix: string,
	body: (folder: string) => Promise<void>
): Promise<void> {
	// a short root: the window's agent socket inside it must fit macOS's 104-byte socket path limit
	const folder = mkdtempSync(`/tmp/eg-${prefix}-`)
	try {
		await body(folder)
	} catch (error) {
		check(`no error: ${error instanceof Error ? error.message : String(error)}`, false)
	} finally {
		rmSync(folder, { recursive: true, force: true })
	}
}

export const pause = (milliseconds: number) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds))

/** whether `condition` holds within `timeoutMs`, polled every 50ms: a check's value, where `waitUntil` is a step's precondition */
export async function isMetWithin(
	condition: () => boolean | Promise<boolean>,
	timeoutMs = 5000
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs
	while (!(await condition())) {
		if (Date.now() > deadline) return false

		await pause(50)
	}
	return true
}

export async function waitUntil(
	label: string,
	condition: () => boolean | Promise<boolean>,
	timeoutMs = 5000
): Promise<void> {
	if (!(await isMetWithin(condition, timeoutMs))) throw new Error(`timed out waiting for ${label}`)
}

export type Editor = App & { process: ChildProcess }

/**
 * the app on `file` through `getAppEntry()`, with everything it keeps outside the document under `folder`, once the
 * test id `ready` shows
 */
export async function openEditor(
	file: string,
	folder: string,
	environment: Record<string, string> = {},
	ready = 'block-0'
): Promise<Editor> {
	const app = await launch({
		entry: getAppEntry(),
		args: [file],
		env: {
			EDITMD_GPUIX_SUPPORT: join(folder, 'support'),
			...environment
		}
	})
	await app.getByTestId(ready).waitFor({ timeoutMs: 10_000 })
	return app
}

/** Block `index` clicked open, once its field shows */
export async function openBlock(app: App, index: number): Promise<void> {
	await app.getByTestId(`block-${index}`).click()
	await app.getByTestId('block-editor').waitFor()
}

/** editmd's `type(_:intoFirst: "h1")`: here the Active block's field starts with the whole Slice, so it is replaced */
export async function editBlock(app: App, index: number, source: string): Promise<void> {
	await openBlock(app, index)
	const field = app.getByTestId('block-editor')
	await field.fill(source)
	await field.press('escape')
}

export const press = (app: App, keys: string) => app.getByTestId('block-0').press(keys)

export const has = async (app: App, testId: string) => (await app.getByTestId(testId).count()) > 0

/**
 * a window on `text` in `folder`/`name`.md: an existing file's Block `block` clicked open, none with null, or an empty
 * file's own field
 */
export async function openOn(
	folder: string,
	name: string,
	text: string,
	block: number | null
): Promise<{ app: Editor; file: string }> {
	const file = join(folder, `${name}.md`)
	writeFileSync(file, text)
	const app = await openEditor(file, folder, {}, text === '' ? 'block-editor' : 'block-0')
	if (text === '') await app.getByTestId('block-editor').click()
	else if (block !== null) await openBlock(app, block)

	return { app, file }
}

/** `body` on the window `openOn` opens, closed after it whether it passed or threw */
export async function withOpenOn(
	folder: string,
	name: string,
	text: string,
	block: number | null,
	body: (app: Editor, file: string) => Promise<void>
): Promise<void> {
	const { app, file } = await openOn(folder, name, text, block)
	try {
		await body(app, file)
	} finally {
		await app.close().catch(() => {})
	}
}

/** a run's file and keys as a check's label names them; known-failures.json matches the labels word for word */
export const describeRun = (existing: boolean, batch: boolean) =>
	`${existing ? 'existing file' : 'empty file'}, ${batch ? 'one batch' : 'one key per call'}`

/** the existing file's Blocks after a case's, which no key may touch */
export const AFTER = '\n\nSecond\n'

/** another program saving `file` atomically: a copy written beside it, then renamed over it */
export function writeAtomically(file: string, data: string | Buffer): void {
	writeFileSync(`${file}.tmp`, data)
	renameSync(`${file}.tmp`, file)
}

export const sendKeystrokes = (app: App, keys: string) => app.call('keystrokes', { keys })

/** `text` as the keys that type it, one per character */
export const toKeys = (text: string) =>
	[...text].map((character) => (character === ' ' ? 'space' : character))

/** one call per key, two frames apart as automation waits, then `gapMs`: by default a pause for a remounted field's caret */
export async function typeEach(app: App, keys: string[], gapMs = 60): Promise<void> {
	for (const key of keys) {
		await sendKeystrokes(app, key)
		await pause(gapMs)
	}
}

/**
 * a Backspace as a person presses it, key down then up, with `held` typed while it is down; the port hears a
 * Backspace in an empty field only from its key up, so a plain keystroke cannot stand in for it
 */
export async function pressBackspace(app: App, held?: string): Promise<void> {
	await app.call('keyDown', { key: 'backspace' })
	if (held) await sendKeystrokes(app, held)

	await app.call('keyUp', { key: 'backspace' })
	await pause(150)
}

/** the file once it differs from `before`, or as it stands after 4s */
export async function waitForChange(file: string, before: string): Promise<string> {
	await isMetWithin(() => readFileSync(file, 'utf8') !== before, 4000)
	return readFileSync(file, 'utf8')
}

/** Escape and ⌘S: the file once it differs from `before`, and whether a field is still open 200ms after Escape */
export async function saveAfterEscape(
	app: App,
	file: string,
	before: string
): Promise<[string, boolean]> {
	await pause(300)
	await sendKeystrokes(app, 'escape')
	const open = !(await isMetWithin(async () => !(await has(app, 'block-editor')), 200))
	await press(app, 'cmd-s')
	return [await waitForChange(file, before), open]
}

/** the in-window menu bar's titles, which paint before the document */
const MENU_TITLES = ['File', 'Edit', 'Format', 'View', 'Window', 'Help']

/**
 * every painted string in the document, native <markdown> text included, which `textContent` cannot see;
 * the menu bar's titles, painted first, are left out (automation's `getPaintedText` cannot be scoped)
 */
export async function loadPaintedText(app: App): Promise<string> {
	const text: string[] = (await app.call('getPaintedText', {})).text
	const barFirst = MENU_TITLES.every((title, index) => text[index] === title)
	return (barFirst ? text.slice(MENU_TITLES.length) : text).join('\n')
}

/** the label every window paints at its bottom edge after the document's text, naming the palette's key */
export const PALETTE_HINT = `${keysOf('commandPalette')} Commands`

/** the text of a test id's own <text> nodes, or '' when it is not there */
export async function loadText(app: App, testId: string): Promise<string> {
	try {
		return await app.getByTestId(testId).textContent()
	} catch (error) {
		// not there, or gone as the Saved label goes after 2s: automation reports NotFound at once, without waiting
		if (!(await has(app, testId))) return ''

		throw error
	}
}

/**
 * `editmd-gpuix --report-edit` as an agent hook runs it: the payload on stdin, the agent's name in its environment;
 * returns what it printed, which an agent shows its user, so editmd's prints nothing (main.swift:4-8)
 */
export function reportEdit(
	payload: object,
	folder: string,
	agentName: string
): { stdout: string; stderr: string } {
	const run = spawnSync(process.execPath, [GPUIX_BIN, 'standalone.ts', '--report-edit'], {
		input: JSON.stringify(payload),
		env: {
			...process.env,
			EDITMD_GPUIX_SUPPORT: join(folder, 'support'),
			EDITMD_AGENT_NAME: agentName,
			/**
			 * Node's ExperimentalWarning class off for this one spawn: running the source under Node warns about its type
			 * stripping and localStorage, which the shipped binary, built on Bun, never prints; anything the app writes
			 * still shows
			 */
			NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning']
				.filter(Boolean)
				.join(' ')
		},
		encoding: 'utf8'
	})
	if (run.status !== 0) throw new Error(`--report-edit exited ${run.status}: ${run.stderr}`)

	return { stdout: run.stdout, stderr: run.stderr }
}
