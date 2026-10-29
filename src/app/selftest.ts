/**
 * `editmd --selftest FILE` (Headless.swift:11, SelfTest.swift@9e889e6): FILE opened, edited and saved through the
 * app, checking the Document's state and what lands on disk at each step, one `ok`/`FAIL` line per check. FILE is
 * overwritten. the app here is the real DocumentController, DocumentView and host classes, mounted on GPUI's headless
 * renderer; typing goes through the field's change event, keys and drops through GPUI's own dispatch. every scratch
 * file sits next to FILE (`selftest-*`) and is removed afterwards. editmd's crashRecovery group has no counterpart:
 * there is no web content process to kill
 */

import { type ChildProcess, spawn } from 'node:child_process'
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { dispatch } from 'gpuix-svelte'
import {
	click_test_id,
	find,
	find_all,
	find_test_id,
	focus,
	MAX_HEADLESS_HEIGHT,
	mount_headless,
	mouse_move,
	press,
	pump,
	settle,
	type TreeNode,
	type as typeKeys,
	unfocus,
	wait
} from 'gpuix-svelte/test'
import { linkAction } from '../core/linkPolicy.ts'
import { carryOutLink } from '../host/openLink.ts'
import { encodePng } from '../host/png.ts'
import { agentProcessesOptions } from './agentProcessesEnv.ts'
import { LegendPreference } from '../host/legendPreference.ts'
import { RecentFiles } from '../host/recent.ts'
import { documentController, type OpenOptions } from '../ui/DocumentView/controller.svelte.ts'
import HeadlessPage from './HeadlessPage.svelte'
import { reportEdit } from './reportEdit.ts'
import { ThemeController } from './theme.svelte.ts'

/** what the run prints, one line at a time */
export type SelfTestOutput = (line: string) => void

/** a 1x1 PNG, as editmd's PixelServer serves */
const PIXEL = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64'
)

/** editmd's `until`: 100 polls 50ms apart, each letting timers, watchers and GPUI's frames run */
async function until(what: string, condition: () => boolean): Promise<void> {
	for (let poll = 0; poll < 100; poll++) {
		if (condition()) return
		await wait(50)
	}
	throw new Error(`timed out waiting for ${what}`)
}

const pause = async (milliseconds: number) => {
	await wait(milliseconds)
	pump()
}

/** most editors and tools save this way: a new file renamed over the old one */
function writeAtomically(path: string, data: string | Uint8Array): void {
	writeFileSync(`${path}.selftest-tmp`, data)
	renameSync(`${path}.selftest-tmp`, path)
}

/** Windows-1252 bytes for text of ASCII, é and Ü only, as `.windowsCP1252` writes it */
const windows1252 = (text: string) =>
	Buffer.from(
		[...text].map((character) =>
			character === 'é' ? 0xe9 : character === 'Ü' ? 0xdc : character.charCodeAt(0)
		)
	)
const utf16 = (text: string) =>
	Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])

/** the text of a node's own <text> children, '' when it has none */
const textOf = (node: TreeNode | null): string =>
	(node?.children ?? []).map((child) => child.text ?? textOf(child)).join('')

/** the first <markdown> inside `node`, which reports its link runs' clicks */
function markdownIn(node: TreeNode | null): TreeNode | null {
	if (!node) return null
	if (node.type === 'markdown') return node
	for (const child of node.children ?? []) {
		const found = markdownIn(child)
		if (found) return found
	}
	return null
}

/** GPUI's headless renderer, which simulates a Finder drop */
type HeadlessRenderer = ReturnType<typeof mount_headless>['native']

/** one self-test run: its checks, and the window's outside effects recorded instead of carried out */
class SelfTest {
	readonly #print: SelfTestOutput
	readonly #folder: string
	readonly #support: string
	#failures = 0
	/** set once the page is mounted */
	native: HeadlessRenderer | null = null
	/** what links and drops asked to start, as editmd's `decision` strings */
	decisions: string[] = []
	/** the windows a drop or a link asked to open */
	windows: (string | null)[] = []
	windowClosed = false

	constructor(url: string, print: SelfTestOutput) {
		this.#folder = dirname(url)
		this.#print = print
		// a short root: the window's agent socket inside it must fit macOS's 104-byte socket path limit
		this.#support = mkdtempSync(join(tmpdir().length > 40 ? '/tmp' : tmpdir(), 'eg-selftest-'))
	}

	get failures(): number {
		return this.#failures
	}

	check(condition: boolean, label: string): void {
		this.#print(`${condition ? 'ok  ' : 'FAIL'} ${label}`)
		if (!condition) this.#failures++
	}

	/** where the agent hooks' Reports go: the window listens there, nowhere a real editor does */
	get sockets(): string {
		return join(this.#support, 's')
	}

	/** the window's outside effects, recorded: nothing launches, no picker opens, no real store is written */
	get options(): OpenOptions {
		const decide = (path: string) => {
			const folder = existsSync(dirname(path)) ? realpathSync(dirname(path)) : dirname(path)
			return join(folder, basename(path))
		}
		return {
			socketsDirectory: this.sockets,
			run: (command, args) => {
				if (command !== 'open') return
				this.decisions.push(
					args[0] === '-R' ? `reveal ${decide(args[1] ?? '')}` : `open ${args.join(' ')}`
				)
			},
			openInEditor: (path) => void this.decisions.push(`edit ${decide(path)}`),
			openWindow: (path) => void this.windows.push(path),
			closeWindow: () => {
				this.windowClosed = true
			},
			chooseFolder: () => Promise.resolve(null),
			choosePaths: () => Promise.resolve(null),
			setWindowTitle: () => {},
			writePrintable: () => '',
			recentFiles: new RecentFiles(join(this.#support, 'recent.json')),
			legendPreference: new LegendPreference(join(this.#support, 'legend.json')),
			minimizeWindow: () => {},
			zoomWindow: () => {},
			activateWindow: () => {},
			toggleFullScreen: () => {},
			readClipboardUrl: () => null,
			onExit: () => {},
			// the machine's running agents, those in an end-to-end run's own folder only (EDITMD_GPUIX_AGENT_ROOT)
			...agentProcessesOptions(process.env)
		}
	}

	/** a scratch folder next to FILE, as editmd's `selftest-*`; removed by the group that made it */
	scratch(name: string): string {
		const folder = join(this.#folder, name)
		mkdirSync(folder, { recursive: true })
		return folder
	}

	/** opens `path` as the window's Document and lets it paint */
	open(path: string): void {
		documentController.open(path, this.options)
		settle()
	}

	/**
	 * editmd's `type(_:intoFirst: "h1")`: `text` goes in at the start of the first heading's words. the field's change
	 * event carries its whole new value, as typing would leave it, and Escape closes it
	 */
	typeIntoFirstHeading(text: string): void {
		const index = documentController.blocks.findIndex((block) => block.kind === 'heading')
		if (index < 0) throw new Error('no heading to type into')
		click_test_id(`block-${index}`)
		const field = find_test_id('block-editor')
		if (!field) throw new Error('the heading opened no field')
		const value = documentController.activeSource.replace(/^(#+ )/, `$1${text}`)
		dispatch({ elementId: field.id, eventType: 'change', value })
		settle()
		press('escape')
	}

	/**
	 * editmd's Cmd-click on a link: the link run reports its href, then the Block takes the click with Cmd held, as GPUI
	 * delivers the two; a link of another scheme asks first, which is recorded and cancelled
	 */
	cmdClickLink(index: number, href: string): void {
		const block = find_test_id(`block-${index}`)
		const markdown = markdownIn(block)
		if (!block || !markdown) throw new Error(`no link runs in block ${index}`)
		dispatch({ elementId: markdown.id, eventType: 'linkClick', value: href })
		dispatch({
			elementId: block.id,
			eventType: 'click',
			modifiers: { cmd: true, shift: false, ctrl: false, alt: false }
		})
		settle()
		const overlay = documentController.overlay
		if (overlay?.kind === 'confirmLink') {
			this.decisions.push(`ask ${overlay.url}`)
			click_test_id('confirm-link-cancel')
		}
	}

	/**
	 * editmd's page navigating to `url` itself, which its navigation delegate hands to the link policy
	 * (`linkAction`, which maps `editmd://file/<path>` to that file): what it would start goes to the recording opener,
	 * and a URL of another scheme is recorded as asked about, as `cmdClickLink` records the dialog
	 */
	navigate(url: string): void {
		const action = linkAction(url)
		if (action.kind === 'confirm') this.decisions.push(`ask ${action.url}`)
		else {
			const { run, openInEditor } = this.options
			if (run && openInEditor) carryOutLink(action, run, openInEditor)
		}
	}

	/** a Finder drop of `paths` on the element `testId`, `at` of the way down it, 30px in as editmd's drags */
	drop(testId: string, at: number, paths: string[]): void {
		const native = this.native
		const target = find_test_id(testId)
		const box = target && native?.getElementBounds(target.id)
		if (!box || !native) throw new Error(`no painted ${testId}`)
		const point = { x: box.x + 30, y: box.y + box.height * at }
		/**
		 * a real drag travels over the window before it drops, so the pointer moves there first: without a move
		 * between two drops GPUI delivers only the first (measured headlessly in test.ts)
		 */
		mouse_move(point)
		native.simulateFileDrop(point.x, point.y, paths)
		pump()
	}

	/** a group of checks; an error stops the group only, its reason as a failed check */
	async group(name: string, body: () => Promise<void> | void): Promise<void> {
		try {
			await body()
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error)
			this.check(
				false,
				`${name}: ${reason} (the Document holds ${JSON.stringify(documentController.text.slice(0, 160))})`
			)
		}
	}

	finish(): void {
		rmSync(this.#support, { recursive: true, force: true })
	}
}

/** FILE itself: open, save, type, undo, redo, front matter, revert and a Format command (SelfTest.swift:17-67) */
async function documentBasics(test: SelfTest, url: string): Promise<void> {
	const original = readFileSync(url)
	test.open(url)
	test.check(!documentController.edited, 'a freshly opened document is clean')

	documentController.run('save')
	test.check(
		readFileSync(url).equals(original),
		'saving an untouched document leaves the bytes alone'
	)

	test.typeIntoFirstHeading('Edited ')
	await until('edit reported', () => documentController.edited)
	test.check(documentController.edited, 'typing marks the document edited')

	documentController.run('undo')
	await until('undo reported', () => !documentController.edited)
	test.check(!documentController.edited, 'undoing back to the saved text clears the edited state')

	documentController.run('redo')
	await until('redo reported', () => documentController.edited)
	documentController.run('save')
	const saved = readFileSync(url, 'utf8')
	test.check(saved.includes('# Edited Heading one\n'), 'the edit is saved as markdown')
	test.check(saved.startsWith('---\ntitle: Sample\n'), 'front matter survives the save')
	// editmd's serializer rewrites a table's delimiter row (`| :-: |`); the port saves the source's own bytes
	const tableRows = original
		.toString('utf8')
		.split('\n')
		.filter((line) => line.startsWith('|'))
	test.check(
		saved.includes('- [x] done') &&
			tableRows.length > 0 &&
			tableRows.every((row) => saved.includes(`${row}\n`)),
		'GFM survives the save'
	)
	test.check(!documentController.edited, 'saving clears the edited state')

	await frontmatterUndo(test)

	// editmd reverts to the file it wrote; a clean Document here takes an outside write in as is
	writeAtomically(url, '# Changed on disk\n')
	documentController.run('revert')
	if (documentController.overlay?.kind === 'revert') click_test_id('revert-revert')
	await until('revert rendered', () => documentController.text === '# Changed on disk\n')
	test.check(!documentController.edited, 'revert loads the file from disk')

	// editmd selects all and runs Bold; the port's fields expose no selection (gap G1), so a Block's Format command
	click_test_id('block-0')
	documentController.run('heading2')
	press('escape')
	documentController.run('save')
	test.check(
		readFileSync(url, 'utf8') === '## Changed on disk\n',
		'menu formatting commands apply (Format > Heading 2 on the open Block)'
	)
}

/** Undo in the front matter box takes back its edit, not the body's (SelfTest.swift:487-504) */
async function frontmatterUndo(test: SelfTest): Promise<void> {
	const index = documentController.blocks.findIndex((block) => block.kind === 'frontmatter')
	const frontmatter = () => {
		const block = documentController.blocks[index]
		return block ? documentController.sliceOf(block) : ''
	}
	const before = frontmatter()
	// front matter only counts at the very top, so the body is everything after it
	const body = documentController.text.slice(before.length)
	if (index >= 0) {
		click_test_id(`block-${index}`)
		const field = find_test_id('block-editor')
		if (field) focus(field)
		// typed keys, so the field's own undo has them: to the start of the second line, then `my `
		press('cmd-up')
		press('down')
		for (const key of ['m', 'y', 'space']) typeKeys(key)
		await until('front matter edit reported', () => documentController.edited)
	}
	test.check(
		index >= 0 && frontmatter() === before.replace('---\ntitle', '---\nmy title'),
		'typing in the front matter marks the document edited'
	)
	/**
	 * the field's own undo, which a focused field keeps (ADR-0004): GPUI's text input undoes a word and the space after
	 * it as two steps where WebKit's insertText is one, so Cmd-Z is pressed until the box is back, at most three times.
	 * the body must stay as it was: the earlier, saved heading edit is not taken back
	 */
	let presses = 0
	if (index >= 0) {
		while (frontmatter() !== before && presses < 3) {
			press('cmd-z')
			presses++
		}
		unfocus()
		press('escape')
	}
	const undone = frontmatter()
	test.check(
		index >= 0 && undone === before && documentController.text.slice(before.length) === body,
		`Undo with the front matter focused takes back its edit (${presses} native undo steps)${undone === before ? '' : ` ${JSON.stringify(undone)}`}`
	)
}

/** autosave, and another program editing the file while it is open (SelfTest.swift:90-179) */
async function coEditing(test: SelfTest): Promise<void> {
	const scratch = test.scratch('selftest-coedit')
	try {
		const file = join(scratch, 'coedit.md')
		const onDisk = () => readFileSync(file, 'utf8')
		writeFileSync(file, '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n')
		test.open(file)

		// an agent rewrites the file in place while nothing is unsaved
		writeFileSync(file, '# Title\n\nFirst paragraph.\n\nSecond paragraph, by an agent.\n')
		await until('in-place write shown', () => documentController.text.includes('by an agent'))
		test.check(
			!documentController.edited,
			'a change written in place shows up, and the document stays clean'
		)

		// then replaces it atomically, as most editors and tools do
		writeAtomically(
			file,
			'# Title\n\nFirst paragraph.\n\nSecond paragraph, by an agent.\n\nThird.\n'
		)
		await until('atomic write shown', () => documentController.text.includes('Third.'))
		test.check(!documentController.edited, 'an atomic replacement shows up too')

		// an agent whose hook reports its edit gets the change highlighted as its own
		const hook = {
			session_id: 'selftest',
			cwd: scratch,
			hook_event_name: 'PreToolUse',
			tool_input: { file_path: 'coedit.md' }
		}
		await reportEdit(JSON.stringify(hook), { EDITMD_AGENT_NAME: 'Selftest agent' }, test.sockets)
		await pause(300)
		writeAtomically(
			file,
			'# Title\n\nFirst paragraph.\n\nSecond paragraph, by an agent.\n\nThird, reported.\n'
		)
		await until('reported write shown', () => documentController.text.includes('reported'))
		/**
		 * editmd lists its `.agent-change` runs only and compares them exactly; the port lists every Highlight, each
		 * with the text of the Block it marks, so it checks by substring: the unreported change Outside edit's, the
		 * reported one Selftest agent's. the paragraph the earlier atomic write added keeps its Outside edit mark as
		 * a whole Block too, as editmd's `.agent-block` stays (it is not among editmd's listed runs)
		 */
		const highlighted = documentController.highlights.map(({ author, start, end }) => {
			const slot = documentController.agents.find(({ id }) => id === author.id)?.slot ?? null
			const colour = slot === null ? 'agent-unknown' : `agent-${slot}`
			return `${colour}:${documentController.text.slice(start, end)}`
		})
		const marked = (colour: string, words: string) =>
			highlighted.some((entry) => entry.startsWith(`${colour}:`) && entry.includes(words))
		const legend = documentController.agents.map(({ name }) => name).join('|')
		test.check(
			marked('agent-unknown', ', by an agent') &&
				marked('agent-0', ', reported') &&
				!marked('agent-0', ', by an agent') &&
				legend === 'Selftest agent|Outside edit',
			`a reported edit is highlighted and named, apart from unreported ones (${highlighted.join('|')}; ${legend})`
		)
		await reportEdit(
			JSON.stringify({ ...hook, hook_event_name: 'PostToolUse' }),
			{ EDITMD_AGENT_NAME: 'Selftest agent' },
			test.sockets
		)

		// the user types while the agent edits another paragraph
		test.typeIntoFirstHeading('My ')
		await until('edit reported', () => documentController.edited)
		writeAtomically(
			file,
			'# Title\n\nFirst paragraph, edited.\n\nSecond paragraph, by an agent.\n\nThird.\n'
		)
		const merged =
			'# My Title\n\nFirst paragraph, edited.\n\nSecond paragraph, by an agent.\n\nThird.\n'
		await until('both edits saved', () => onDisk() === merged)
		test.check(onDisk() === merged, "unsaved edits and the agent's edit are merged and autosaved")
		await until(
			'save settled',
			() => !documentController.edited && documentController.label === 'Saved'
		)
		test.check(documentController.label === 'Saved', 'the window says it saved')
		await until('label hidden', () => documentController.label === '')
		test.check(documentController.label === '', 'and the label goes away')

		// two saves at once (Cmd-S during an autosave) take turns
		test.typeIntoFirstHeading('Twice ')
		await until('edit reported', () => documentController.edited)
		documentController.run('save')
		documentController.run('save')
		test.check(
			onDisk().startsWith('# Twice My Title') && !documentController.edited,
			'overlapping saves both succeed'
		)
		documentController.run('undo')
		await until('undo after saves', () => documentController.text.startsWith('# My Title'))
		test.check(documentController.text.startsWith('# My Title'), 'and keep undo history')
		await until('undo saved', () => onDisk().startsWith('# My Title'))

		// a save that fails says so, and the next edit tries again
		let reason: string | null = null
		chmodSync(scratch, 0o555)
		try {
			test.typeIntoFirstHeading('Unsaved ')
			await until('failure shown', () => documentController.label === 'Not Saved')
			reason = documentController.statusDetail
		} finally {
			chmodSync(scratch, 0o755)
		}
		test.check(
			reason !== null && reason !== '',
			`a failed save shows "${documentController.label}" with the reason`
		)
		test.typeIntoFirstHeading('Retried ')
		await until('retry saved', () => onDisk().startsWith('# Retried Unsaved My Title'))
		await until('label cleared', () => ['Saved', ''].includes(documentController.label))
		test.check(onDisk().startsWith('# Retried Unsaved My Title'), 'the next edit saves again')

		// closing with an unsaved edit saves it rather than asking
		test.typeIntoFirstHeading('Closing ')
		await until('edit reported', () => documentController.edited)
		test.windowClosed = false
		documentController.run('close')
		test.check(
			test.windowClosed && onDisk().startsWith('# Closing Retried'),
			'closing saves unsaved edits'
		)
	} finally {
		chmodSync(scratch, 0o755)
		rmSync(scratch, { recursive: true, force: true })
	}
}

/**
 * a stand-in agent: a process named `claude` working in `folder`, as editmd copies its own binary (copies of system
 * ones are killed on launch). the runtime running this, copied; as a bun binary it is the app itself, which waits on a
 * hook payload as editmd's copy does, and as node or bun it waits on its stdin
 */
function standInAgent(folder: string): ChildProcess {
	const executable = join(folder, 'claude')
	copyFileSync(process.execPath, executable)
	chmodSync(executable, 0o755)
	const runtime = basename(process.execPath)
	const args =
		runtime === 'node' || runtime === 'bun' ? ['-e', 'process.stdin.resume()'] : ['--report-edit']
	return spawn(executable, args, { cwd: folder, stdio: ['pipe', 'ignore', 'ignore'] })
}

/** changes nobody reported go to the agent working in the file's folder, under a name the user can change (183-223) */
async function agentProcesses(test: SelfTest): Promise<void> {
	const scratch = test.scratch('selftest-agent')
	let agent: ChildProcess | null = null
	try {
		const file = join(scratch, 'notes.md')
		writeFileSync(file, 'One.\n\nTwo.\n')
		agent = standInAgent(scratch)
		await pause(300)
		test.open(file)
		const legend = () => documentController.agents.map(({ name }) => name).join('|')

		writeAtomically(file, 'One, by the agent.\n\nTwo.\n')
		await until('unreported write shown', () => legend() !== '')
		const guessed = legend()
		test.check(
			guessed === 'Claude · selftest-agent',
			`an unreported change goes to the agent working in its folder (${guessed})`
		)

		const id = documentController.agents[0]?.id
		if (id === undefined) return test.check(false, 'the agent is found again')
		documentController.renameAgent(id, 'Note taker')
		await until('rename shown', () => legend() === 'Note taker')
		writeAtomically(file, 'One, by the agent.\n\nTwo, renamed.\n')
		await until('second write shown', () => documentController.highlights.length === 2)
		const named = legend()
		test.check(
			named === 'Note taker',
			`a renamed agent keeps its name in open windows and later changes (${named})`
		)
	} finally {
		agent?.kill()
		rmSync(scratch, { recursive: true, force: true })
	}
}

/** files in other encodings and line endings, and files that aren't text (SelfTest.swift:225-281) */
async function fileFormats(test: SelfTest, folder: string): Promise<void> {
	const file = join(folder, 'selftest-format.md')
	const image = join(folder, 'selftest-image.png')
	const onDisk = () => readFileSync(file)
	const save = () => {
		documentController.run('save')
		settle()
	}
	try {
		writeFileSync(file, windows1252('# Café\r\n\r\nThé.\r\n'))
		test.open(file)
		save()
		test.check(
			onDisk().equals(windows1252('# Café\r\n\r\nThé.\r\n')),
			'an untouched Windows-1252 file keeps its bytes'
		)
		test.typeIntoFirstHeading('Le ')
		await until('edit reported', () => documentController.edited)
		save()
		test.check(
			onDisk().equals(windows1252('# Le Café\r\n\r\nThé.\r\n')),
			'an edited one stays Windows-1252 with CRLF'
		)
		test.typeIntoFirstHeading('😀 ')
		await until('edit reported', () => documentController.edited)
		save()
		const noticed = documentController.overlay?.kind === 'saveNotice'
		test.check(
			onDisk().equals(Buffer.from('# 😀 Le Café\r\n\r\nThé.\r\n', 'utf8')) && noticed,
			"an edit Windows-1252 can't hold saves as UTF-8, and says so"
		)
		if (noticed) click_test_id('save-notice-ok')
		test.typeIntoFirstHeading('Again ')
		await until('edit reported', () => documentController.edited)
		save()
		test.check(
			onDisk().subarray(0, 12).equals(Buffer.from('# Again 😀', 'utf8')) &&
				documentController.overlay === null,
			'and says so once'
		)

		// UTF-16, mostly CRLF with one LF
		writeFileSync(file, utf16('# Über\r\n\r\nText.\n'))
		test.open(file)
		save()
		test.check(
			onDisk().equals(utf16('# Über\r\n\r\nText.\n')),
			'an untouched UTF-16 file with mixed line endings keeps its bytes'
		)
		// another program changes only the line endings; editmd waits a second after its own save first
		await pause(1000)
		writeAtomically(file, utf16('# Über\n\nText.\n'))
		// a Document the change made dirty would autosave within this pause and rewrite the file
		await pause(1500)
		test.check(
			!documentController.edited && onDisk().equals(utf16('# Über\n\nText.\n')),
			'a change to line endings alone is picked up, and the document stays clean'
		)
		test.typeIntoFirstHeading('New ')
		await until('edit reported', () => documentController.edited)
		save()
		test.check(
			onDisk().equals(utf16('# New Über\n\nText.\n')),
			'an edited UTF-16 file stays UTF-16 with its new line endings'
		)

		// `open -a editmd image.png` refuses rather than showing binary as text
		writeFileSync(
			image,
			Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d)
		)
		const opened = documentController.openAtLaunch(image, test.options)
		settle()
		const overlay = documentController.overlay
		const refusal = overlay?.kind === 'openFailed' ? overlay.title : 'no alert'
		test.check(
			!opened && refusal.endsWith('It contains binary data, not text.'),
			`a binary file is refused: ${refusal}`
		)
		if (overlay?.kind === 'openFailed') click_test_id('open-failed-ok')
	} finally {
		rmSync(file, { force: true })
		rmSync(image, { force: true })
	}
}

/** every way a link leaves the page reaches the link policy as the file or URL it names (SelfTest.swift:348-406) */
async function links(test: SelfTest): Promise<void> {
	const scratch = test.scratch('selftest-links')
	try {
		mkdirSync(join(scratch, 'tools', 'Tool.app', 'Contents', 'MacOS'), { recursive: true })
		const file = join(scratch, 'links.md')
		const hrefs = [
			'tools/Tool.app',
			'other%20notes.md',
			'x.fileloc',
			'https://example.com',
			'tel:+15551234'
		]
		const names = ['app', 'doc', 'loc', 'web', 'tel']
		writeFileSync(
			file,
			`# Links\n\n${names.map((name, n) => `[${name}](${hrefs[n]})`).join(' ')}\n`
		)
		test.open(file)
		test.decisions = []
		for (const href of hrefs) test.cmdClickLink(1, href)
		const root = realpathSync(scratch)
		const expected = [
			`reveal ${root}/tools/Tool.app`,
			`edit ${root}/other notes.md`,
			`reveal ${root}/x.fileloc`,
			'open https://example.com/',
			'ask tel:+15551234'
		]
		test.check(
			JSON.stringify(test.decisions) === JSON.stringify(expected),
			`cmd-clicked links reveal apps and other files, and ask about other schemes (${test.decisions.join(', ')})`
		)

		/**
		 * editmd's links WebKit tries to follow itself (SelfTest.swift:386-395): the page navigates there
		 * (`location.href = …`), not a ⌘-click on a document link, and editmd's navigation delegate decides the URL
		 * through its link policy, an `editmd://file/<path>` URL naming that file. the port's page navigates nowhere, and a
		 * ⌘-click on such a link now does nothing, as editmd's page strips its href (Milkdown's `sanitizeLinkHref`), so the
		 * URL goes through the same policy as editmd's navigation path (`navigate`), the recording opener catching what it
		 * would start
		 */
		for (const [target, expected] of [
			['editmd://file/Applications/Calculator.app', 'reveal /Applications/Calculator.app'],
			['x-custom://do?thing=1', 'ask x-custom://do?thing=1']
		] as const) {
			test.decisions = []
			test.navigate(target)
			test.check(
				JSON.stringify(test.decisions) === JSON.stringify([expected]),
				`following ${target} is caught ([${test.decisions.join(', ')}])`
			)
		}

		// an untitled document has no folder, so relative links lead nowhere
		documentController.load('[app](tools/Tool.app)\n', test.options)
		settle()
		test.decisions = []
		test.cmdClickLink(0, 'tools/Tool.app')
		test.check(
			test.decisions.length === 0 && documentController.activeIndex === null,
			`relative links in an untitled document do nothing ([${test.decisions.join(', ')}])`
		)
	} finally {
		rmSync(scratch, { recursive: true, force: true })
	}
}

/**
 * nothing loads from the network until the window allows remote images, and allowing them loads them in place,
 * keeping edits and undo (SelfTest.swift:420-485). a loopback server counts the requests, as editmd's PixelServer
 */
async function remoteImages(test: SelfTest): Promise<void> {
	const requests: string[] = []
	const server = createServer((request, response) => {
		requests.push(request.url ?? '')
		response.writeHead(200, { 'content-type': 'image/png' }).end(PIXEL)
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	const scratch = test.scratch('selftest-remote')
	try {
		writeFileSync(join(scratch, 'local.png'), PIXEL)
		const file = join(scratch, 'remote.md')
		writeFileSync(file, `# Remote\n\n![pixel](${base}/image.png) and ![local](local.png)\n`)
		test.open(file)
		const localImage = () =>
			find((node) => node.type === 'img' && node.testId?.startsWith('image-') === true) !== null
		await until('local image shown', localImage)
		await pause(300)
		test.check(
			requests.length === 0,
			'a document with remote images loads nothing from the network'
		)
		const blocked = find((node) => node.testId?.startsWith('image-blocked-') === true)
		test.check(textOf(blocked) === 'pixel', 'a blocked image shows its alt text')

		test.typeIntoFirstHeading('Kept ')
		await until('edit reported', () => documentController.edited)
		const offered = () =>
			documentController.paletteEntries.find(({ command }) => command === 'loadRemoteImages')
				?.enabled === true
		test.check(offered(), 'Load Remote Images is offered')
		documentController.run('loadRemoteImages')
		settle()
		/**
		 * GPUI's headless renderer has no HTTP client (measured: an http <img> it painted made no request), so here the
		 * image is checked to carry the remote URL a window fetches; remoteImages.e2e.ts sees the request in a window
		 */
		const remoteSrc = () =>
			find((node) => node.type === 'img' && node.customProps?.src === `${base}/image.png`) !== null
		await until('remote image shown', remoteSrc)
		test.check(
			remoteSrc() && find((node) => node.testId?.startsWith('image-blocked-') === true) === null,
			'Load Remote Images fetches them (the image takes its remote URL)'
		)
		test.check(!offered(), 'and is then done for the window')
		test.check(
			documentController.text.startsWith('# Kept Remote') && documentController.edited,
			'loading them keeps unsaved edits'
		)
		documentController.run('undo')
		await until('undo reported', () => !documentController.edited)
		test.check(documentController.text.startsWith('# Remote'), 'and undo history')
	} finally {
		server.close()
		rmSync(scratch, { recursive: true, force: true })
	}
}

/** image files dropped on a document are linked where they land; text files open in a window of their own (506-599) */
async function droppingFiles(test: SelfTest): Promise<void> {
	const scratch = test.scratch('selftest-drop')
	try {
		mkdirSync(join(scratch, 'images'))
		const image = join(scratch, 'images', 'my pic.png')
		writeFileSync(image, encodePng({ width: 2, height: 2, data: new Uint8Array(16) }))
		const note = join(scratch, 'note.md')
		writeFileSync(note, '# Note\n')
		const file = join(scratch, 'drop.md')
		writeFileSync(file, '# Title\n\nFirst.\n\nSecond.\n')
		test.open(file)
		const imageShown = () =>
			find_all((node) => node.type === 'img' && node.testId?.startsWith('image-') === true).length >
			0

		// the drop lands at the top of the second paragraph, so the image goes in before it
		test.windows = []
		test.drop('block-2', 0.1, [image, note])
		await until('image shown', imageShown)
		test.check(imageShown(), 'a dropped image shows in the document')
		documentController.run('save')
		const saved = readFileSync(file, 'utf8')
		test.check(
			saved === '# Title\n\nFirst.\n\n![my pic](images/my%20pic.png)\n\nSecond.\n',
			'and is saved as a relative link where it was dropped'
		)
		// its window starts once the other windows said none of them has the file (`focusWindowFor`)
		await until('the dropped file’s window', () => test.windows.includes(note)).catch(() => {})
		test.check(test.windows.includes(note), 'a dropped markdown file opens in editmd')

		// a drop on a code block goes next to it rather than splitting it
		const code = join(scratch, 'code.md')
		writeFileSync(code, '# T\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\nAfter.\n')
		test.open(code)
		test.drop('block-1', 0.5, [image])
		await until('image beside code', () => documentController.text.includes('![my pic]'))
		test.check(
			documentController.text ===
				'# T\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\n![my pic](images/my%20pic.png)\n\nAfter.\n',
			'an image dropped on a code block goes after it, leaving the code whole'
		)

		// in Source mode the field has no caret to drop at (gap G1): the image goes after the last Block
		press('cmd-/')
		const field = find_test_id('source-editor')
		if (!field) throw new Error('no source field')
		dispatch({
			elementId: field.id,
			eventType: 'change',
			value: `${documentController.activeSource}More.`
		})
		settle()
		test.drop('source-editor', 0.1, [image])
		await until('image in source', () =>
			documentController.text.endsWith('![my pic](images/my%20pic.png)')
		)
		test.check(
			documentController.text.endsWith('After.\nMore.\n\n![my pic](images/my%20pic.png)'),
			'an image dropped in the source view goes in after the last Block, the typing kept'
		)
		press('cmd-/')

		// an untitled document has no folder to be relative to
		documentController.load('', test.options)
		settle()
		test.drop('empty-hint', 0.5, [image])
		await until('image shown untitled', imageShown)
		test.check(
			documentController.text.includes(`![my pic](${image.replaceAll(' ', '%20')})`) &&
				imageShown(),
			'an untitled document links an absolute path, and shows the image'
		)
	} finally {
		rmSync(scratch, { recursive: true, force: true })
	}
}

/** `open -a editmd FILE` works for any text file, not just .md (SelfTest.swift:77-86) */
function anyTextFile(test: SelfTest, folder: string): void {
	for (const name of ['selftest-notes.txt', 'selftest-README', 'selftest-page.markdown']) {
		const file = join(folder, name)
		try {
			writeFileSync(file, 'plain *text*\n')
			const opened = documentController.openAtLaunch(file, test.options)
			test.check(opened && documentController.text === 'plain *text*\n', `opens ${name}`)
		} finally {
			rmSync(file, { force: true })
		}
	}
}

/**
 * runs every group on FILE and its folder, printing each check; resolves whether all passed. FILE is overwritten,
 * so it must be a scratch copy
 */
export async function selfTest(url: string, print: SelfTestOutput): Promise<boolean> {
	const test = new SelfTest(url, print)
	const theme = new ThemeController({
		readAppearance: () => 'light',
		initialAppearance: () => 'light'
	})
	documentController.load('', test.options)
	const page = mount_headless(HeadlessPage, {
		width: 860,
		height: MAX_HEADLESS_HEIGHT,
		props: { theme }
	})
	test.native = page.native
	const folder = dirname(url)
	try {
		await test.group('document', () => documentBasics(test, url))
		await test.group('coEditing', () => coEditing(test))
		await test.group('agentProcesses', () => agentProcesses(test))
		await test.group('fileFormats', () => fileFormats(test, folder))
		await test.group('links', () => links(test))
		await test.group('remoteImages', () => remoteImages(test))
		await test.group('droppingFiles', () => droppingFiles(test))
		await test.group('files', () => anyTextFile(test, folder))
	} finally {
		documentController.load('', test.options)
		await page.unmount()
		test.finish()
	}
	return test.failures === 0
}
