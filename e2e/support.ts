/**
 * what every end-to-end scenario shares: checks that print like test.ts, waiting on a condition,
 * the app launched on one file with its support folder (sockets, Open Recent) kept in `folder`, the keys typed into
 * it and the file ⌘S saves
 */

import { type ChildProcess, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type App, launch } from 'gpuix-svelte/automation'

/**
 * the gpuix-svelte bin `pnpm exec gpuix-svelte` resolves, relative to the port folder the suites run from; spawned
 * with `process.execPath`, so a mode runs under the suite's own Node and its inspector, which `NODE_V8_COVERAGE`
 * needs and the standalone pnpm binary disables
 */
export const GPUIX_BIN = join('node_modules', 'gpuix-svelte', 'bin', 'gpuix-svelte.js')

const results: [string, boolean][] = []

export function check(label: string, passed: boolean): void {
	results.push([label, passed])
	console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}`)
}

/** prints the summary and exits 0 or 1, as test.ts's `finish` does */
export function finish(name: string): never {
	const failed = results.filter(([, passed]) => !passed).length
	console.log(failed === 0 ? `\n${name} ok (${results.length})` : `\n${failed} failure(s)`)
	process.exit(failed === 0 ? 0 : 1)
}

export const pause = (milliseconds: number) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds))

/** whether `condition` holds within `timeoutMs`, polled every 50ms: a check's value, where `until` is a step's precondition */
export async function reaches(
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

export async function until(
	label: string,
	condition: () => boolean | Promise<boolean>,
	timeoutMs = 5000
): Promise<void> {
	if (!(await reaches(condition, timeoutMs))) throw new Error(`timed out waiting for ${label}`)
}

export type Editor = App & { close(): Promise<void>; process: ChildProcess }

/**
 * the running coding agents a launched app sees: only those working in `folder` or below it
 * (EDITMD_GPUIX_AGENT_ROOT), so an unreported write is credited the same on any machine, whatever agents the user
 * runs elsewhere, and a stand-in agent the run starts in its own folder still counts
 */
export function agentsIn(folder: string): Record<string, string> {
	return { EDITMD_GPUIX_AGENT_ROOT: folder }
}

/** the app on `file`, in a window, with everything it keeps outside the document under `folder` */
export async function openEditor(
	file: string,
	folder: string,
	env: Record<string, string> = {}
): Promise<Editor> {
	const app = await launch({
		entry: 'standalone.ts',
		args: [file],
		env: { EDITMD_GPUIX_SUPPORT: join(folder, 'support'), ...agentsIn(folder), ...env }
	})
	await app.getByTestId('block-0').waitFor({ timeoutMs: 10_000 })
	return app
}

/** editmd's `type(_:intoFirst: "h1")`: here the Active block's field starts with the whole Slice, so it is replaced */
export async function editBlock(app: App, index: number, source: string): Promise<void> {
	await app.getByTestId(`block-${index}`).click()
	const field = app.getByTestId('block-editor')
	await field.waitFor()
	await field.fill(source)
	await field.press('escape')
}

export const press = (app: App, keys: string) => app.getByTestId('block-0').press(keys)

/**
 * a window on `text` in `folder`/`name`.md: an existing file's Block `block` clicked open, or an empty file's own
 * field
 */
export async function openOn(
	folder: string,
	name: string,
	text: string,
	block: number
): Promise<{ app: Editor; file: string }> {
	const file = join(folder, `${name}.md`)
	writeFileSync(file, text)
	if (text !== '') {
		const app = await openEditor(file, folder)
		await app.getByTestId(`block-${block}`).click()
		await app.getByTestId('block-editor').waitFor()
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

export const keystrokes = (app: App, keys: string) => app.call('keystrokes', { keys })

/** one call per key, two frames apart as automation waits, and a pause for a remounted field's caret */
export async function typeEach(app: App, keys: string[]): Promise<void> {
	for (const key of keys) {
		await keystrokes(app, key)
		await pause(60)
	}
}

/** Escape and ⌘S: the file once it differs from `before`, or as it stands after 4s, and whether a field is still open */
export async function saveAfterEscape(
	app: App,
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

/** the in-window menu bar's titles, which paint before the document */
const MENU_TITLES = ['File', 'Edit', 'Format', 'View', 'Window', 'Help']

/**
 * every painted string in the document, native <markdown> text included, which `textContent` cannot see;
 * the menu bar's titles, painted first, are left out (automation's `getPaintedText` cannot be scoped)
 */
export async function painted(app: App): Promise<string> {
	const text: string[] = (await app.call('getPaintedText', {})).text
	const barFirst = MENU_TITLES.every((title, index) => text[index] === title)
	return (barFirst ? text.slice(MENU_TITLES.length) : text).join('\n')
}

/** the text of a test id's own <text> nodes, or '' when it is not there */
export async function textOf(app: App, testId: string): Promise<string> {
	const locator = app.getByTestId(testId)
	if ((await locator.count()) === 0) return ''
	try {
		return await locator.textContent()
	} catch (error) {
		// the element went away between the two calls, as the Saved label does after 2s
		if ((await locator.count()) === 0) return ''
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
