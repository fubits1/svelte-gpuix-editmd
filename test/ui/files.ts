/**
 * the headless UI suite's checks of files: autosave, Save and Save As, Close, Revert, Open and Open Recent, drops,
 * encodings, untitled windows, the exit save, the save-status label, locked files and Print
 */
import './harness.ts'
import {
	clickIfPresent,
	clickLinkIn,
	clickRow,
	createPng,
	directory,
	getCentre,
	getPanelRows,
	getProp,
	getRowIndex,
	getText,
	getTipOffset,
	initDirectory,
	initMenuFolderBefore,
	initMovedPath,
	initOpenDirectory,
	initSaveDirectory,
	initUntitledFolder,
	isolated,
	linkDirectory,
	loadTipAfterHover,
	menuDirectory,
	menuFolderBefore,
	menuOptions,
	menuPicks,
	menuRecent,
	menuRuns,
	menuWindows,
	movedPath,
	openDirectory,
	openFixture,
	openMenu,
	remote,
	retype,
	sandboxDirectory,
	sandboxOptions,
	saveDirectory,
	setMenuClipboardUrl,
	settleAfter,
	snapToWanted,
	snapshotFolder,
	untitledFolder,
	waitForFieldIdle,
	waitUntil
} from './harness.ts'
import { check } from './check.ts'
import {
	bounds,
	click_test_id,
	drop_files,
	find_test_id,
	mouse_down,
	mouse_move,
	mouse_up,
	painted,
	press,
	settle,
	type,
	wait
} from 'gpuix-svelte/test'
import {
	accessSync,
	chmodSync,
	constants,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { themeController } from '../../src/app/theme.svelte.ts'
import { labelDetail } from '../../src/core/persistence.ts'
import { listenForReports } from '../../src/host/agentIpc.ts'
import { printablePage } from '../../src/host/print.ts'
import { RecentFiles } from '../../src/host/recent.ts'
import { UntitledNumbers } from '../../src/host/untitledNumbers.ts'
import {
	DocumentController,
	documentController,
	NEW_WINDOW_ENV,
	openEditorWindow
} from '../../src/ui/DocumentView/controller.svelte.ts'

/**
 * a Finder drop of `paths` on the centre of `testId`. gpui delivers a second drop_files only after a pointer move, so
 * the pointer moves onto the target first, as a real drag does
 */
function dropOn(testId: string, paths: string[]): void {
	const target = find_test_id(testId)
	if (!target) throw new Error(`no painted ${testId}`)

	mouse_move(target)
	drop_files(target, paths)
}

export async function testAutosave(): Promise<void> {
	initDirectory()
	const path = join(directory, 'notes.md')
	writeFileSync(path, '# Notes\r\n\r\nfirst line\r\n')

	// its own sockets folder, so the test never listens where real editors do
	documentController.open(path, { ...isolated, socketsDirectory: join(directory, 's') })
	settle()
	check('an opened file is painted', painted().includes('first line'))

	click_test_id('block-1')
	type('z')
	const keyAt = Date.now()
	await wait(700)
	const beforeIdle = readFileSync(path, 'utf8')
	// the moment the save lands, polled every 25ms, so the label's samples are timed from it
	let savedAt = 0
	for (let poll = 0; poll < 40 && savedAt === 0; poll++) {
		await wait(25)
		if (readFileSync(path, 'utf8').includes('linez')) savedAt = Date.now()
	}
	check(
		'an edit is autosaved after a pause, in the file’s own line endings',
		readFileSync(path, 'utf8'),
		'# Notes\r\n\r\nfirst linez\r\n'
	)
	check('the save-status label says Saved', documentController.label, 'Saved')
	/**
	 * the window's label (what App paints in `save-status`, mounted alone here) says Saved for editmd's 2s after
	 * the save and then goes back to empty
	 */
	await wait(savedAt + 1500 - Date.now())
	const labelAfterOneAndAHalf = documentController.label
	await wait(savedAt + 2500 - Date.now())
	check(
		'the window saves 1s after the last key, not 0.7s after it, and says Saved for 2s: still 1.5s after the save, gone 2.5s after it',
		[
			beforeIdle,
			savedAt - keyAt >= 900 && savedAt - keyAt <= 1300,
			labelAfterOneAndAHalf,
			documentController.label
		],
		['# Notes\r\n\r\nfirst line\r\n', true, 'Saved', '']
	)

	/**
	 * a key every 300ms never leaves the 1s idle pause, so only editmd's 5s maxWait saves: sampled after each key,
	 * the file holds no `m` before 4.7s and holds one after 5.3s
	 */
	const maxWaitSamples: [number, boolean][] = []
	const typingStart = Date.now()
	while (Date.now() - typingStart < 5800) {
		type('m')
		await wait(300)
		maxWaitSamples.push([Date.now() - typingStart, readFileSync(path, 'utf8').includes('m')])
	}
	check(
		'typing without a 1s pause saves 5s after the first unsaved change, not before',
		[
			maxWaitSamples.some(([elapsed, saved]) => elapsed < 4700 && saved),
			maxWaitSamples.some(([elapsed, saved]) => elapsed > 5300 && saved)
		],
		[false, true]
	)
}

export async function testSaveKey(): Promise<void> {
	// Cmd-S writes the file at once, well before the 1s autosave
	initSaveDirectory()
	const savePath = join(saveDirectory, 'save.md')
	writeFileSync(savePath, 'Draft\n')
	documentController.open(savePath, { ...isolated, socketsDirectory: join(saveDirectory, 's') })
	settle()
	click_test_id('block-0')
	type('s')
	press('cmd-s')
	await wait(100)
	check('Cmd-S saves the file now', readFileSync(savePath, 'utf8'), 'Drafts\n')
}

export async function testSaveAsCloseOpen(): Promise<void> {
	// File > Save As, as editmd's NSSavePanel: a name field and a folder, from an injected picker since gpuix has none
	const fileDirectory = mkdtempSync(join(tmpdir(), 'eg-file-'))
	const windowRuns: [string, string[]][] = []
	const windowOptions = {
		...isolated,
		socketsDirectory: join(fileDirectory, 's'),
		run: (command: string, args: string[]) => void windowRuns.push([command, args]),
		chooseFolder: () => Promise.resolve(fileDirectory),
		closeWindow: () => void windowRuns.push(['closeWindow', []]),
		setWindowTitle: (title: string) => void windowRuns.push(['setWindowTitle', [title]]),
		// File > Print's page goes to this test's folder instead of a fresh temporary one
		writePrintable: (text: string, title: string) => {
			const printPath = join(fileDirectory, `${title}.html`)
			writeFileSync(printPath, printablePage(text, title))
			return printPath
		},
		// New and Open only record.
		openWindow: (windowPath: string | null) =>
			void windowRuns.push(['openWindow', [windowPath ?? '']]),
		choosePaths: () => Promise.resolve(null),
		// Save As adds to Open Recent, so its store is this test's too.
		recentFiles: new RecentFiles(join(fileDirectory, 'recent.json'))
	}

	documentController.load('# Plan\n\nfirst\n', windowOptions)
	settle()
	press('cmd-s')
	settle()
	check(
		'Cmd-S on an untitled Document opens the Save As dialog, named Untitled.md in ~/Documents',
		[find_test_id('save-as') !== null, getProp('save-as-name', 'value'), getText('save-as-folder')],
		[true, 'Untitled.md', join(homedir(), 'Documents')]
	)

	retype('Untitled.md', 'plan')
	clickIfPresent('save-as-choose')
	await waitUntil(() => getText('save-as-folder') === fileDirectory, 'the chosen folder')
	settle()
	clickIfPresent('save-as-save')
	settle()
	const planPath = join(fileDirectory, 'plan.md')
	check(
		'Save writes <folder>/plan.md with the Document’s text and closes the dialog',
		[existsSync(planPath) && readFileSync(planPath, 'utf8'), find_test_id('save-as')],
		['# Plan\n\nfirst\n', null]
	)
	check('right after Save As the label says Saved', documentController.label, 'Saved')
	check(
		'the window now works on plan.md: its title, and its folder for links and images',
		[windowRuns.at(-1), documentController.folder],
		[['setWindowTitle', ['plan.md']], fileDirectory]
	)

	click_test_id('block-1')
	type('x')
	/**
	 * polled for up to 4s, since under load the 1s autosave lands past any fixed delay; its timing is checked in
	 * `testAutosave` in this file
	 */
	const waitForPlanSave = async () => {
		for (const deadline = Date.now() + 4000; Date.now() < deadline; await wait(50)) {
			if (existsSync(planPath) && readFileSync(planPath, 'utf8') === '# Plan\n\nfirstx\n') {
				return true
			}
		}
		return false
	}
	check('a following edit autosaves to plan.md', await waitForPlanSave(), true)
	press('escape')

	// Save As on an opened file: the new file is written, the old one keeps its bytes, and the window follows the new one
	const secondPath = join(fileDirectory, 'second.md')
	const firstPath = openFixture(fileDirectory, 'first.md', '# First\n\nbody\n', windowOptions)
	settle()
	press('cmd-shift-s')
	settle()
	check(
		'Cmd-Shift-S on an opened file offers its own name in its own folder',
		[getProp('save-as-name', 'value'), getText('save-as-folder')],
		['first.md', fileDirectory]
	)
	retype('first.md', 'second')
	// Return presses Save, the panel's default button
	press('enter')
	settle()
	check(
		'Return saves second.md; first.md keeps its bytes',
		[existsSync(secondPath) && readFileSync(secondPath, 'utf8'), readFileSync(firstPath, 'utf8')],
		['# First\n\nbody\n', '# First\n\nbody\n']
	)
	check('the window title follows the new file', windowRuns.at(-1), [
		'setWindowTitle',
		['second.md']
	])

	writeFileSync(secondPath, '# First\n\nbody\n\ntheirs\n')
	await waitUntil(() => documentController.text.includes('theirs'), 'the merge from second.md')
	check(
		'an outside write to the new path merges into the Document',
		documentController.text,
		'# First\n\nbody\n\ntheirs\n'
	)

	// the target exists: ask before replacing it, as NSSavePanel does
	const takenPath = join(fileDirectory, 'taken.md')
	writeFileSync(takenPath, 'not yours\n')
	press('cmd-shift-s')
	settle()
	retype('second.md', 'taken')
	press('enter')
	settle()
	check(
		'Save As onto an existing file asks to replace it, in NSSavePanel’s words, and writes nothing yet',
		[
			find_test_id('replace-file') !== null,
			getText('replace-file-title'),
			readFileSync(takenPath, 'utf8')
		],
		[true, '“taken.md” already exists. Do you want to replace it?', 'not yours\n']
	)
	clickIfPresent('replace-file-cancel')
	settle()
	check(
		'Cancel leaves the existing file’s bytes and keeps the Save As dialog with its name',
		[
			readFileSync(takenPath, 'utf8'),
			find_test_id('replace-file'),
			find_test_id('save-as') !== null,
			getProp('save-as-name', 'value')
		],
		['not yours\n', null, true, 'taken']
	)
	press('enter')
	settle()
	clickIfPresent('replace-file-replace')
	settle()
	check(
		'Replace writes the Document over the existing file and closes the dialog',
		[readFileSync(takenPath, 'utf8'), find_test_id('save-as')],
		['# First\n\nbody\n\ntheirs\n', null]
	)

	// File > Close (Cmd-W), as editmd's Document `canClose`: a file with edits saves itself silently, then closes
	const closePath = openFixture(fileDirectory, 'close.md', 'Draft\n', windowOptions)
	settle()
	windowRuns.length = 0
	click_test_id('block-0')
	type('c')
	press('cmd-w')
	// the title marks the edit as NSDocument's does, and the save takes the mark off before the window closes
	check(
		'Cmd-W on an opened file with edits writes them and closes the window',
		[readFileSync(closePath, 'utf8'), windowRuns],
		[
			'Draftc\n',
			[
				['setWindowTitle', ['close.md — Edited']],
				['setWindowTitle', ['close.md']],
				['closeWindow', []]
			]
		]
	)

	// when that save fails, NSDocument asks instead, so nothing is lost silently
	type('d')
	chmodSync(closePath, 0o444)
	windowRuns.length = 0
	press('cmd-w')
	settle()
	check(
		'when that save fails, Cmd-W asks in NSDocument’s words and keeps the window',
		[
			getText('save-changes-title'),
			find_test_id('save-changes-save')?.children?.[0]?.children?.[0]?.text,
			windowRuns
		],
		['Do you want to save the changes made to the document “close.md”?', 'Save', []]
	)
	clickIfPresent('save-changes-dont-save')
	check(
		'Don’t Save closes the window without writing',
		[readFileSync(closePath, 'utf8'), windowRuns],
		['Draftc\n', [['closeWindow', []]]]
	)
	chmodSync(closePath, 0o644)
	press('escape')

	/**
	 * the close question's Save on a locked file: NSDocument shows the one locked-file alert ⌘S shows, as editmd's
	 * `askToClose` hands the question to NSDocument (Document.swift:195-197), and the window stays until Save Anyway
	 * writes the edit, which closes it as the question's Save would have
	 */
	const lockedClosePath = openFixture(fileDirectory, 'close-locked.md', 'Draft\n', windowOptions)
	settle()
	click_test_id('block-0')
	type('f')
	chmodSync(lockedClosePath, 0o444)
	windowRuns.length = 0
	press('cmd-w')
	settle()
	const askedBeforeLockedSave = find_test_id('save-changes') !== null
	clickIfPresent('save-changes-save')
	settle()
	check(
		'when the close question’s Save meets a locked file, the locked-file alert ⌘S shows asks to save anyway and the window stays',
		[
			askedBeforeLockedSave,
			find_test_id('save-changes'),
			getText('save-locked-title'),
			windowRuns,
			readFileSync(lockedClosePath, 'utf8')
		],
		[
			true,
			null,
			'The document “close-locked.md” could not be saved. The file is locked.',
			[],
			'Draft\n'
		]
	)
	clickIfPresent('save-locked-anyway')
	settle()
	const lockedCloseMode = (statSync(lockedClosePath).mode & 0o777).toString(8)
	chmodSync(lockedClosePath, 0o644)
	check(
		'Save Anyway after the close question writes the edit, keeps the mode 444 and closes the window',
		[readFileSync(lockedClosePath, 'utf8'), lockedCloseMode, windowRuns],
		[
			'Draftf\n',
			'444',
			[
				['setWindowTitle', ['close-locked.md']],
				['closeWindow', []]
			]
		]
	)
	press('escape')

	documentController.load('Note\n', windowOptions)
	settle()
	click_test_id('block-0')
	type('e')
	press('escape')
	windowRuns.length = 0
	press('cmd-w')
	settle()
	check(
		'Cmd-W on an untitled Document with edits asks to save the changes',
		[
			getText('save-changes-title'),
			find_test_id('save-changes-save')?.children?.[0]?.children?.[0]?.text,
			windowRuns
		],
		['Do you want to save the changes made to the document “Untitled”?', 'Save…', []]
	)
	const askedBeforeCancel = find_test_id('save-changes') !== null
	clickIfPresent('save-changes-cancel')
	settle()
	check(
		'Cancel closes the question and keeps the window and the edits',
		[askedBeforeCancel, find_test_id('save-changes'), windowRuns, documentController.text],
		[true, null, [], 'Notee\n']
	)

	// Save… on an untitled Document is Save As, and the window closes once the file is written
	press('cmd-w')
	settle()
	clickIfPresent('save-changes-save')
	settle()
	const savedOnClose = find_test_id('save-as') !== null
	retype('Untitled.md', 'note')
	// the injected picker's folder, so the untitled default, ~/Documents, is never written
	clickIfPresent('save-as-choose')
	await waitUntil(() => getText('save-as-folder') === fileDirectory, 'the chosen folder')
	clickIfPresent('save-as-save')
	settle()
	const notePath = join(fileDirectory, 'note.md')
	check(
		'Save… opens Save As, and saving there closes the window',
		[savedOnClose, existsSync(notePath) && readFileSync(notePath, 'utf8'), windowRuns],
		[
			true,
			'Notee\n',
			[
				['setWindowTitle', ['note.md']],
				['closeWindow', []]
			]
		]
	)

	documentController.load('Fresh\n', windowOptions)
	settle()
	windowRuns.length = 0
	press('cmd-w')
	settle()
	check(
		'Cmd-W on an untouched Document closes at once',
		[find_test_id('save-changes'), windowRuns],
		[null, [['closeWindow', []]]]
	)

	/**
	 * NSDocument numbers its untitled windows Untitled, Untitled 2, …, one past the highest still open, which every
	 * window's process shares through `UntitledNumbers`; this test's registry sits in its own support folder
	 */
	const untitledNumbers = new UntitledNumbers(join(fileDirectory, 'support', 'untitled'))
	const untitledOptions = { ...windowOptions, untitledNumbers, onExit: () => {} }
	const firstUntitled = new DocumentController()
	firstUntitled.load('', untitledOptions)
	const secondUntitled = new DocumentController()
	secondUntitled.load('', untitledOptions)
	secondUntitled.run('saveAs')
	check(
		'a second untitled window is titled Untitled 2, and its Save As starts on Untitled 2.md',
		[
			firstUntitled.windowTitle,
			secondUntitled.windowTitle,
			secondUntitled.overlay?.kind === 'saveAs' ? secondUntitled.overlay.name : null
		],
		['Untitled', 'Untitled 2', 'Untitled 2.md']
	)

	// File > Revert to Saved has no key in editmd; the menu bar and the command palette run it through `run`, as the test does
	openFixture(fileDirectory, 'revert.md', '# Saved\n', windowOptions)
	settle()
	click_test_id('block-0')
	type('x')
	press('escape')
	documentController.run('revert')
	settle()
	check(
		'Revert to Saved asks first, in NSDocument’s words',
		[find_test_id('revert') !== null, getText('revert-title')],
		[true, 'Do you want to revert to the most recently saved version of the document “revert.md”?']
	)
	const askedBeforeRevertCancel = find_test_id('revert') !== null
	clickIfPresent('revert-cancel')
	settle()
	check(
		'Cancel closes the question and keeps the edits',
		[askedBeforeRevertCancel, find_test_id('revert'), documentController.text],
		[true, null, '# Savedx\n']
	)
	documentController.run('revert')
	settle()
	const askedBeforeRevert = find_test_id('revert') !== null
	clickIfPresent('revert-revert')
	settle()
	check(
		'Revert restores the text on disk and paints it',
		[
			askedBeforeRevert,
			find_test_id('revert'),
			documentController.text,
			painted().includes('Savedx')
		],
		[true, null, '# Saved\n', false]
	)

	// File > Print and Page Setup (gap G5): a printable HTML page opened in the browser, whose print dialog sets up pages
	documentController.load('# Printed heading\n\nBody\n', windowOptions)
	settle()

	/** what Cmd-P or Cmd-Shift-P ran, and whether the page it opened holds the rendered heading */
	function printWith(keystroke: string) {
		windowRuns.length = 0
		press(keystroke)
		const page = windowRuns[0]?.[1][0]
		return {
			runs: windowRuns.slice(),
			heading:
				page !== undefined && /<h1[^>]*>Printed heading<\/h1>/.test(readFileSync(page, 'utf8'))
		}
	}
	const printPage = join(fileDirectory, 'Untitled.html')
	check(
		'Cmd-P writes a printable page with the rendered heading and opens it',
		printWith('cmd-p'),
		{
			runs: [['open', [printPage]]],
			heading: true
		}
	)
	check(
		'Cmd-Shift-P (Page Setup) does the same, the browser’s print dialog holding page setup',
		printWith('cmd-shift-p'),
		{ runs: [['open', [printPage]]], heading: true }
	)

	rmSync(fileDirectory, { recursive: true, force: true })
	rmSync(linkDirectory, { recursive: true, force: true })

	/**
	 * File > New, Open… and Open Recent, as editmd's NSDocumentController: one process per Document (ADR-0008), so
	 * a new window is the injected opener's call, the picker answers from `picks` and Open Recent lives in this
	 * test's folder; nothing spawns, no picker shows and the real store is never read or written
	 */
	initOpenDirectory()
	const openedWindows: (string | null)[] = []
	const openRuns: [string, string[]][] = []
	const picks: string[][] = []
	const openRecent = new RecentFiles(join(openDirectory, 'recent.json'))
	const openOptions = {
		...isolated,
		socketsDirectory: join(openDirectory, 's'),
		run: (command: string, args: string[]) => void openRuns.push([command, args]),
		openInEditor: (linkPath: string) => void openRuns.push(['openInEditor', [linkPath]]),
		chooseFolder: () => Promise.resolve(openDirectory),
		closeWindow: () => void openRuns.push(['closeWindow', []]),
		setWindowTitle: (title: string) => void openRuns.push(['setWindowTitle', [title]]),
		writePrintable: (_text: string, title: string) => join(openDirectory, `${title}.html`),
		openWindow: (windowPath: string | null) => void openedWindows.push(windowPath),
		choosePaths: () => Promise.resolve(picks.shift() ?? null),
		recentFiles: openRecent
	}
	const [alphaPath, betaPath, gammaPath, deltaPath] = ['alpha', 'beta', 'gamma', 'delta'].map(
		(name) => {
			const filePath = join(openDirectory, `${name}.md`)
			writeFileSync(filePath, `# ${name}\n`)
			return filePath
		}
	)

	documentController.load('', openOptions)
	settle()
	press('cmd-n')
	check('Cmd-N opens a new untitled window through the opener', openedWindows, [null])

	// NSDocumentController replaces the untouched untitled Document it opened at launch with the first file it opens
	openedWindows.length = 0
	picks.push([alphaPath, betaPath])
	press('cmd-o')
	await waitUntil(() => openedWindows.length > 0, 'the second picked file')
	settle()
	check(
		'Cmd-O on an untouched untitled Document opens the first picked file in place, the second through the opener',
		[documentController.text, documentController.folder, openedWindows, openRuns.at(-1)],
		['# alpha\n', openDirectory, [betaPath], ['setWindowTitle', ['alpha.md']]]
	)
	check('both opened files appear in Open Recent, newest first', openRecent.list(), [
		betaPath,
		alphaPath
	])

	openedWindows.length = 0
	picks.push([gammaPath, deltaPath])
	press('cmd-o')
	await waitUntil(() => openedWindows.length > 1, 'both picked files')
	check(
		'Cmd-O on an opened file opens every picked file through the opener',
		[openedWindows, documentController.text],
		[[gammaPath, deltaPath], '# alpha\n']
	)

	// Open Recent has no key: the menu bar holds it as a submenu, and its command palette entry runs it as the test does
	documentController.run('openRecent')
	settle()
	check(
		'Open Recent lists the recent files, newest first',
		[0, 1, 2, 3].map((index) => getText(`open-recent-name-${index}`)),
		['delta.md', 'gamma.md', 'beta.md', 'alpha.md']
	)
	openedWindows.length = 0
	clickIfPresent('open-recent-2')
	settle()
	// a new window starts once the other windows said none of them has the file (`focusWindowFor`)
	await waitUntil(() => openedWindows.length > 0, 'the recent file’s window')
	check(
		'choosing a recent file opens it through the opener, moves it to the top and closes the list',
		[openedWindows, openRecent.list()[0], find_test_id('open-recent')],
		[[betaPath], betaPath, null]
	)
	documentController.run('openRecent')
	settle()
	const recentShownBeforeClear = find_test_id('open-recent') !== null
	clickIfPresent('open-recent-clear')
	settle()
	check(
		'Clear Menu empties Open Recent and closes the list',
		[recentShownBeforeClear, openRecent.list(), find_test_id('open-recent')],
		[true, [], null]
	)

	// dropped files, as editmd's SelfTest `droppingFiles`: images are linked where they land, text files open
	mkdirSync(join(openDirectory, 'images'))
	const droppedImage = join(openDirectory, 'images', 'my pic.png')
	writeFileSync(droppedImage, createPng(2, 2))
	const dropPath = join(openDirectory, 'drop.md')
	writeFileSync(dropPath, '# Title\n\nFirst.\n\nSecond.\n')
	documentController.open(dropPath, openOptions)
	settle()
	// the drop lands on the centre of `First.`, the Block boundary nearest it is the one below
	dropOn('block-1', [droppedImage])
	settle()
	check(
		'a dropped image shows in the document, after the Block it was dropped on',
		[documentController.text, find_test_id('image-2-0')?.type],
		['# Title\n\nFirst.\n\n![my pic](images/my%20pic.png)\n\nSecond.\n', 'img']
	)
	press('cmd-s')
	check(
		'and is saved as a link relative to the document’s folder',
		readFileSync(dropPath, 'utf8'),
		'# Title\n\nFirst.\n\n![my pic](images/my%20pic.png)\n\nSecond.\n'
	)
	const imageBeforeUndo = documentController.text.includes('![my pic]')
	press('cmd-z')
	settle()
	check(
		'Cmd-Z takes the dropped image out again as one Undo step',
		[imageBeforeUndo, documentController.text, find_test_id('image-2-0')],
		[true, '# Title\n\nFirst.\n\nSecond.\n', null]
	)

	const codePath = join(openDirectory, 'code.md')
	writeFileSync(codePath, '# T\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\nAfter.\n')
	documentController.open(codePath, openOptions)
	settle()
	dropOn('block-1', [droppedImage])
	check(
		'an image dropped on a code block goes after it, leaving the code whole',
		documentController.text,
		'# T\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\n![my pic](images/my%20pic.png)\n\nAfter.\n'
	)

	const droppedNotePath = join(openDirectory, 'note.md')
	writeFileSync(droppedNotePath, '# Note\n')
	openedWindows.length = 0
	const textBeforeNote = documentController.text
	dropOn('block-0', [droppedNotePath])
	await waitUntil(() => openedWindows.length > 0, 'the dropped file’s window')
	check(
		'a dropped markdown file opens through the opener and changes nothing here, opening no editor',
		[openedWindows, documentController.text, openRecent.list()[0], documentController.activeIndex],
		[[droppedNotePath], textBeforeNote, droppedNotePath, null]
	)

	documentController.load('# Untitled\n', openOptions)
	settle()
	dropOn('block-0', [droppedImage])
	check(
		'an untitled Document links a dropped image by its absolute path',
		documentController.text,
		`# Untitled\n\n![my pic](${droppedImage.replaceAll(' ', '%20')})\n`
	)

	// while a dialog is open the menu keys stay away from the document: cmd-s keeps the dialog's typed name and folder
	documentController.load('Draft\n', openOptions)
	settle()
	press('cmd-s')
	settle()
	retype('Untitled.md', 'kept')
	clickIfPresent('save-as-choose')
	await waitUntil(() => getText('save-as-folder') === openDirectory, 'the chosen folder')
	press('cmd-s')
	settle()
	check(
		'Cmd-S while the Save As dialog is open keeps the typed name and the chosen folder',
		[getProp('save-as-name', 'value'), getText('save-as-folder')],
		['kept', openDirectory]
	)
	// save only into this test's folder: had Cmd-S put the dialog back on ~/Documents, Escape writes nothing
	press(getText('save-as-folder') === openDirectory ? 'enter' : 'escape')
	settle()
	check(
		'Save As adds the new file to Open Recent',
		openRecent.list()[0],
		join(openDirectory, 'kept.md')
	)
}

export async function testDeepSocketsFolder(): Promise<void> {
	press('cmd-0')
	settle()

	/**
	 * a sockets folder too deep for macOS's 104-byte socket path: `listenForReports` rejects with why, and the window
	 * says so once on stderr instead of swallowing it, and keeps working. the check comes before the folder would be
	 * made, so nothing is created
	 */
	const deepSockets = join(menuDirectory, 'd'.repeat(120))
	const deepPath = join(menuDirectory, 'deep.md')
	writeFileSync(deepPath, 'Deep\n')
	const loggedErrors: string[] = []
	const consoleError = console.error
	console.error = (...messages: string[]) => void loggedErrors.push(messages.join(' '))
	try {
		documentController.open(deepPath, { ...menuOptions, socketsDirectory: deepSockets })
		await wait(100)
		click_test_id('block-0')
		type('r')
		press('escape')
	} finally {
		console.error = consoleError
	}
	/**
	 * Only this window's messages count: another window may log its listener's start failure at any time
	 * (`#reportsUnreachable` in src/ui/DocumentView/controller.svelte.ts).
	 */
	const deepErrors = loggedErrors.filter((message) => message.includes('d'.repeat(120)))
	check(
		'a sockets folder too deep for a socket logs why Reports cannot arrive, once, and the window still edits',
		[
			deepErrors.length,
			loggedErrors.some((message) => message.includes('is longer than the 104 bytes macOS allows')),
			documentController.text,
			existsSync(deepSockets)
		],
		[1, true, 'Deepr\n', false]
	)
}

export async function testLaunchEncodingUntitled(): Promise<void> {
	press('escape')

	// a file named at launch (`parseLaunch`) joins Open Recent, as NSDocumentController notes every document it opens
	const launchedPath = join(menuDirectory, 'launched.md')
	writeFileSync(launchedPath, '# Launched\n')
	documentController.openAtLaunch(launchedPath, menuOptions)
	settle()
	check(
		'a file opened at launch paints and joins Open Recent',
		[painted().includes('Launched'), menuRecent.list()],
		[true, [launchedPath]]
	)

	/**
	 * a file that cannot be opened: NSDocumentController's alert names it and says why, and the window stays as it
	 * was, with nothing opened and nothing added to Open Recent
	 */
	const binaryPath = join(menuDirectory, 'binary.md')
	writeFileSync(binaryPath, Buffer.from([0x23, 0x00, 0x01, 0x02]))
	documentController.load('', menuOptions)
	settle()
	menuWindows.length = 0
	menuPicks.push([binaryPath])
	press('cmd-o')
	await waitUntil(() => find_test_id('open-failed') !== null, 'the open failure alert')
	settle()
	check(
		'Open… of a binary file alerts in NSDocumentController’s words and keeps the untitled window',
		[
			getText('open-failed-title'),
			getText('open-failed-message'),
			documentController.text,
			menuWindows,
			menuRecent.list()
		],
		[
			'The document “binary.md” could not be opened. It contains binary data, not text.',
			'editmd opens markdown and other plain text files.',
			'',
			[],
			[launchedPath]
		]
	)
	const failureShownBeforeOk = find_test_id('open-failed') !== null
	press('enter')
	settle()
	check(
		'Return presses OK and closes the alert, the window as it was',
		[failureShownBeforeOk, find_test_id('open-failed'), documentController.text],
		[true, null, '']
	)

	/**
	 * a recent file deleted on disk leaves Open Recent, as NSDocumentController drops it from `recentDocumentURLs`:
	 * neither the menu bar's submenu nor the Open Recent list shows it, the other recent file still listed
	 */
	documentController.open(launchedPath, menuOptions)
	settle()
	const gonePath = join(menuDirectory, 'gone.md')
	writeFileSync(gonePath, '# Gone\n')
	menuRecent.add(gonePath)
	rmSync(gonePath)
	// the File menu, opened by its title's test id
	clickIfPresent('menu-title-0')
	settle()
	clickRow('Open Recent')
	const goneMenuRows = getPanelRows('submenu')
	press('escape')
	settle()
	documentController.run('openRecent')
	settle()
	const goneListNames = [0, 1].map((index) => getText(`open-recent-name-${index}`))
	press('escape')
	settle()
	check(
		'a recent file deleted on disk is listed neither in File > Open Recent nor in the Open Recent list, the other one still is',
		[goneMenuRows, goneListNames],
		[
			[['launched.md', ''], 'separator', ['Clear Menu', '']],
			['launched.md', undefined]
		]
	)

	const lockedPath = join(menuDirectory, 'locked.md')
	writeFileSync(lockedPath, '# Locked\n')
	chmodSync(lockedPath, 0o000)
	dropOn('block-0', [lockedPath])
	settle()
	check(
		'a dropped text file it may not read alerts that permission is missing and changes nothing',
		[
			getText('open-failed-title'),
			getText('open-failed-message'),
			menuWindows,
			documentController.text
		],
		[
			'The document “locked.md” could not be opened. You don’t have permission.',
			'To view or change permissions, select the item in the Finder and choose File > Get Info.',
			[],
			'# Launched\n'
		]
	)
	chmodSync(lockedPath, 0o644)
	press('escape')

	/**
	 * a file named at launch that cannot be read: NSDocumentController alerts over an empty untitled Document, which
	 * goes with the alert. a throw is caught, so it fails the check instead of the run
	 */
	const missingLaunchPath = join(menuDirectory, 'missing-at-launch.md')
	let launchOpened: boolean | string
	try {
		launchOpened = documentController.openAtLaunch(missingLaunchPath, menuOptions)
	} catch (error) {
		launchOpened = `threw ${error instanceof Error ? error.message : String(error)}`
	}
	settle()
	check(
		'a launch file that cannot be read opens an empty untitled Document and alerts in NSDocumentController’s words',
		[
			launchOpened,
			documentController.text,
			documentController.folder,
			getText('open-failed-title'),
			menuRecent.list().includes(missingLaunchPath)
		],
		[
			false,
			'',
			null,
			'The document “missing-at-launch.md” could not be opened. The file doesn’t exist.',
			false
		]
	)
	press('escape')
	settle()

	/**
	 * f-binary at launch: NSDocumentController refuses a binary file named at launch and editmd opens no window, so the
	 * alert's OK ends the window (a recorder here); the untitled Document behind the alert is only what it is drawn in
	 */
	documentController.openAtLaunch(binaryPath, menuOptions)
	settle()
	const launchRefusal = getText('open-failed-title')
	menuRuns.length = 0
	click_test_id('open-failed-ok')
	settle()
	check(
		'a binary file given at launch shows NSDocumentController’s refusal, and its OK closes the window, as editmd opens none',
		[launchRefusal, find_test_id('open-failed'), menuRuns],
		[
			'The document “binary.md” could not be opened. It contains binary data, not text.',
			null,
			[['closeWindow', []]]
		]
	)

	/**
	 * a save that had to leave the file's encoding says so, as editmd's EditorWindowController `showNotice` sheet
	 */
	// "# Café\n" in Windows-1252, whose é is no valid UTF-8
	const latinBytes = Buffer.from([0x23, 0x20, 0x43, 0x61, 0x66, 0xe9, 0x0a])
	const latinPath = openFixture(menuDirectory, 'latin.md', latinBytes, menuOptions)
	settle()
	click_test_id('block-0')
	type('😀')
	press('cmd-s')
	settle()
	check(
		'a save that Windows-1252 cannot hold writes UTF-8 and shows editmd’s Saved in a Different Encoding alert',
		[
			getText('save-notice-title'),
			getText('save-notice-message'),
			find_test_id('save-notice-ok')?.children?.[0]?.children?.[0]?.text,
			readFileSync(latinPath, 'utf8')
		],
		[
			'Saved in a Different Encoding',
			"The file was saved as UTF-8, because it now contains characters Windows-1252 can't represent.",
			'OK',
			'# Café😀\n'
		]
	)
	const noticeShownBeforeOk = find_test_id('save-notice') !== null
	clickIfPresent('save-notice-ok')
	settle()
	check('OK closes the notice', [noticeShownBeforeOk, find_test_id('save-notice')], [true, null])
	// the click on OK took the field's focus, so its Escape would not reach it
	documentController.closeEdit()
	settle()
	click_test_id('block-0')
	type('x')
	press('cmd-s')
	settle()
	check(
		'the next save, already in UTF-8, shows no notice',
		[readFileSync(latinPath, 'utf8'), find_test_id('save-notice')],
		['# Café😀x\n', null]
	)
	press('escape')

	/**
	 * the notice after Save As: `DocumentFile.saveAs` keeps the file's Windows-1252, so an edit it cannot hold still
	 * shows the notice on the new file. Save As's create path (an untitled Document) always writes UTF-8, which any
	 * later edit fits, so no notice can come from it
	 */
	const latinMovedPath = join(menuDirectory, 'latin-moved.md')
	openFixture(menuDirectory, 'latin-source.md', latinBytes, menuOptions)
	settle()
	press('cmd-shift-s')
	settle()
	retype('latin-source.md', 'latin-moved')
	press('enter')
	settle()
	const movedBytes = existsSync(latinMovedPath) ? readFileSync(latinMovedPath) : null
	click_test_id('block-0')
	type('😀')
	press('cmd-s')
	settle()
	check(
		'after Save As of a Windows-1252 file, a save it cannot hold shows the Saved in a Different Encoding alert',
		[
			movedBytes?.equals(latinBytes),
			getText('save-notice-title'),
			existsSync(latinMovedPath) && readFileSync(latinMovedPath, 'utf8')
		],
		[true, 'Saved in a Different Encoding', '# Café😀\n']
	)
	clickIfPresent('save-notice-ok')
	documentController.closeEdit()
	settle()

	/**
	 * the notice waits behind a dialog already up, here the command palette, as AppKit queues a sheet begun while
	 * another is up and shows it once that one is dismissed
	 */
	const latinPalettePath = openFixture(menuDirectory, 'latin-palette.md', latinBytes, menuOptions)
	settle()
	click_test_id('block-0')
	type('😀')
	press('escape')
	documentController.run('commandPalette')
	settle()
	const paletteBeforeAutosave = find_test_id('command-palette') !== null
	// the autosave comes about a second after the typing; under load later, so the test waits for its write
	await waitUntil(
		() => readFileSync(latinPalettePath).equals(Buffer.from('# Café😀\n', 'utf8')),
		'the autosave behind the palette'
	)
	await settleAfter(100)
	check(
		'an autosave that changes the encoding while the command palette is open waits: the palette stays, no notice yet',
		[
			paletteBeforeAutosave,
			find_test_id('command-palette') !== null,
			find_test_id('save-notice'),
			readFileSync(latinPalettePath).equals(Buffer.from('# Café😀\n', 'utf8'))
		],
		[true, true, null, true]
	)
	press('escape')
	settle()
	check(
		'closing the palette then shows the queued notice, in editmd’s words',
		[find_test_id('command-palette'), getText('save-notice-title'), getText('save-notice-message')],
		[
			null,
			'Saved in a Different Encoding',
			"The file was saved as UTF-8, because it now contains characters Windows-1252 can't represent."
		]
	)
	clickIfPresent('save-notice-ok')
	settle()

	// the same behind the Save As dialog, a sheet in editmd too: its Cancel shows the waiting notice
	const latinSaveAsPath = openFixture(menuDirectory, 'latin-save-as.md', latinBytes, menuOptions)
	settle()
	click_test_id('block-0')
	type('😀')
	press('escape')
	press('cmd-shift-s')
	settle()
	const saveAsBeforeAutosave = find_test_id('save-as') !== null
	await settleAfter(1300)
	check(
		'an autosave that changes the encoding while the Save As dialog is open waits behind it too',
		[
			saveAsBeforeAutosave,
			find_test_id('save-as') !== null,
			find_test_id('save-notice'),
			readFileSync(latinSaveAsPath).equals(Buffer.from('# Café😀\n', 'utf8'))
		],
		[true, true, null, true]
	)
	clickIfPresent('save-as-cancel')
	settle()
	check(
		'Cancel in Save As then shows the queued notice',
		[find_test_id('save-as'), getText('save-notice-title')],
		[null, 'Saved in a Different Encoding']
	)
	clickIfPresent('save-notice-ok')
	settle()

	/**
	 * Save As of an untitled Document (`DocumentFile.create`) writes UTF-8, no BOM, so text no single-byte encoding
	 * holds goes out whole and a later edit needs no notice. the folder is the injected picker's, never ~/Documents
	 */
	const untitledUtf8Path = join(menuDirectory, 'untitled-utf8.md')
	documentController.load('# Café 😀\n', menuOptions)
	settle()
	press('cmd-s')
	settle()
	retype('Untitled.md', 'untitled-utf8')
	clickIfPresent('save-as-choose')
	await waitUntil(() => getText('save-as-folder') === menuDirectory, 'the chosen folder')
	press(getText('save-as-folder') === menuDirectory ? 'enter' : 'escape')
	settle()
	const untitledUtf8Bytes = existsSync(untitledUtf8Path) ? readFileSync(untitledUtf8Path) : null
	click_test_id('block-0')
	type('ü')
	press('cmd-s')
	settle()
	check(
		'Save As of an untitled Document writes its non-ASCII text as UTF-8, and a later edit saves as UTF-8 with no notice',
		[
			untitledUtf8Bytes?.equals(Buffer.from('# Café 😀\n', 'utf8')),
			existsSync(untitledUtf8Path) &&
				readFileSync(untitledUtf8Path).equals(Buffer.from('# Café 😀ü\n', 'utf8')),
			find_test_id('save-notice')
		],
		[true, true, null]
	)
	press('escape')
	documentController.closeEdit()

	/**
	 * an untitled Document has no file to autosave to, so an edit and a pause write nothing and ask nothing. Save As
	 * would go to a folder of its own, empty, and the menu folder is compared by name and modification time, so an
	 * overwrite counts too
	 */
	initUntitledFolder()
	documentController.load('Untitled draft\n', {
		...menuOptions,
		chooseFolder: () => Promise.resolve(untitledFolder)
	})
	settle()
	initMenuFolderBefore()
	click_test_id('block-0')
	type('u')
	press('escape')
	await settleAfter(1500)
	check(
		'an untitled Document with an edit writes no file 1.5s later, shows no save label and no Save As',
		[
			documentController.text,
			readdirSync(untitledFolder),
			snapshotFolder(menuDirectory),
			documentController.label,
			find_test_id('save-status'),
			find_test_id('save-as')
		],
		['Untitled draftu\n', [], menuFolderBefore, '', null, null]
	)
}

export async function testRevertExitStatus(): Promise<void> {
	press('escape')

	/** whether File's Revert to Saved paints greyed in the menu bar's File menu */
	function isRevertGreyed(): boolean {
		openMenu('File')
		const colour = find_test_id(`menu-row-${getRowIndex('Revert to Saved')}`)?.style?.color
		press('escape')
		settle()
		return colour === themeController.palette.faint
	}
	openFixture(menuDirectory, 'revert-host.md', 'Revert host.\n', menuOptions)
	settle()
	const cleanFileRevert = isRevertGreyed()
	click_test_id('block-0')
	type('r')
	press('escape')
	settle()
	const editedFileRevert = isRevertGreyed()
	documentController.load('Draft.\n', menuOptions)
	settle()
	click_test_id('block-0')
	type('u')
	press('escape')
	settle()
	const editedUntitledRevert = isRevertGreyed()
	check(
		'File > Revert to Saved is enabled for a file, clean or edited, and greyed for an untitled Document, as NSDocument validates it',
		[cleanFileRevert, editedUntitledRevert, editedFileRevert],
		[false, true, false]
	)

	/**
	 * gpuix has no close hook: closing the last window or quitting exits the process, so a process `exit` handler saves
	 * a file with unsaved edits, as editmd's `canClose` saves instead of asking (Document.swift:180-204). the registrar is
	 * this test's, so the handler is called here rather than at the suite's own exit
	 */
	const exitHandlers: (() => void)[] = []
	const exitOptions = {
		...menuOptions,
		onExit: (handler: () => void) => void exitHandlers.push(handler)
	}
	const exitEditedPath = join(menuDirectory, 'exit-edited.md')
	const exitCleanPath = join(menuDirectory, 'exit-clean.md')
	writeFileSync(exitEditedPath, 'Draft\n')
	writeFileSync(exitCleanPath, 'Clean\n')
	documentController.open(exitEditedPath, exitOptions)
	settle()
	click_test_id('block-0')
	type('q')
	press('escape')
	// at once, well before the 1s autosave, as a window closed right after its last key
	const editedBeforeExit = readFileSync(exitEditedPath, 'utf8')
	exitHandlers.at(-1)?.()
	const editedAfterExit = readFileSync(exitEditedPath, 'utf8')
	documentController.open(exitCleanPath, exitOptions)
	settle()
	const cleanModifiedBefore = statSync(exitCleanPath).mtimeMs
	exitHandlers.at(-1)?.()
	const cleanUntouched = statSync(exitCleanPath).mtimeMs === cleanModifiedBefore
	const exitUntitledFolder = mkdtempSync(join(tmpdir(), 'eg-exit-untitled-'))
	documentController.load('Untitled\n', {
		...exitOptions,
		chooseFolder: () => Promise.resolve(exitUntitledFolder)
	})
	settle()
	click_test_id('block-0')
	type('w')
	press('escape')
	exitHandlers.at(-1)?.()
	settle()
	check(
		'the exit handler writes a file’s unsaved edit, leaves a clean file and an untitled Document alone, and is registered once',
		[
			editedBeforeExit,
			editedAfterExit,
			cleanUntouched,
			readdirSync(exitUntitledFolder),
			find_test_id('save-as'),
			exitHandlers.length
		],
		['Draft\n', 'Draftq\n', true, [], null, 1]
	)
	rmSync(exitUntitledFolder, { recursive: true, force: true })

	/**
	 * Return at a paragraph's end opens an empty Block whose blank line sits in the text until something is typed; editmd
	 * never writes its empty paragraph, so ⌘S, the autosave and the exit save write the text without it, the field open
	 */
	const blankSavePath = openFixture(menuDirectory, 'blank-save.md', 'Para\n', exitOptions)
	settle()
	/** a key typed at the end of Block 0, so there is an edit to save, then Return there: the new Block's empty field */
	function typeThenReturn(key: string): void {
		click_test_id('block-0')
		type(key)
		type('enter')
		settle()
	}
	typeThenReturn('a')
	press('cmd-s')
	const blankAfterSave = readFileSync(blankSavePath, 'utf8')
	press('escape')
	typeThenReturn('b')
	await wait(1300)
	const blankAfterAutosave = readFileSync(blankSavePath, 'utf8')
	press('escape')
	typeThenReturn('c')
	exitHandlers.at(-1)?.()
	const blankAfterExit = readFileSync(blankSavePath, 'utf8')
	const blankFieldOpen = [documentController.activeIsNew, find_test_id('block-editor') !== null]
	press('escape')
	check(
		'with Return’s empty Block open, ⌘S, the autosave and the exit save write no blank line for it, and the field stays open',
		[blankAfterSave, blankAfterAutosave, blankAfterExit, blankFieldOpen],
		['Paraa\n', 'Paraab\n', 'Paraabc\n', [true, true]]
	)

	/**
	 * the title says Edited while the Document has unsaved edits, as NSDocument's does: "<name> — Edited" (AppKit's
	 * AutosaveButton.loctable "Edited" after Document.loctable's " — "), and the plain name once an autosave clears it
	 */
	const titledPath = openFixture(menuDirectory, 'titled.md', 'Titled\n', menuOptions)
	settle()
	menuRuns.length = 0
	click_test_id('block-0')
	type('t')
	press('escape')
	const titlesWhileEdited = menuRuns.slice()
	await waitUntil(
		() => readFileSync(titledPath, 'utf8') === 'Titledt\n',
		'the titled file’s autosave'
	)
	settle()
	const titlesAfterAutosave = menuRuns.slice()
	documentController.load('Note\n', menuOptions)
	settle()
	menuRuns.length = 0
	click_test_id('block-0')
	type('n')
	press('escape')
	check(
		'an edit titles the window “<name> — Edited”, the autosave titles it back to the name, and an untitled Document says Untitled — Edited',
		[titlesWhileEdited, titlesAfterAutosave, menuRuns],
		[
			[['setWindowTitle', ['titled.md — Edited']]],
			[
				['setWindowTitle', ['titled.md — Edited']],
				['setWindowTitle', ['titled.md']]
			],
			[['setWindowTitle', ['Untitled — Edited']]]
		]
	)

	/**
	 * a failed save, as editmd's SaveStatusView (EditorWindowController.swift:331-367): Not Saved in AppKit's systemRed
	 * with its reason as the tooltip, in the small system font; an autosave failure shows no alert, as in editmd
	 */
	const statusPath = openFixture(menuDirectory, 'status.md', 'Status\n', menuOptions)
	settle()
	chmodSync(statusPath, 0o444)
	/**
	 * Foundation's sentence for a file it may not write (FoundationErrors.loctable, Err513), when the file is read-only
	 * indeed: editmd's tooltip is the save error's `localizedDescription`
	 */
	function getWriteRefusal(path: string): string {
		try {
			accessSync(path, constants.W_OK)
			return 'writable'
		} catch {
			return `You don’t have permission to save the file “${basename(path)}” in the folder “${basename(join(path, '..'))}”.`
		}
	}
	click_test_id('block-0')
	type('s')
	press('escape')
	await waitUntil(() => documentController.label === 'Not Saved', 'the failed autosave')
	settle()
	const statusTip = await loadTipAfterHover('save-status', 'save-status-tooltip-tip')
	// editmd's reason is the label's native tooltip (EditorWindowController.swift:360), shown at the pointer
	check(
		'Not Saved’s tip shows at the pointer, below it and pulled back inside the window’s right edge',
		getTipOffset(getCentre('save-status'), 'save-status-tooltip-tip'),
		[0, 0]
	)
	check(
		'an autosave that fails paints Not Saved in systemRed at the small system size, its reason as the tooltip, and no alert',
		[
			getText('save-status'),
			find_test_id('save-status')?.style?.color,
			find_test_id('save-status')?.style?.fontSize,
			statusTip,
			find_test_id('save-failed')
		],
		[
			'Not Saved',
			themeController.palette['system-red'],
			11,
			labelDetail({ kind: 'failed', message: getWriteRefusal(statusPath) }),
			null
		]
	)
	check(
		'the label fades in over editmd’s 0.15s through native motion',
		find_test_id('save-status')?.customProps?.motion,
		{ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.15 } }
	)
	// editmd's SaveStatusView sits 10px from the window's right edge (EditorWindowController.swift:340-353)
	const statusBox = bounds(find_test_id('save-status') ?? 0)
	check(
		'the save-status label ends 10px from the window’s right edge',
		statusBox ? snapToWanted([800 - statusBox.x - statusBox.width], [10]) : null,
		[10]
	)

	/**
	 * A click on a tip's trigger while its delay runs keeps the tip away, as AppKit's tooltip (in editmd a WebKit
	 * `title`) shows after no mouse down; moves on the trigger bring it no tip until the pointer leaves and comes back.
	 */
	const statusPoint = getCentre('save-status')
	mouse_move(getCentre('block-0'))
	await settleAfter(100)
	mouse_move(statusPoint)
	await settleAfter(100)
	mouse_down(statusPoint)
	mouse_up(statusPoint)
	await settleAfter(500)
	const clickedTip = getText('save-status-tooltip-tip') ?? null
	mouse_move({ x: statusPoint.x - 1, y: statusPoint.y })
	await settleAfter(500)
	const movedTip = getText('save-status-tooltip-tip') ?? null
	mouse_move(getCentre('block-0'))
	await settleAfter(100)
	const returnedTip = await loadTipAfterHover('save-status', 'save-status-tooltip-tip')
	check(
		'a click on a tip’s trigger before its delay ends shows no tip, nor do moves on it after; leaving and coming back shows it',
		[clickedTip, movedTip, returnedTip === statusTip],
		[null, null, true]
	)

	/**
	 * ⌘S on the read-only file asks to save it anyway, as editmd's NSDocument does for a locked file; the field closes
	 * first, so the dialog's Return reaches the dialog rather than the field, and Return is Cancel, its default, which
	 * writes nothing
	 */
	click_test_id('block-0')
	type('k')
	press('escape')
	press('cmd-s')
	settle()
	check(
		'Cmd-S on a read-only file asks to save it anyway, in editmd’s words, Cancel the default',
		[getText('save-locked-title'), getText('save-locked-message')],
		[
			'The document “status.md” could not be saved. The file is locked.',
			'Do you want to save your changes to it anyway?'
		]
	)
	/**
	 * editmd's NSAlert (measured in editmd's window at 2x): a 260pt box with a 26pt radius, a caution icon above the
	 * text, the message in the title's label colour, two equal buttons side by side, and Cancel, the key button, ringed
	 * 3pt in the accent with the same fill as the other button rather than an accent one
	 */
	const lockedBox = bounds(find_test_id('save-locked') ?? 0)
	const lockedStyle = find_test_id('save-locked')?.style
	const lockedCancel = find_test_id('save-locked-cancel')
	const lockedAnyway = find_test_id('save-locked-anyway')
	const cancelBox = bounds(lockedCancel ?? 0)
	const anywayBox = bounds(lockedAnyway ?? 0)
	check(
		'the locked-file alert is editmd’s NSAlert: 260px wide, radius 26, a caution icon, the message in the title’s colour, Cancel in AppKit’s 3px focus ring with the other button’s fill, the buttons equal and side by side',
		[
			lockedBox?.width,
			lockedStyle?.borderTopLeftRadius ?? lockedStyle?.borderRadius,
			find_test_id('save-locked-icon') !== null,
			find_test_id('save-locked-message')?.style?.color,
			lockedCancel?.style?.outlineWidth,
			lockedCancel?.style?.outlineColor,
			lockedCancel?.style?.backgroundColor === lockedAnyway?.style?.backgroundColor,
			// GPUI snaps each box to the 2x display's half-pixel grid, so equal within a pixel
			cancelBox && anywayBox
				? [Math.abs(cancelBox.width - anywayBox.width) <= 1, cancelBox.y === anywayBox.y]
				: null
		],
		[
			260,
			26,
			true,
			themeController.palette.text,
			3,
			themeController.focusRing ?? themeController.palette['focus-ring'],
			true,
			[true, true]
		]
	)
	/**
	 * editmd's alert darkens the page behind it, its box is AppKit's lighter grey with no border, and both push buttons
	 * take AppKit's control fill (measured in editmd's window: the page #28292d under it painted #1e2123, the box #404244, each
	 * button the box plus about 10% white)
	 */
	const lockedBackdrop = find_test_id('save-locked-backdrop')?.style
	check(
		'the alert darkens the page behind it, its box is the alert surface with no border, and both its buttons the alert button fill',
		[
			lockedBackdrop?.backgroundColor,
			lockedStyle?.backgroundColor,
			lockedStyle?.borderWidth ?? lockedStyle?.borderTopWidth ?? 0,
			lockedCancel?.style?.backgroundColor,
			lockedAnyway?.style?.backgroundColor
		],
		[
			themeController.palette['alert-dim'],
			themeController.palette['alert-surface'],
			0,
			themeController.palette['alert-button'],
			themeController.palette['alert-button']
		]
	)
	const saveAlertBeforeReturn = find_test_id('save-locked') !== null
	press('enter')
	settle()
	chmodSync(statusPath, 0o644)
	// the next save works, so Saved shows, then goes after editmd's 2s and fades out over its 0.4s
	click_test_id('block-0')
	type('o')
	press('escape')
	press('cmd-s')
	settle()
	check(
		'Saved paints in AppKit’s secondaryLabelColor, as editmd’s SaveStatusView (EditorWindowController.swift:358)',
		[getText('save-status'), find_test_id('save-status')?.style?.color],
		['Saved', themeController.palette['secondary-label']]
	)
	/**
	 * polled every 10ms from the moment the label empties, since one sample can land after the 0.4s fade; the first poll
	 * that sees it empty records what still paints
	 */
	let fadingText: string | null = null
	let fadingMotion: unknown = undefined
	for (const deadline = Date.now() + 5000; Date.now() < deadline; await wait(10)) {
		settle()
		if (documentController.label !== '') continue

		fadingText = getText('save-status') ?? null
		fadingMotion = find_test_id('save-status')?.customProps?.motion
		break
	}
	await settleAfter(600)
	check(
		'Return closes the alert; once Saved goes it stays painted while it fades out over 0.4s, then is gone',
		[
			saveAlertBeforeReturn,
			find_test_id('save-locked'),
			fadingText,
			fadingMotion,
			find_test_id('save-status')
		],
		[
			true,
			null,
			'Saved',
			{ initial: { opacity: 0 }, animate: { opacity: 0 }, transition: { duration: 0.4 } },
			null
		]
	)

	/**
	 * View > Load Remote Images holds for the window, as editmd's EditorBridge keeps it per window (EditorBridge.swift:
	 * 140-146): a file opened into this window after it paints its remote images at once
	 */
	const remotePath = join(menuDirectory, 'remote.md')
	writeFileSync(remotePath, `![tracker](${remote}/p.png)\n`)
	documentController.load('', menuOptions)
	settle()
	documentController.run('loadRemoteImages')
	menuPicks.push([remotePath])
	press('cmd-o')
	await waitUntil(
		() => documentController.text.includes('tracker'),
		'the remote file opened in place'
	)
	settle()
	check(
		'a file opened into a window that loaded remote images paints its remote image, not its alt text',
		[documentController.folder, getProp('image-0-0', 'src'), find_test_id('image-blocked-0-0')],
		[menuDirectory, `${remote}/p.png`, null]
	)
}

export async function testKindsDropsNewWindow(): Promise<void> {
	/**
	 * a linked or dropped file is described as macOS describes it (UTType, src/host/fileKinds.ts), here by recorders: a
	 * `.custom` file the recorder calls text opens as a Document, a `.picture` it calls an image goes in as one
	 */
	const kindsPath = join(sandboxDirectory, 'kinds.md')
	writeFileSync(kindsPath, '[notes](notes.custom)\n')
	const kindAsks: string[] = []
	menuRuns.length = 0
	documentController.open(kindsPath, {
		...sandboxOptions,
		describeFile: (filePath: string) => {
			kindAsks.push(`describe ${basename(filePath)}`)
			return { isDirectory: false, isText: true }
		},
		isTextName: (filePath: string) => {
			kindAsks.push(`text ${basename(filePath)}`)
			return true
		},
		isImageName: (filePath: string) => {
			kindAsks.push(`image ${basename(filePath)}`)
			return filePath.endsWith('.picture')
		}
	})
	settle()
	clickLinkIn('block-0', 'cmd')
	drop_files(find_test_id('block-0') ?? 0, [join(sandboxDirectory, 'shot.picture')])
	check(
		'a followed link and a dropped file are told apart by the type the window is handed, macOS’s by default',
		[
			menuRuns.filter(([command]) => command === 'openInEditor' || command === 'open'),
			kindAsks,
			documentController.text.includes('shot.picture')
		],
		[
			[['openInEditor', [join(sandboxDirectory, 'notes.custom')]]],
			['describe notes.custom', 'image shot.picture'],
			true
		]
	)

	/**
	 * row e-drop: a dropped file that is neither an image nor text is shown in Finder, not opened. runs before any front
	 * matter field opens: once one has opened and closed, a headless drop reaches no handler (a harness limit, not app
	 * behaviour)
	 */
	const droppedOther = join(sandboxDirectory, 'archive.zip')
	writeFileSync(droppedOther, 'PK')
	menuRuns.length = 0
	menuWindows.length = 0
	documentController.load('Drop here.\n', {
		...sandboxOptions,
		describeFile: () => ({ isDirectory: false, isText: false }),
		isTextName: () => false,
		isImageName: () => false
	})
	settle()
	drop_files(find_test_id('block-0') ?? 0, [droppedOther])
	check(
		'a dropped file that is neither an image nor text is revealed in Finder, not opened',
		[menuRuns, menuWindows, documentController.text],
		[[['open', ['-R', droppedOther]]], [], 'Drop here.\n']
	)

	/**
	 * a drop that inserts nothing leaves the open Block field as it was, as editmd's drop of a non-image never touches its
	 * editor's selection: a text file opens a window, another file is revealed, and the field keeps its typing and its keys
	 */
	const droppedNote = join(sandboxDirectory, 'dropped-note.md')
	writeFileSync(droppedNote, '# Note\n')
	menuRuns.length = 0
	menuWindows.length = 0
	const dropSource = 'One.\n\nTwo.\n\n- [ ] task\n\n| a |\n| - |\n| b |\n'
	documentController.load(dropSource, {
		...sandboxOptions,
		describeFile: (filePath: string) => ({ isDirectory: false, isText: filePath.endsWith('.md') }),
		isTextName: (filePath: string) => filePath.endsWith('.md'),
		isImageName: () => false
	})
	settle()
	click_test_id('block-0')
	type('cmd-right x')
	await waitForFieldIdle()
	const dropRevision = documentController.fieldRevision
	dropOn('block-1', [droppedNote])
	dropOn('block-1', [droppedOther])
	// a task's text and a table take their own clicks, so a drop on them is theirs too
	dropOn(`task-text-${documentController.blocks[2]?.items?.[0]?.contentStart ?? -1}`, [droppedNote])
	dropOn('table-3', [droppedOther])
	const afterDrops = [
		documentController.activeIndex,
		documentController.fieldRevision - dropRevision
	]
	type('y')
	await waitForFieldIdle()
	press('escape')
	check(
		`a dropped text file and a dropped other file, on a Block, a task’s text or a table, leave the open Block field open and typing on (${JSON.stringify(afterDrops)})`,
		[
			afterDrops,
			documentController.text,
			menuWindows,
			menuRuns.filter(([command]) => command === 'open')
		],
		[
			[0, 0],
			dropSource.replace('One.', 'One.xy'),
			[droppedNote, droppedNote],
			[
				['open', ['-R', droppedOther]],
				['open', ['-R', droppedOther]]
			]
		]
	)

	/**
	 * AppKit replaces only the untouched untitled window it opened at launch: a window File > New opened (its process
	 * told so by NEW_WINDOW_ENV) opens Open…'s file in a new window
	 */
	const openedPath = join(sandboxDirectory, 'opened.md')
	writeFileSync(openedPath, 'Opened.\n')
	menuWindows.length = 0
	documentController.load('', { ...sandboxOptions, startedByNew: true })
	settle()
	menuPicks.push([openedPath])
	press('cmd-o')
	await wait(50)
	const fromNewWindow = [[...menuWindows], documentController.hasFile]
	menuWindows.length = 0
	documentController.load('', sandboxOptions)
	settle()
	menuPicks.push([openedPath])
	press('cmd-o')
	await wait(50)
	const spawnedWith: (string | undefined)[] = []
	openEditorWindow(null, () => void spawnedWith.push(process.env[NEW_WINDOW_ENV]))
	openEditorWindow(openedPath, () => void spawnedWith.push(process.env[NEW_WINDOW_ENV]))
	check(
		'Open… in a window File > New opened opens a new window, and in the launch’s untouched one opens in place; New’s opener alone tells its process so',
		[
			fromNewWindow,
			[[...menuWindows], documentController.hasFile],
			spawnedWith,
			process.env[NEW_WINDOW_ENV]
		],
		[[[openedPath], false], [[], true], ['1', undefined], undefined]
	)
}

export async function testRenamedElsewhere(): Promise<void> {
	/**
	 * NSDocument follows a file another program renames (`presentedItemDidMove`, DocumentFile.onMoved): the window takes
	 * the new name, a later write at the new path merges in, and Open Recent holds the new path
	 */
	initMovedPath()
	const movingPath = openFixture(sandboxDirectory, 'moving.md', 'Moving.\n', sandboxOptions)
	await wait(100)
	menuRuns.length = 0
	renameSync(movingPath, movedPath)
	await waitUntil(
		() =>
			menuRuns.some(([command, args]) => command === 'setWindowTitle' && args[0] === 'moved.md'),
		'the new title'
	)
	writeFileSync(movedPath, 'Moving.\n\nLater.\n')
	await waitUntil(() => documentController.text.includes('Later.'), 'the write at the new path')
	check(
		'a file renamed by another program is followed: the window takes its new name, a write there merges in, Open Recent holds the new path',
		[
			menuRuns.filter(([command]) => command === 'setWindowTitle'),
			documentController.text,
			sandboxOptions.recentFiles.list()[0]
		],
		// the open descriptor names the file by its real path (`/private/var/…` for the temp folder's `/var/…`)
		[[['setWindowTitle', ['moved.md']]], 'Moving.\n\nLater.\n', realpathSync(movedPath)]
	)
}

export async function testSaveAsTxtQuitRevert(): Promise<void> {
	// NSDocument keeps a document's type through Save As: a .txt document saved as "copy" becomes copy.txt (saveAsPath)
	openFixture(sandboxDirectory, 'notes.txt', 'plain text\n', sandboxOptions)
	settle()
	press('cmd-shift-s')
	settle()
	retype('notes.txt', 'copy')
	press('enter')
	settle()
	check(
		'Save As of a .txt document named “copy” writes copy.txt, not copy.md',
		[
			existsSync(join(sandboxDirectory, 'copy.txt')),
			existsSync(join(sandboxDirectory, 'copy.md')),
			existsSync(join(sandboxDirectory, 'copy.txt.md'))
		],
		[true, false, false]
	)

	/**
	 * ⌘Q (a Command of its own, shortcuts.ts): a file's unsaved edit is written before the process ends (`closeWindow`, a
	 * recorder here), and an untitled Document with edits asks first, as Close does. headless only: in a real window
	 * GPUI's own Quit binding takes ⌘Q before any listener (measured in a real window)
	 */
	const quitPath = openFixture(sandboxDirectory, 'quit.md', 'Quit.\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	type('x')
	menuRuns.length = 0
	press('cmd-q')
	settle()
	const quitSaved = [
		readFileSync(quitPath, 'utf8'),
		menuRuns.filter(([command]) => command === 'closeWindow')
	]
	documentController.load('', sandboxOptions)
	settle()
	type('y')
	menuRuns.length = 0
	press('cmd-q')
	settle()
	const quitAsks = [
		find_test_id('save-changes') !== null,
		menuRuns.filter(([command]) => command === 'closeWindow')
	]
	press('escape')
	settle()
	check(
		'⌘Q writes a file’s unsaved edit before the window ends, and asks about an untitled Document’s edits first (headless: the port’s quit handler, not GPUI’s Quit)',
		[quitSaved, quitAsks],
		[
			['Quit.x\n', [['closeWindow', []]]],
			[true, []]
		]
	)

	/**
	 * Revert to Saved that cannot read the file (deleted under the window) presents the failure, as NSDocument
	 * presents a failed revert, and keeps the Document as it was
	 */
	const goneRevertPath = openFixture(sandboxDirectory, 'revert.md', 'Kept.\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	type('x')
	press('escape')
	rmSync(goneRevertPath)
	documentController.revert()
	settle()
	documentController.revertConfirmed()
	settle()
	const revertFailure = [find_test_id('open-failed') !== null, documentController.text]
	press('enter')
	settle()
	check(
		'Revert to Saved of a file deleted under the window shows the failure alert and keeps the Document as it was',
		revertFailure,
		[true, 'Kept.x\n']
	)
}

export async function testPreselectedNames(): Promise<void> {
	// Save As selects the name's base, so typing replaces it and keeps the extension, as NSSavePanel
	openFixture(sandboxDirectory, 'render.md', 'Render.\n', sandboxOptions)
	settle()
	documentController.run('saveAs')
	settle()
	await wait(150)
	type('x')
	settle()
	const typedSaveAsName = getProp('save-as-name', 'value')
	press('escape')
	settle()
	check('Save As opens with the name’s base selected: typing x gives x.md', typedSaveAsName, 'x.md')

	// Add Link selects its prefilled URL, so typing replaces it, as NSAlert's first field
	setMenuClipboardUrl('https://example.com/prefilled')
	documentController.load('Link here.\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	press('cmd-shift-k')
	settle()
	await wait(150)
	type('h')
	settle()
	const typedLinkUrl = getProp('add-link-url', 'value')
	press('escape')
	settle()
	press('escape')
	setMenuClipboardUrl(null)
	check('Add Link opens with its prefilled URL selected: typing h replaces it', typedLinkUrl, 'h')
}

export async function testLockedOwnedPrint(): Promise<void> {
	/**
	 * ⌘S on a locked file asks to save anyway, in editmd's words, Cancel the default; Save Anyway writes
	 * the edit and keeps the file's mode
	 */
	const lockedSavePath = openFixture(sandboxDirectory, 'locked.md', 'Locked\n', sandboxOptions)
	settle()
	chmodSync(lockedSavePath, 0o444)
	click_test_id('block-0')
	type('cmd-down k')
	await waitForFieldIdle()
	press('escape')
	press('cmd-s')
	settle()
	const lockedDialog = [
		getText('save-locked-title'),
		getText('save-locked-message'),
		find_test_id('save-locked-cancel')?.children?.[0]?.children?.[0]?.text,
		find_test_id('save-locked-anyway')?.children?.[0]?.children?.[0]?.text
	]
	clickIfPresent('save-locked-anyway')
	settle()
	const lockedAfter = [
		readFileSync(lockedSavePath, 'utf8'),
		(statSync(lockedSavePath).mode & 0o777).toString(8)
	]
	chmodSync(lockedSavePath, 0o644)
	check(
		'⌘S on a locked file asks to save it anyway in editmd’s words, and Save Anyway writes the edit and keeps the mode 444',
		[lockedDialog, lockedAfter],
		[
			[
				'The document “locked.md” could not be saved. The file is locked.',
				'Do you want to save your changes to it anyway?',
				'Cancel',
				'Save Anyway'
			],
			['Lockedk\n', '444']
		]
	)

	/**
	 * a file another window already has comes forward there, as editmd brings a document's window
	 * forward, instead of opening twice: the other window stands in as a listener on this test's sockets folder
	 */
	const ownedPath = join(sandboxDirectory, 'owned.md')
	writeFileSync(ownedPath, 'Owned elsewhere.\n')
	let otherFocused = 0
	const stopOwnerWindow = await listenForReports(
		sandboxOptions.socketsDirectory,
		() => {},
		() => {},
		() => [],
		{
			owns: (path: string) => path === realpathSync(ownedPath),
			focus: () => void otherFocused++
		}
	)
	const openerPath = openFixture(sandboxDirectory, 'opener.md', 'Opener.\n', sandboxOptions)
	settle()
	await wait(150)
	menuWindows.length = 0
	menuPicks.push([ownedPath])
	documentController.run('open')
	await waitUntil(() => otherFocused > 0, 'the other window coming forward')
	await wait(150)
	await stopOwnerWindow()
	check(
		'File > Open… on a file another window has brings that window forward and starts no new one',
		[otherFocused, menuWindows],
		[1, []]
	)

	// Print hands the page the document's folder, so relative images print
	let printedFolder: string | null | undefined
	documentController.open(openerPath, {
		...sandboxOptions,
		writePrintable: (_text: string, title: string, folder: string | null) => {
			printedFolder = folder
			return join(sandboxDirectory, `${title}.html`)
		}
	})
	settle()
	press('cmd-p')
	settle()
	check(
		`Print hands the printable page the document’s folder (${printedFolder})`,
		[sandboxDirectory, realpathSync(sandboxDirectory)].includes(printedFolder ?? ''),
		true
	)
}
