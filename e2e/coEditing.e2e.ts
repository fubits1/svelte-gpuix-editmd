/**
 * end to end: editmd's SelfTest `coEditing` (Sources/editmd/SelfTest.swift@9e889e6, lines 91-180)
 * against the real app in a window, an agent hook through the real `--report-edit` command
 *
 * run: pnpm --dir . exec gpuix-svelte e2e/coEditing.e2e.ts (unsandboxed: it opens a window)
 */

import { chmodSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	check,
	editBlock,
	finish,
	openEditor,
	painted,
	pause,
	press,
	reaches,
	reportEdit,
	textOf,
	until
} from './support.ts'

// a short root: the agent socket inside it must fit macOS's 104-byte socket path limit
const folder = mkdtempSync('/tmp/eg-coedit-')
const file = join(folder, 'coedit.md')
const onDisk = () => readFileSync(file, 'utf8')

/** most editors and tools save this way: a new file renamed over the old one */
function writeAtomically(text: string): void {
	writeFileSync(`${file}.tmp`, text)
	renameSync(`${file}.tmp`, file)
}

try {
	writeFileSync(file, '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n')
	const app = await openEditor(file, folder)
	const shown = () => painted(app)

	// an agent rewrites the file in place while nothing is unsaved
	writeFileSync(file, '# Title\n\nFirst paragraph.\n\nSecond paragraph, by an agent.\n')
	await until('in-place write shown', async () => (await shown()).includes('by an agent'))
	await pause(1500)
	check(
		'a change written in place shows up, and the document stays clean',
		(await textOf(app, 'save-status')) === '' &&
			onDisk() === '# Title\n\nFirst paragraph.\n\nSecond paragraph, by an agent.\n'
	)

	// then replaces it atomically
	writeAtomically('# Title\n\nFirst paragraph.\n\nSecond paragraph, by an agent.\n\nThird.\n')
	const atomicShown = await reaches(async () => (await shown()).includes('Third.'))
	// as above: a Document the merge made dirty would show Saved within this pause
	await pause(1500)
	check(
		'an atomic replacement shows up too, and the document stays clean',
		atomicShown && (await textOf(app, 'save-status')) === ''
	)

	// an agent whose hook reports its edit gets the change highlighted as its own
	const hook = {
		session_id: 'selftest',
		cwd: folder,
		hook_event_name: 'PreToolUse',
		tool_input: { file_path: 'coedit.md' }
	}
	const hookOutput = reportEdit(hook, folder, 'Selftest agent')
	// row a-report-edit: an agent shows its user whatever its hook prints, and editmd's prints nothing
	check(
		`--report-edit prints nothing on stdout or stderr, Node's ExperimentalWarning class off since the shipped binary runs on Bun (stdout ${JSON.stringify(hookOutput.stdout)}, stderr ${JSON.stringify(hookOutput.stderr)})`,
		hookOutput.stdout === '' && hookOutput.stderr === ''
	)
	await pause(300)
	writeAtomically(
		'# Title\n\nFirst paragraph.\n\nSecond paragraph, by an agent.\n\nThird, reported.\n'
	)
	await until('reported write shown', async () => (await shown()).includes('reported'))
	await until('legend', async () => (await textOf(app, 'legend-name-1')) !== '')
	// a row's text is its name and then its count of changes
	const legend = [await textOf(app, 'legend-name-0'), await textOf(app, 'legend-name-1')]
	check(
		`a reported edit is named apart from unreported ones, Outside edit last (${legend.join('|')})`,
		legend[0]!.startsWith('Selftest agent') && legend[1]!.startsWith('Outside edit')
	)
	reportEdit({ ...hook, hook_event_name: 'PostToolUse' }, folder, 'Selftest agent')

	// the user types while the agent edits another paragraph
	await editBlock(app, 0, '# My Title')
	// the 1s autosave has not run yet: the user's heading is still unsaved when the agent writes
	const unsavedWhenAgentWrites = !onDisk().includes('My Title')
	writeAtomically(
		'# Title\n\nFirst paragraph, edited.\n\nSecond paragraph, by an agent.\n\nThird.\n'
	)
	const merged =
		'# My Title\n\nFirst paragraph, edited.\n\nSecond paragraph, by an agent.\n\nThird.\n'
	check(
		'unsaved edits and the agent’s edit are merged and autosaved',
		unsavedWhenAgentWrites && (await reaches(() => onDisk() === merged))
	)
	check(
		'the window says it saved',
		await reaches(async () => (await textOf(app, 'save-status')) === 'Saved')
	)
	const savedSeenAt = Date.now()
	const labelGone = await reaches(async () => (await textOf(app, 'save-status')) === '')
	// editmd's 2s and then its 0.4s fade-out, seen through 50ms polls and the automation's round trips on either end
	const savedShownFor = Date.now() - savedSeenAt
	check(
		`and the label goes away about 2.4s later, once it has faded out (${savedShownFor}ms)`,
		labelGone && savedShownFor >= 1900 && savedShownFor <= 3100
	)

	// two saves at once take turns
	await editBlock(app, 0, '# Twice My Title')
	let labels = ''
	const watching = setInterval(async () => (labels += `|${await textOf(app, 'save-status')}`), 20)
	const savesPressedAt = Date.now()
	await Promise.all([press(app, 'cmd-s'), press(app, 'cmd-s')])
	await until('saved twice', () => onDisk().startsWith('# Twice My Title'))
	// on disk well inside the second the 1s autosave waits, so the Cmd-S saves wrote it, not the autosave
	const savedWithin = Date.now() - savesPressedAt
	await pause(300)
	clearInterval(watching)
	// editmd's check: the text is on disk and neither save failed (no Not Saved on the way); the samples saw Saved, so they ran
	check(
		`two saves at once: the text is saved and no Not Saved shows (on disk ${savedWithin}ms after the keys)`,
		savedWithin < 700 &&
			onDisk().startsWith('# Twice My Title') &&
			labels.includes('|Saved') &&
			!labels.includes('Not Saved')
	)
	await press(app, 'cmd-z')
	check('and keep undo history', await reaches(async () => (await shown()).startsWith('My Title')))
	await until('undo saved', () => onDisk().startsWith('# My Title'))

	// a save that fails says so, and the next edit tries again
	chmodSync(folder, 0o555)
	let failureShown = false
	try {
		await editBlock(app, 0, '# Unsaved My Title')
		failureShown = await reaches(async () => (await textOf(app, 'save-status')) === 'Not Saved')
	} finally {
		chmodSync(folder, 0o755)
	}
	check('a failed save shows Not Saved', failureShown)
	await editBlock(app, 0, '# Retried Unsaved My Title')
	check(
		'the next edit saves again',
		await reaches(() => onDisk().startsWith('# Retried Unsaved My Title'))
	)

	// closing with an unsaved edit saves it rather than asking
	await editBlock(app, 0, '# Closing Retried Unsaved My Title')
	let exitedAt = 0
	const exited = new Promise<void>((resolve) =>
		app.process.once('exit', () => {
			exitedAt = Date.now()
			resolve()
		})
	)
	/**
	 * the window closes at once, before the 1s autosave could run: a close that did not save would exit with the
	 * edit unwritten. the field's Escape is the last key, so the exit must come well inside that second
	 */
	const closePressedAt = Date.now()
	await press(app, 'cmd-w').catch(() => {})
	await Promise.race([exited, pause(3000)])
	check(
		`closing saves unsaved edits: the window closes with the edit on disk (${exitedAt === 0 ? 'no exit' : `${exitedAt - closePressedAt}ms after Cmd-W`})`,
		exitedAt !== 0 && exitedAt - closePressedAt < 800 && onDisk().startsWith('# Closing Retried')
	)
	await app.close().catch(() => {})

	/**
	 * the process ending with an unsaved edit saves it: gpuix has no close hook, so the window's close button, its
	 * Close Window and Quit all end in the process exiting, as automation's `close()` ends it (stdin closed, then
	 * `process.exit(0)`); the exit comes well inside the 1s the autosave waits after the last key
	 */
	const exitFile = join(folder, 'exit.md')
	writeFileSync(exitFile, '# Exit\n')
	const exiting = await openEditor(exitFile, folder)
	await editBlock(exiting, 0, '# Exit, edited')
	// still unsaved: the autosave would come a second after the last key
	const beforeClose = readFileSync(exitFile, 'utf8')
	const closedAt = Date.now()
	const exitedOnClose = new Promise<number>((resolve) =>
		exiting.process.once('exit', () => resolve(Date.now()))
	)
	await exiting.close().catch(() => {})
	const exitTime = (await Promise.race([exitedOnClose, pause(3000).then(() => 0)])) - closedAt
	check(
		`the process exiting saves the unsaved edit before it ends (exit ${exitTime}ms after close)`,
		beforeClose === '# Exit\n' &&
			exitTime > 0 &&
			exitTime < 900 &&
			readFileSync(exitFile, 'utf8') === '# Exit, edited\n'
	)

	/**
	 * in a real window: a Block's field open with typing in it, another program writes the same
	 * Block. editmd shows the outside change in the field at once, merged with the typing, and a format right after it
	 * shows at once too
	 */
	const liveFile = join(folder, 'live.md')
	writeFileSync(liveFile, '# Live\n\none two three\n')
	const live = await openEditor(liveFile, folder)
	await live.getByTestId('block-1').click()
	await live.getByTestId('block-editor').waitFor()
	await live.call('keystrokes', { keys: 'cmd-down z' })
	await pause(200)
	writeFileSync(liveFile, '# Live\n\none two three\nagent\n')
	const fieldShowsBoth = await reaches(async () => {
		const text = await painted(live)
		return (
			(await live.getByTestId('block-editor').count()) > 0 &&
			text.includes('one two threez') &&
			text.includes('agent')
		)
	}, 2000)
	check(
		'an outside write to the open Block shows in its field within 2s, merged with the typing',
		fieldShowsBoth
	)
	await live.call('keystrokes', {
		keys: 'cmd-up right right right right shift-right shift-right shift-right cmd-b'
	})
	const boldShows = await reaches(
		async () => (await painted(live)).includes('one **two** threez'),
		2000
	)
	await live.getByTestId('block-editor').press('escape')
	check(
		'⌘B right after it shows in the field at once, and the file gets both changes',
		boldShows &&
			(await reaches(
				() => readFileSync(liveFile, 'utf8') === '# Live\n\none **two** threez\nagent\n'
			))
	)
	await live.close().catch(() => {})

	/**
	 * the user types on without a pause while another program writes the same Block five times,
	 * every 200ms, each time on top of what it finds on disk. every typed character must land once and in order, and
	 * every one of the program's changes too
	 */
	const busyFile = join(folder, 'busy.md')
	writeFileSync(busyFile, '# Busy\n\nStart.\n')
	const busy = await openEditor(busyFile, folder)
	await busy.getByTestId('block-1').click()
	await busy.getByTestId('block-editor').waitFor()
	await busy.call('keystrokes', { keys: 'cmd-down' })
	const typed = 'abcdefghijklmnopqrstuvwxy'
	const typing = (async () => {
		for (const key of typed) {
			await busy.call('keystrokes', { keys: key })
			await pause(45)
		}
	})()
	const writing = (async () => {
		for (let round = 1; round <= 5; round++) {
			await pause(200)
			const text = readFileSync(busyFile, 'utf8')
			writeFileSync(busyFile, text.replace('\n\n', `\n\nA${round} `))
		}
	})()
	await Promise.all([typing, writing])
	await pause(500)
	await busy.getByTestId('block-editor').press('escape')
	const busyLanded = await reaches(() => {
		const text = readFileSync(busyFile, 'utf8')
		return (
			text.includes(`Start.${typed}`) &&
			[1, 2, 3, 4, 5].every((round) => text.includes(`A${round} `))
		)
	}, 5000)
	const busyText = readFileSync(busyFile, 'utf8')
	check(
		`typing on while another program writes the same Block five times keeps every key once and in order, and every one of its changes (${JSON.stringify(busyText)})`,
		busyLanded &&
			busyText.split(typed).length === 2 &&
			[1, 2, 3, 4, 5].every((round) => busyText.split(`A${round} `).length === 2)
	)
	await busy.close().catch(() => {})
} catch (error) {
	check(`no error: ${error instanceof Error ? error.message : String(error)}`, false)
} finally {
	chmodSync(folder, 0o755)
	rmSync(folder, { recursive: true, force: true })
}

finish('co-editing')
