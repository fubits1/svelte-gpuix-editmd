// headless UI suite through gpuix-svelte/test (real GPUI hit testing); `finish` must equal the number of checks run
import {
	all_text,
	bounds,
	check,
	click_at,
	click_test_id,
	drag_select,
	drop_files,
	find,
	find_all,
	find_test_id,
	finish,
	focus,
	key_up,
	mount_headless,
	mouse_move,
	painted,
	painted_highlights,
	press,
	pump,
	screenshot,
	settle,
	type,
	type TreeNode,
	unfocus,
	wait,
	wait_for,
	wheel
} from 'gpuix-svelte/test'
import { dispatch, get_native } from 'gpuix-svelte'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
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
import { pathToFileURL } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import App from './App.svelte'
import { diagramOf } from './src/app/diagrams.ts'
import { findController } from './src/app/find.svelte.ts'
import { type MenuBarItem, type MenuBarMenu, menuBar } from './src/app/menu.ts'
import { mermaidPaletteFor, paletteFor, textThemeFor } from './src/app/palette.ts'
import { reportEdit } from './src/app/reportEdit.ts'
import { ThemeController, themeController } from './src/app/theme.svelte.ts'
import { zoomOut } from './src/app/zoom.ts'
import { TABLE } from './src/core/blockCommands.ts'
import { labelDetail } from './src/core/persistence.ts'
import { type Appearance, systemAppearance } from './src/host/appearance.ts'
import { LegendPreference } from './src/host/legendPreference.ts'
import { type AgentRename, greetPeers, listenForReports, sendRename } from './src/host/agentIpc.ts'
import { decodePng, type Pixels } from './src/host/png.ts'
import { printablePage } from './src/host/print.ts'
import { RecentFiles } from './src/host/recent.ts'
import DocumentView from './src/ui/DocumentView.svelte'
import { diagramImageSrc } from './src/ui/DocumentView/Views/diagramImage.svelte.ts'
import {
	DocumentController,
	documentController,
	NEW_WINDOW_ENV,
	openEditorWindow
} from './src/ui/DocumentView/controller.svelte.ts'
import type { Range } from './src/core/fieldSelection.ts'
import { monoLinesSource } from './src/app/monoLines.ts'
import { deletionTooltip, highlightTooltip } from './src/app/highlightTooltip.ts'

documentController.load('# Title\n\nBody text with **bold**.\n')
// App starts the theme for a window; mounted alone, the view needs the same tokens set before its first paint
const stopTheme = themeController.start()
const view = mount_headless(DocumentView, { width: 800, height: 538 })

const text = painted()
check('each block is painted', text.includes('Title') && text.includes('Body text with bold.'))

// GPUI elements have no accessible roles to query by, so blocks and the editor carry test ids
click_test_id('block-1')
check(
	'clicking a block opens its source in a text field',
	[find_test_id('block-editor')?.type, propOf('block-editor', 'value')],
	['textarea', 'Body text with **bold**.']
)

// `type` takes keystroke notation: one key per call keeps the text literal
type('a')
check(
	'typing goes into the document',
	documentController.text,
	'# Title\n\nBody text with **bold**.a\n'
)

press('escape')
check('escape closes the field', find_test_id('block-editor'), null)
check('the block paints its new text', painted().includes('Body text with bold.a'))

click_test_id('block-0')
check('clicking another block opens that one', documentController.activeIndex, 0)
press('escape')

// markdown typed into a field is markdown: the Document keeps the syntax, the Block paints it rendered
click_test_id('block-1')
for (const key of ['space', '*', '*', 'b', '*', '*']) type(key)
press('escape')
check(
	'typing `**b**` at the end of a paragraph’s field puts it in the Document, and the Block paints `b` without asterisks',
	[
		documentController.text,
		painted()
			.split('\n')
			.filter((line) => line.startsWith('Body'))
	],
	['# Title\n\nBody text with **bold**.a **b**\n', ['Body text with bold.a b']]
)

// block syntax too: `## ` typed at the start of the paragraph's field turns its Block into a heading
click_test_id('block-1')
press('cmd-left')
for (const key of ['#', '#', 'space']) type(key)
press('escape')
check(
	'typing `##` and a space at the start of a paragraph’s field makes its Block a level-2 heading, painted without the hashes',
	[
		documentController.text,
		documentController.blocks[1]?.kind,
		painted()
			.split('\n')
			.filter((line) => line.includes('Body'))
	],
	['# Title\n\n## Body text with **bold**.a **b**\n', 'heading', ['Body text with bold.a b']]
)

/**
 * editmd's input rules (e-input-rules) as plain markdown typed at the start of a paragraph's field: `- ` makes a list,
 * `> ` a quote and a ``` fence a code block, each painted rendered once the field closes
 */
const shortcutCases: [string[], string, string, string][] = [
	[['-', 'space'], '- Typed words\n', 'list', 'Typed words'],
	[['>', 'space'], '> Typed words\n', 'blockquote', 'Typed words'],
	[['`', '`', '`', 'enter'], '```\nTyped words\n', 'code', 'Typed words']
]
const shortcutResults = shortcutCases.map(([keys]) => {
	documentController.load('Typed words\n')
	settle()
	click_test_id('block-0')
	press('cmd-left')
	for (const key of keys) type(key)
	press('escape')
	settle()
	const lines = painted().split('\n')
	return [
		documentController.text,
		documentController.blocks[0]?.kind,
		lines.find((line) => line.includes('Typed words')),
		lines.some((line) => /^(- |> |```)/.test(line))
	]
})
check(
	'typing `- `, `> ` or a ``` fence at the start of a paragraph’s field makes a list, a quote or a code block, painted without the syntax',
	shortcutResults,
	shortcutCases.map(([, text, kind, line]) => [text, kind, line, false])
)

const directory = mkdtempSync(join(tmpdir(), 'editmd-gpuix-ui-'))
const path = join(directory, 'notes.md')
writeFileSync(path, '# Notes\r\n\r\nfirst line\r\n')

// its own sockets folder, so the test never listens where real editors do
documentController.open(path, { socketsDirectory: join(directory, 's') })
settle()
check('an opened file is painted', painted().includes('first line'))

click_test_id('block-1')
type('z')
const keyAt = Date.now()
await wait(700)
const beforeIdle = readFileSync(path, 'utf8')
// the moment the save lands, polled every 25ms, so the label's samples below are timed from it
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
press('escape')

rmSync(directory, { recursive: true, force: true })

documentController.load(
	'See the [docs] and [the log][log].\n\n[docs]: https://example.com/docs\n[log]: https://example.com/log\n'
)
settle()
const references = painted()
check(
	'reference links resolve against definitions in other blocks',
	references.includes('See the docs and the log.')
)
// editmd shows a definition as its source line, so it stays visible and clickable
check(
	'definition blocks paint their source line',
	references.includes('[docs]: https://example.com/docs')
)

documentController.load('- [ ] todo **soon**\n- [x] done\n  - [ ] nested\n')
settle()
/**
 * where a task row puts its box and text against the list's left edge, in centres (GPUI's `bounds` gives a bordered
 * box inside its border): `ul { padding-left: 1.75em }` puts the text 28px in per level, and the box
 * (`left: -1.55em; top: 0.3em`, 1em square) 24.8px before it, its centre 11.2px in; vertically 13.5px below the row's
 * top, the 4.8px of `top` plus the 0.7px GPUI sets its text lower in the line than WebKit (r-tasks shots: box centre
 * 0.25px above the text's ink centre in editmd)
 */
function taskGeometry(mark: number, contentStart: number): number[] {
	const list = bounds(find_test_id('task-list-0') ?? 0)
	const box = bounds(find_test_id(`task-${mark}`) ?? 0)
	const row = bounds(find_test_id(`task-row-${contentStart}`) ?? 0)
	const text = bounds(find_test_id(`task-text-${contentStart}`) ?? 0)
	if (!list || !box || !row || !text) return []
	const round = (value: number) => Math.round(value * 10) / 10
	return [
		round(box.x + box.width / 2 - list.x),
		round(text.x - list.x),
		round(box.y + box.height / 2 - row.y)
	]
}
check(
	'a task’s box centre sits 11.2px into the list and its text 28px, a nested one 28px further, the box centre 13.5px below the row top',
	// GPUI lays out on the half-pixel grid, so 11.2 paints at 11
	[nearly(taskGeometry(3, 6), [11.2, 28, 13.5]), nearly(taskGeometry(36, 39), [39.2, 56, 13.5])],
	[
		[11.2, 28, 13.5],
		[39.2, 56, 13.5]
	]
)
check('task lists paint no literal brackets', painted().includes('[ ]'), false)
check('task text keeps its inline formatting', painted().includes('todo soon'))

click_test_id('task-3')
check(
	'clicking a checkbox ticks the task in the source',
	documentController.text,
	'- [x] todo **soon**\n- [x] done\n  - [ ] nested\n'
)
check('ticking does not open the block for editing', documentController.activeIndex, null)
click_test_id('task-3')
check(
	'clicking a ticked checkbox unticks the task in the source',
	documentController.text,
	'- [ ] todo **soon**\n- [x] done\n  - [ ] nested\n'
)
// editmd ticks a task on a click anywhere in the gutter left of its text (editor.ts:414-416), not only on the box
const taskBox = bounds(find_test_id('task-3') ?? 0)
if (taskBox) click_at(taskBox.x - 3, taskBox.y + taskBox.height / 2)
check(
	`a click in the gutter left of the checkbox, not on it, ticks the task in the source (at x ${taskBox ? taskBox.x - 3 : 'none'})`,
	[documentController.text, documentController.activeIndex],
	['- [x] todo **soon**\n- [x] done\n  - [ ] nested\n', null]
)
click_test_id('task-3')

/**
 * a plain list as editmd's browser lays it out (style.css:230-240, r-lists shots): text 28px in per level, a muted
 * marker centred 14.5px before the text and 14px below the row's top, a filled disc at the top level and a hollow
 * circle below it, rows 26.4px tall and 3.2px apart; numbers count on from the first as an `ol` does, right-aligned
 * one space (4.4px) before the text, whatever the source wrote after the first
 */
documentController.load(
	'* star **bullet**\n* another\n  * nested\n  * nested two\n\n3. one\n3. two\n'
)
settle()
/** a plain list row's geometry against its list: text x, marker centre x from the text, marker centre y, row top */
function listRow(list: number, contentStart: number) {
	const listBox = bounds(find_test_id(`list-${list}`) ?? 0)
	const text = bounds(find_test_id(`list-text-${contentStart}`) ?? 0)
	const marker = bounds(find_test_id(`list-marker-${contentStart}`) ?? 0)
	const row = bounds(find_test_id(`list-row-${contentStart}`) ?? 0)
	if (!listBox || !text || !marker || !row) return null
	const round = (value: number) => Math.round(value * 10) / 10
	return {
		text: round(text.x - listBox.x),
		markerX: round(marker.x + marker.width / 2 - text.x),
		markerY: round(marker.y + marker.height / 2 - row.y),
		top: round(row.y - listBox.y)
	}
}
// where each item's text starts in the source
const bulletStarts = [2, 20, 32, 43]
const bulletRows = bulletStarts.map((start) => listRow(0, start))
const discStyle = find_test_id('list-marker-2')?.style
const circleStyle = find_test_id('list-marker-32')?.style
const numberRows = [58, 65].map((start) => listRow(1, start))
const numberMarker = bounds(find_test_id('list-marker-58') ?? 0)
const numberText = bounds(find_test_id('list-text-58') ?? 0)
check(
	'a plain list paints rows of muted markers beside native text: discs then hollow circles, 28px a level, 29.6px apart, numbers as an ol counts them',
	[
		bulletRows.map((row) => row && [row.text, row.markerX, row.markerY]),
		nearly(
			bulletRows.map((row) => row?.top ?? Number.NaN),
			[0, 29.6, 59.2, 88.8]
		),
		[discStyle?.backgroundColor, discStyle?.borderWidth ?? 0],
		[circleStyle?.backgroundColor ?? null, circleStyle?.borderWidth, circleStyle?.borderColor],
		[textOf('list-marker-58'), textOf('list-marker-65')],
		numberRows.map((row) => row?.text),
		// on GPUI's half-pixel grid
		numberMarker && numberText
			? nearly([numberMarker.x + numberMarker.width - numberText.x], [-4.4])[0]
			: null,
		painted().includes('star bullet')
	],
	[
		[
			[28, -14.5, 14],
			[28, -14.5, 14],
			[56, -14.5, 14],
			[56, -14.5, 14]
		],
		[0, 29.6, 59.2, 88.8],
		[themeController.palette.muted, 0],
		[null, 1, themeController.palette.muted],
		['3.', '4.'],
		[28, 28],
		-4.4,
		true
	]
)

documentController.load('---\ntitle: A\ntags: [x]\n---\n\nBody.\n')
settle()
check(
	'front matter shows verbatim in its own box, fences included',
	// painted by native <markdown> as one code span per line (`monoLinesSource`)
	propOf('frontmatter-0', 'source'),
	monoLinesSource('---\ntitle: A\ntags: [x]\n---')
)

// agent attribution end to end: hook Report -> Claim -> outside write -> Disk merge -> Agent highlight + legend
const agentDirectory = mkdtempSync(join(tmpdir(), 'eg-agent-'))
const sockets = join(agentDirectory, 's')
const agentPath = join(agentDirectory, 'plan.md')
writeFileSync(agentPath, '# Plan\n\nfirst\n\nsecond\n')
// the legend reads whether it was minimized from this test's store, never the real one
documentController.open(agentPath, {
	socketsDirectory: sockets,
	legendPreference: new LegendPreference(join(agentDirectory, 'legend.json'))
})
await wait(100)

await reportEdit(
	JSON.stringify({
		session_id: 'abc',
		cwd: agentDirectory,
		hook_event_name: 'PreToolUse',
		tool_input: { file_path: agentPath }
	}),
	{},
	sockets
)
writeFileSync(agentPath, '# Plan\n\nfirst\n\nsecond, rewritten by the agent\n')
await wait_for(() => documentController.highlights.length > 0, { label: 'agent highlight' })

const agentName = `Claude · ${basename(agentDirectory)}`
check(
	'the merged block is credited to the reporting agent',
	documentController.highlights[0]?.author.name,
	agentName
)
check('the legend lists the agent', all_text().includes(agentName))

// a second Agent's change after the first's: each keeps the colour slot it got at first sight
await reportEdit(
	JSON.stringify({
		session_id: 'def',
		cwd: agentDirectory,
		hook_event_name: 'PreToolUse',
		tool_input: { file_path: agentPath }
	}),
	{ EDITMD_AGENT_NAME: 'Codex' },
	sockets
)
writeFileSync(agentPath, '# Plan\n\nfirst\n\nsecond, rewritten by the agent\n\nthird, by codex\n')
await wait_for(() => documentController.agents.length === 2, { label: 'second agent highlight' })
settle()
const secondAgentStyle = JSON.stringify(find_test_id('block-3')?.style)

/**
 * editmd's `.agent-block` (style.css:474-479) paints its tint and bar as box-shadows, which move nothing: the tint
 * shadow over the agent one leaves an 8px bar in the agent colour, no corner radius, and the text stays where a plain
 * Block's is
 */
/**
 * (GPUI's `bounds` reports a box with padding and a border moved in by them, so the box is read from its style; a
 * screenshot measured its tint from x 64 to 728, the column's 72 less 8, to its right edge)
 */
const plainTextBox = bounds(find_test_id('block-1')?.children?.[0] ?? 0)
const tintedTextBox = bounds(find_test_id('block-3')?.children?.[0] ?? 0)
const tintedStyle = find_test_id('block-3')?.style
check(
	'an Agent’s Block reaches 8px left of its edge in an 8px bar, square, its text where a plain Block’s is, as wide',
	[
		tintedStyle?.marginLeft,
		tintedStyle?.borderLeftWidth,
		tintedStyle?.paddingLeft,
		tintedStyle?.borderTopLeftRadius ?? tintedStyle?.borderRadius ?? 0,
		tintedTextBox && plainTextBox ? tintedTextBox.x - plainTextBox.x : null,
		tintedTextBox && plainTextBox ? tintedTextBox.width - plainTextBox.width : null
	],
	[-8, 8, 0, 0, 0, 0]
)

documentController.clearHighlights('abc')
settle()
check(
	'clearing one Agent leaves the other’s block in its colour',
	JSON.stringify(find_test_id('block-3')?.style),
	secondAgentStyle
)
check(
	'the remaining Agent keeps its colour slot in the legend',
	documentController.agents.map(({ slot }) => slot).join(','),
	'1'
)

documentController.clearHighlights()
settle()
check('clearing removes the legend', all_text().includes(agentName), false)

rmSync(agentDirectory, { recursive: true, force: true })

/**
 * editmd keeps the names given to Agents for the app's life (AgentEdits.swift:18-19,35), so a window opened after a
 * rename in another one still names that Agent: on opening, this window greets the others (`greetPeers`), and the
 * name an older window knows comes back as a rename, which names the Agent's first change here
 */
const greetDirectory = mkdtempSync(join(tmpdir(), 'eg-greet-'))
const greetSockets = join(greetDirectory, 's')
const greetPath = join(greetDirectory, 'greet.md')
writeFileSync(greetPath, '# Greet\n\nfirst\n')
const olderWindow = await listenForReports(
	greetSockets,
	() => {},
	() => {},
	() => [{ id: 'greet-session', name: 'Named elsewhere' }]
)
documentController.open(greetPath, {
	socketsDirectory: greetSockets,
	listAgentProcesses: () => [],
	legendPreference: new LegendPreference(join(greetDirectory, 'legend.json'))
})
await wait(300)
await reportEdit(
	JSON.stringify({
		session_id: 'greet-session',
		cwd: greetDirectory,
		hook_event_name: 'PreToolUse',
		tool_input: { file_path: greetPath }
	}),
	{},
	greetSockets
)
writeFileSync(greetPath, '# Greet\n\nfirst, by the agent\n')
await waitUntil(() => documentController.agents.length > 0, 'the greeted agent’s highlight')
await olderWindow()
check(
	'a window opened after a rename in another asks the others for the names they know, and the Agent’s first change here shows that name',
	documentController.agents.map(({ name }) => name),
	['Named elsewhere']
)
documentController.load('')
rmSync(greetDirectory, { recursive: true, force: true })

documentController.load(
	'```mermaid\nflowchart LR\n  A --> B\n```\n\n```mermaid\nflowchart LR\n  A -->\n```\n'
)
settle()
check('a mermaid fence paints as a diagram image', find_test_id('mermaid-0')?.type, 'img')
check(
	'a broken diagram shows its error instead of an image',
	find_test_id('mermaid-error-1')?.type,
	'markdown'
)

/**
 * the `src` a diagram drawn from `source` in `palette` paints with: its SVG as a base64 data: URL, null when it
 * cannot be drawn
 */
function diagramSrcOf(source: string, palette = themeController.mermaidPalette): string | null {
	const diagram = diagramOf(source, palette)
	if (diagram.kind !== 'diagram') return null
	return diagramImageSrc(diagram)
}
const firstFenceSrc = propOf('mermaid-0', 'src')
const brokenDiagram = diagramOf('flowchart LR\n  A -->', themeController.mermaidPalette)
check(
	'the error paints diagramOf’s message for that source, in the palette’s danger colour',
	[
		brokenDiagram.kind,
		brokenDiagram.kind === 'error' && brokenDiagram.message.length > 0,
		propOf('mermaid-error-1', 'source'),
		monoLook('mermaid-error-1')[0]
	],
	[
		'error',
		true,
		brokenDiagram.kind === 'error' ? monoLinesSource(brokenDiagram.message) : null,
		themeController.palette.danger
	]
)
documentController.load('```mermaid\nflowchart LR\n  C --> D\n```\n')
settle()
check(
	'a diagram’s image src is its own source drawn as SVG, so another fence paints another src',
	[
		firstFenceSrc,
		propOf('mermaid-0', 'src'),
		typeof firstFenceSrc === 'string' && firstFenceSrc !== propOf('mermaid-0', 'src')
	],
	[diagramSrcOf('flowchart LR\n  A --> B'), diagramSrcOf('flowchart LR\n  C --> D'), true]
)

/**
 * editmd redraws a diagram whose source changed 300ms after the change, its first draw only at once (diagrams.ts:141-143):
 * an outside write to a drawn diagram keeps the old drawing at first, and shows the new one after the pause
 */
const mermaidDirectory = mkdtempSync(join(tmpdir(), 'eg-mermaid-'))
const mermaidPath = join(mermaidDirectory, 'diagram.md')
writeFileSync(mermaidPath, '# Diagram\n\n```mermaid\nflowchart LR\n  A --> B\n```\n')
documentController.open(mermaidPath, {
	socketsDirectory: join(mermaidDirectory, 's'),
	listAgentProcesses: () => [],
	legendPreference: new LegendPreference(join(mermaidDirectory, 'legend.json'))
})
settle()
const drawnBefore = propOf('mermaid-1', 'src')
writeFileSync(mermaidPath, '# Diagram\n\n```mermaid\nflowchart LR\n  A --> C\n```\n')
await waitUntil(
	() => documentController.text.includes('A --> C'),
	'the outside change to the diagram'
)
settle()
const drawnAtOnce = propOf('mermaid-1', 'src')
await wait(450)
settle()
check(
	'an outside change to a drawn diagram keeps the old drawing at first and shows the new one 300ms later',
	[
		drawnBefore === diagramSrcOf('flowchart LR\n  A --> B'),
		drawnAtOnce === drawnBefore,
		propOf('mermaid-1', 'src')
	],
	[true, true, diagramSrcOf('flowchart LR\n  A --> C')]
)
documentController.load('')
rmSync(mermaidDirectory, { recursive: true, force: true })

/** a native element's prop (e.g. an <img>'s src): the tree JSON carries them as `customProps`, typed in gpuix-test.d.ts */
function propOf(testId: string, name: string) {
	return find_test_id(testId)?.customProps?.[name]
}

/** what a <markdown> of mono lines paints its code spans in (`monoLinesTheme`): colour, text size and line height */
function monoLook(testId: string) {
	const theme = propOf(testId, 'theme')
	const metrics = fieldOf(theme, 'metrics')
	return [
		fieldOf(theme, 'codeText'),
		fieldOf(metrics, 'mdTextSize'),
		fieldOf(metrics, 'mdLineHeight')
	]
}

/** one PNG chunk: length, type, data and the CRC over type and data */
function pngChunk(chunkType: string, data: Uint8Array): Buffer {
	const typeAndData = Buffer.concat([Buffer.from(chunkType, 'latin1'), data])
	const chunk = Buffer.alloc(typeAndData.length + 8)
	chunk.writeUInt32BE(data.length, 0)
	typeAndData.copy(chunk, 4)
	chunk.writeUInt32BE(crc32(typeAndData), typeAndData.length + 4)
	return chunk
}

/** a real, decodable black PNG, so GPUI paints and hit-tests it as it would a user's image */
function png(width: number, height: number): Buffer {
	const header = Buffer.alloc(13)
	header.writeUInt32BE(width, 0)
	header.writeUInt32BE(height, 4)
	// 8-bit RGB, default compression, filter and interlace
	header.set([8, 2, 0, 0, 0], 8)
	// each row is a filter byte (0, none) and three zero bytes per pixel
	const pixels = deflateSync(Buffer.alloc(height * (1 + width * 3)))
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk('IHDR', header),
		pngChunk('IDAT', pixels),
		pngChunk('IEND', new Uint8Array())
	])
}

// images: local ones paint as <img> resolved against the document's folder; remote ones are blocked until allowed
const imageDirectory = mkdtempSync(join(tmpdir(), 'eg-images-'))
const imagePath = join(imageDirectory, 'with-images.md')
writeFileSync(join(imageDirectory, 'pic.png'), png(300, 200))
writeFileSync(join(imageDirectory, 'wide.png'), png(1600, 800))
writeFileSync(
	imagePath,
	'![local](pic.png) ![wide](wide.png)\n\n![tracker](https://example.com/p.png)\n'
)
documentController.open(imagePath, { socketsDirectory: join(imageDirectory, 's') })
settle()
check('a local image paints as an image', find_test_id('image-0-0')?.type, 'img')
// the view measures its column after the first paint, on a 250ms poll
await wait(300)
settle()
const naturalBounds = bounds(find_test_id('image-0-0') ?? 0)
check(
	'a local image paints at its natural size',
	`${naturalBounds?.width}x${naturalBounds?.height}`,
	'300x200'
)
// editmd's page zoom grows images with the text: 1.1 times the natural size at Cmd-=
press('cmd-=')
await wait(300)
settle()
const zoomedImageBounds = bounds(find_test_id('image-0-0') ?? 0)
press('cmd-0')
await wait(300)
settle()
check(
	'Cmd-= grows a local image by 1.1, as editmd’s page zoom does',
	`${zoomedImageBounds?.width}x${zoomedImageBounds?.height}`,
	'330x220'
)
// the 800px test window holds editmd's whole 736px column, which less its 40px padding either side is 656px wide
const wideBounds = bounds(find_test_id('image-0-1') ?? 0)
check(
	'a wider image scales down to the column, keeping its aspect ratio',
	`${wideBounds?.width}x${wideBounds?.height}`,
	'656x328'
)

click_test_id('image-0-0')
check(
	'clicking an image opens its paragraph’s source in a text field',
	find_test_id('block-editor')?.type,
	'textarea'
)
check('the image paragraph is the Active block', documentController.activeIndex, 0)
press('escape')
check(
	'its source resolves against the document folder',
	propOf('image-0-0', 'src'),
	join(imageDirectory, 'pic.png')
)
check(
	'a remote image is blocked: its alt text shows instead',
	find_test_id('image-blocked-1-0')?.children?.[0]?.text,
	'tracker'
)

documentController.allowRemoteImages()
settle()
check(
	'after Load Remote Images the remote image paints',
	propOf('image-1-0', 'src'),
	'https://example.com/p.png'
)
check(
	'an image of unknown size keeps the fixed box',
	bounds(find_test_id('image-1-0') ?? 0)?.height,
	240
)
rmSync(imageDirectory, { recursive: true, force: true })

// footnotes: native <markdown> paints `[^1]` literally, so each reference paints as a bracketed link run
documentController.load('Text[^1] here.\n\n- [ ] task[^2]\n\n[^1]: First note.\n[^2]: Second.\n')
settle()
const footnoteLines = painted().split('\n')
check(
	'a footnote reference paints as its bracketed label',
	footnoteLines.filter((line) => line.startsWith('Text')),
	['Text[1] here.']
)
check(
	'a footnote reference in a task item paints as its bracketed label',
	footnoteLines.filter((line) => line.startsWith('task')),
	['task[2]']
)
check(
	'no footnote reference paints literally outside the definitions',
	footnoteLines.filter(
		(line) => line.includes('[^') && !line.startsWith('[^1]:') && !line.startsWith('[^2]:')
	),
	[]
)

// a footnote definition is a labelled block, as editmd's `dl[data-type="footnote_definition"]`
check(
	'each footnote definition paints its bare label',
	[2, 3].map((index) => find_test_id(`footnote-label-${index}`)?.children?.[0]?.text),
	['1', '2']
)
check(
	'a footnote definition paints its content as markdown',
	footnoteLines.filter((line) => line.includes('note.') || line.includes('Second.')),
	['First note.', 'Second.']
)
check(
	'no footnote reference or definition paints literally',
	footnoteLines.filter((line) => line.includes('[^')),
	[]
)
click_test_id('footnote-2')
check(
	'clicking a footnote definition opens its source for editing',
	[documentController.activeIndex, find_test_id('block-editor')?.type],
	[2, 'textarea']
)

// native <markdown> and <textarea> ignore CSS variables, so editmd's text theme goes in through `theme`
const textTheme = textThemeFor(systemAppearance())
check('the block editor paints in editmd’s text theme', propOf('block-editor', 'theme'), textTheme)
press('escape')
check(
	'a block’s native markdown paints in editmd’s text theme',
	find((node) => node.type === 'markdown')?.customProps?.theme,
	textTheme
)

// shortcuts arrive through `on_window_key`, which fires headlessly with GPUI's key name and modifiers
documentController.load('# Title\n\nBody\n')
settle()
click_test_id('block-0')
press('cmd-alt-2')
check(
	'Cmd-Alt-2 makes the Active block a level-2 heading',
	documentController.text,
	'## Title\n\nBody\n'
)
check('the field shows the new heading source', propOf('block-editor', 'value'), '## Title')
press('escape')

click_test_id('block-1')
press('cmd-shift-8')
check(
	'Cmd-Shift-8 makes the Active paragraph a bullet list',
	documentController.text,
	'## Title\n\n- Body\n'
)
press('escape')

/**
 * editmd's caret sits at the Document's start once it loads, so a Format command with no Active block acts on the
 * first Block (measured in editmd's own editor: Heading 2 at load turns the first paragraph into `## …`): its field
 * opens on the result. a Document just loaded, since once a field has closed the caret stays where it was
 */
documentController.load('## Title\n\n- Body\n')
settle()
press('cmd-alt-1')
check(
	'a Format command with no Active block opens the first Block and acts on it',
	[documentController.text, documentController.activeIndex, propOf('block-editor', 'value')],
	['# Title\n\n- Body\n', 0, '# Title']
)
press('escape')

/**
 * Bulleted List in a list is a command editmd refuses (formatBlock returns null): nothing at all happens, so the
 * field is not remounted (same node, its caret still after the typed `- `, where `z` lands) and the Document keeps
 * the typing
 */
click_test_id('block-1')
press('cmd-left')
type('-')
type('space')
const refusedFieldId = find_test_id('block-editor')?.id
press('cmd-shift-8')
type('z')
check(
	'a Format command editmd refuses changes nothing: the same field keeps its typing, the Document only gains the typing',
	[find_test_id('block-editor')?.id === refusedFieldId, documentController.text],
	[true, '# Title\n\n- z- Body\n']
)
press('escape')

// the field opens on `# Title`; Heading 2 then Heading 1 writes back what it opened with, which must still reset it
documentController.load('# Title\n')
settle()
click_test_id('block-0')
press('cmd-alt-2')
press('cmd-alt-1')
type('z')
check(
	'a Format command resets the field even to the source it opened with',
	documentController.text,
	'# Titlez\n'
)
press('escape')
documentController.load('## Title\n\n- Body\n')
settle()

/**
 * every other Format key, each on an open Block of its own: the key, how editmd's menu names it, the Block's
 * source before and after (editmd MainMenu.swift; the transforms are `BLOCK_TRANSFORMS`)
 */
const formatKeys: [string, string, string, string][] = [
	['cmd-alt-0', 'Body', '## Title', 'Title'],
	['cmd-alt-1', 'Heading 1', 'Title', '# Title'],
	['cmd-alt-3', 'Heading 3', 'Title', '### Title'],
	['cmd-alt-4', 'Heading 4', 'Title', '#### Title'],
	['cmd-alt-5', 'Heading 5', 'Title', '##### Title'],
	['cmd-alt-6', 'Heading 6', 'Title', '###### Title'],
	['cmd-shift-7', 'Numbered List', 'one', '1. one'],
	// editmd sinks an item only under a sibling before it, so the first item stays where it is
	['cmd-]', 'Indent', '- one\n- two', '- one\n  - two'],
	// a list's Block starts at its first marker, so the indented item is a nested one
	['cmd-[', 'Outdent', '- one\n  - two', '- one\n- two'],
	['cmd-shift-b', 'Quote', 'one', '> one'],
	['cmd-alt-c', 'Code Block', 'x', '```\nx\n```']
]
for (const [key, title, before, after] of formatKeys) {
	documentController.load(`${before}\n`)
	settle()
	click_test_id('block-0')
	press(key)
	// in a list the caret decides which item Indent and Outdent move, so the field is read first
	await fieldIdle()
	check(
		`${key} (${title}) turns the Active block’s ${JSON.stringify(before)} into ${JSON.stringify(after)}`,
		documentController.text,
		`${after}\n`
	)
	press('escape')
}

/**
 * Heading 4 on a two-line paragraph writes `#### line one\nline two`, a heading and a paragraph: the open field
 * covers both until it closes, so `line two` is painted once (in the field), not again as a Block below it
 */
documentController.load('line one\nline two\n')
settle()
click_test_id('block-0')
press('cmd-alt-4')
const coveredWhileOpen = [
	documentController.text,
	find_test_id('block-1'),
	painted().split('line two').length - 1
]
press('escape')
check(
	'a Format command that writes several Blocks keeps them all in the open field, nothing painted twice, until it closes',
	[...coveredWhileOpen, find_test_id('block-1')?.type],
	['#### line one\nline two\n', null, 1, 'div']
)

// Cmd-S writes the file at once, well before the 1s autosave
const saveDirectory = mkdtempSync(join(tmpdir(), 'eg-save-'))
const savePath = join(saveDirectory, 'save.md')
writeFileSync(savePath, 'Draft\n')
documentController.open(savePath, { socketsDirectory: join(saveDirectory, 's') })
settle()
click_test_id('block-0')
type('s')
press('cmd-s')
await wait(100)
check('Cmd-S saves the file now', readFileSync(savePath, 'utf8'), 'Drafts\n')
press('escape')
rmSync(saveDirectory, { recursive: true, force: true })

/**
 * editmd titles a blocked remote image with its src (remote.ts:68 `title = src`), and once Load Remote Images allows
 * a `file:` image it loads from its path, since GPUI's <img> takes paths, not `file:` URLs
 */
const fileImageDirectory = mkdtempSync(join(tmpdir(), 'eg-file-image-'))
const fileImagePath = join(fileImageDirectory, 'pic.png')
writeFileSync(fileImagePath, png(30, 20))
documentController.load(
	`![tracker](https://example.com/p.png)\n\n![shot](${pathToFileURL(fileImagePath).href})\n`
)
settle()
const blockedImageTip = await tipAfterHover('remote-image-0-0', 'remote-image-tooltip-0-0-tip')
documentController.allowRemoteImages()
settle()
check(
	'a blocked remote image shows its src as its tooltip, and an allowed file: image loads from its path',
	[blockedImageTip, propOf('image-1-0', 'src')],
	['https://example.com/p.png', fileImagePath]
)
rmSync(fileImageDirectory, { recursive: true, force: true })

// Source mode (editmd View > Source): Cmd-/ swaps the Blocks for one field over the whole Document
documentController.load('# Title\n\nBody\n')
settle()
// a Block's field is open first, so the swap has a field to take away
click_test_id('block-1')
const blockFieldBefore = find_test_id('block-editor')?.type
press('cmd-/')
check(
	'Cmd-/ shows the whole Document in one field, in place of the Blocks and any Block field',
	[
		blockFieldBefore,
		propOf('source-editor', 'value'),
		find_test_id('block-0'),
		find_test_id('block-1'),
		find_test_id('block-editor')
	],
	['textarea', '# Title\n\nBody\n', null, null, null]
)
type('x')
check('typing in Source mode changes the Document', documentController.text, '# Title\n\nBody\nx')
press('escape')
check('escape does not leave Source mode', find_test_id('source-editor')?.type, 'textarea')
press('cmd-alt-2')
check('a Format command does nothing in Source mode', documentController.text, '# Title\n\nBody\nx')
press('cmd-/')
check('Cmd-/ again hides the source field', find_test_id('source-editor'), null)
// the view is DocumentView alone here, so everything painted is the two Blocks: the heading, then the paragraph
check(
	'the Blocks paint the text typed in Source mode: the paragraph paints `Body` then the typed `x`',
	[find_test_id('block-1')?.type, painted()],
	['div', 'Title\nBody x']
)

// a Disk merge while Source mode is open defers into its field like a Block's, keeping both edits
const sourceDirectory = mkdtempSync(join(tmpdir(), 'eg-source-'))
const sourcePath = join(sourceDirectory, 'source.md')
writeFileSync(sourcePath, '# Doc\n\nmine\n')
documentController.open(sourcePath, { socketsDirectory: join(sourceDirectory, 's') })
settle()
press('cmd-/')
type('y')
writeFileSync(sourcePath, '# Doc\n\nmine\n\ntheirs\n')
await waitUntil(
	() => documentController.text.includes('theirs') && documentController.text.includes('y'),
	'the disk merge in Source mode'
)
// the field's caret starts at the end, so `y` lands after `mine`'s newline, and the agent's paragraph follows it
await waitUntil(
	() => String(propOf('source-editor', 'value')).includes('theirs'),
	'the disk merge in the source field'
)
// the field shows the merge at once, as editmd's editor does: the typed `y` and the paragraph written to disk
check(
	'a Disk merge in Source mode keeps both edits and shows them in its field at once: the typed `y` and the paragraph written to disk',
	[documentController.sourceMode, documentController.text, propOf('source-editor', 'value')],
	[true, '# Doc\n\nmine\ny\ntheirs\n', '# Doc\n\nmine\ny\ntheirs\n']
)
press('cmd-/')

// the same for an open Block: a Disk merge into it lands in the Document and shows in its field at once
const blockPath = join(sourceDirectory, 'block.md')
writeFileSync(blockPath, '# Doc\n\npara\n')
documentController.open(blockPath, { socketsDirectory: join(sourceDirectory, 'b') })
settle()
click_test_id('block-1')
type('z')
writeFileSync(blockPath, '# Doc\n\npara\nagent\n')
await waitUntil(
	() => documentController.text.includes('agent'),
	'the disk merge into the open Block'
)
await waitUntil(
	() => String(propOf('block-editor', 'value')).includes('agent'),
	'the disk merge in the open field'
)
check(
	'a Disk merge into the open Block lands in the Document and shows in its field at once, merged with the typing',
	[documentController.activeIndex, documentController.text, propOf('block-editor', 'value')],
	[1, '# Doc\n\nparaz\nagent\n', 'paraz\nagent']
)
press('escape')

/**
 * an outside write that removes or adds Blocks above the open one while its field is open: the field
 * stays on the Edit session's Block wherever the merge moved it, keeps the typed `xy`, nothing paints twice, a new
 * Block above paints, and after more typing and Escape the Document holds the merged text. a stale Block index put
 * the field on the next Block and lost the typing ("F\n\nSecond paragraph.\n" on disk)
 */
let shiftRuns = 0
/** the page's painted lines, without the Agent legend the merge brings up in its corner */
function pageLines(): string[] {
	const lines = painted().split('\n')
	const legend = lines.indexOf('AGENTS')
	return legend < 0 ? lines : lines.slice(0, legend)
}
async function mergeAroundOpenField(outside: string) {
	shiftRuns++
	const shiftPath = join(sourceDirectory, `shift-${shiftRuns}.md`)
	const typed = '# Title\n\nFirst paragraph.xy\n\nSecond paragraph.\n'
	writeFileSync(shiftPath, '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n')
	documentController.open(shiftPath, { socketsDirectory: join(sourceDirectory, `m${shiftRuns}`) })
	settle()
	click_test_id('block-1')
	type('x')
	type('y')
	const beforeMerge = documentController.text
	writeFileSync(shiftPath, outside)
	await waitUntil(() => documentController.text !== typed, 'the merge around the open field')
	// an outside change to the open Block shows in its field a moment later, as the user sees it
	await fieldIdle()
	const whileOpen = [documentController.activeIndex, pageLines()]
	type('z')
	press('escape')
	return [beforeMerge, ...whileOpen, documentController.text, pageLines()]
}
check(
	'an outside write removing the Block above the open one: the field follows its Block, keeps the typing, nothing paints twice, Escape keeps the merged text',
	await mergeAroundOpenField('First paragraph.\n\nSecond paragraph.\n'),
	[
		'# Title\n\nFirst paragraph.xy\n\nSecond paragraph.\n',
		0,
		['First paragraph.xy', 'Second paragraph.'],
		'First paragraph.xyz\n\nSecond paragraph.\n',
		['First paragraph.xyz', 'Second paragraph.']
	]
)
check(
	'an outside write adding a Block above the open one: the new Block paints, the field follows its Block and keeps the typing, Escape keeps the merged text',
	await mergeAroundOpenField(
		'# Title\n\nNew paragraph from outside.\n\nFirst paragraph.\n\nSecond paragraph.\n'
	),
	[
		'# Title\n\nFirst paragraph.xy\n\nSecond paragraph.\n',
		2,
		['Title', 'New paragraph from outside.', 'First paragraph.xy', 'Second paragraph.'],
		'# Title\n\nNew paragraph from outside.\n\nFirst paragraph.xyz\n\nSecond paragraph.\n',
		['Title', 'New paragraph from outside.', 'First paragraph.xyz', 'Second paragraph.']
	]
)
// the same write also changes the open Block: the field shows the change at once, merged with the typing
check(
	'an outside write removing the Block above and changing the open one: the field follows it, shows both changes at once, and Escape keeps both',
	await mergeAroundOpenField('Fresh paragraph.\n\nSecond paragraph.\n'),
	[
		'# Title\n\nFirst paragraph.xy\n\nSecond paragraph.\n',
		0,
		['Fresh paragraph.xy', 'Second paragraph.'],
		'Fresh paragraph.xyz\n\nSecond paragraph.\n',
		['Fresh paragraph.xyz', 'Second paragraph.']
	]
)
/**
 * the paragraph being edited deleted by another program: the port keeps the field's text as its own Block where the
 * deleted one was (editmd's rich editor drops it), so the field stays on it showing the typing once, and later typing
 * lands in order
 */
check(
	'an outside write deleting the open Block: the field keeps showing the typing as its own Block, nothing paints twice, and Escape keeps the typing in order',
	await mergeAroundOpenField('# Title\n\nSecond paragraph.\n'),
	[
		'# Title\n\nFirst paragraph.xy\n\nSecond paragraph.\n',
		1,
		['Title', 'First paragraph.xy', 'Second paragraph.'],
		'# Title\n\nFirst paragraph.xyz\n\nSecond paragraph.\n',
		['Title', 'First paragraph.xyz', 'Second paragraph.']
	]
)

// Source mode's one field over the whole text: a Block removed above the typing keeps the field and both changes
const sourceShiftPath = join(sourceDirectory, 'source-shift.md')
writeFileSync(sourceShiftPath, '# Title\n\nFirst paragraph.\n')
documentController.open(sourceShiftPath, { socketsDirectory: join(sourceDirectory, 'ss') })
settle()
press('cmd-/')
type('y')
writeFileSync(sourceShiftPath, 'First paragraph.\n')
await waitUntil(
	() => !documentController.text.startsWith('# Title'),
	'the merge removing a Block in Source mode'
)
await fieldIdle()
const sourceAfterShift = [
	find_test_id('source-editor')?.type,
	documentController.text,
	pageLines().filter((line) => line === 'y').length
]
press('cmd-/')
// the field shows the merge at once, the typed `y` once
check(
	'an outside write removing a Block while Source mode is open keeps its field and both changes',
	[...sourceAfterShift, documentController.text],
	['textarea', 'First paragraph.\ny', 1, 'First paragraph.\ny']
)
rmSync(sourceDirectory, { recursive: true, force: true })

// Cmd-Z / Cmd-Shift-Z with no field focused run the Document's own history; headlessly no field reports focus
documentController.load('- [ ] task\n\nParagraph\n')
settle()
click_test_id('task-3')
const tickedBeforeUndo = documentController.text
press('cmd-z')
check(
	'Cmd-Z with no field focused unticks the task again',
	[tickedBeforeUndo, documentController.text],
	['- [x] task\n\nParagraph\n', '- [ ] task\n\nParagraph\n']
)
press('cmd-shift-z')
check('Cmd-Shift-Z ticks it again', documentController.text, '- [x] task\n\nParagraph\n')

click_test_id('block-1')
type('a')
type('b')
press('escape')
const typedBeforeUndo = documentController.text
press('cmd-z')
check(
	'Cmd-Z takes back a closed Edit session’s typing as one Undo step',
	[typedBeforeUndo, documentController.text],
	['- [x] task\n\nParagraphab\n', '- [x] task\n\nParagraph\n']
)

/**
 * with a field focused, Cmd-Z is the field's own native undo and the window never sees it: headlessly
 * no focus event arrives, so `focus` reports it as a window would
 */
click_test_id('block-1')
const paragraphField = find_test_id('block-editor')
if (paragraphField) focus(paragraphField)
type('x')
type('y')
const textBeforeFieldUndo = documentController.text
press('cmd-z')
check(
	'Cmd-Z in a focused field takes back its typing, leaving the Document’s Undo steps alone: the task stays ticked',
	[textBeforeFieldUndo, documentController.text, documentController.activeIndex],
	['- [x] task\n\nParagraphxy\n', '- [x] task\n\nParagraph\n', 1]
)
/**
 * the Document's own redo would bring back the closed session's `ab`, which Cmd-Z took back above; the field's
 * native redo brings back its own `xy` instead
 */
const textBeforeFieldRedo = documentController.text
press('cmd-shift-z')
check(
	'Cmd-Shift-Z in a focused field brings back its typing, leaving the Document’s Undo steps alone: no `ab` comes back',
	[textBeforeFieldRedo, documentController.text, documentController.activeIndex],
	['- [x] task\n\nParagraph\n', '- [x] task\n\nParagraphxy\n', 1]
)
unfocus()
press('escape')

/**
 * a click on a Block's first characters, where its leading link run paints: <markdown> gives its runs no test
 * ids, so the click lands by position and GPUI's hit testing finds the run
 */
function clickLinkIn(testId: string, modifiers?: string): void {
	const box = bounds(find_test_id(testId) ?? 0)
	if (!box) throw new Error(`no painted ${testId}`)
	// 4px in, so even a one-letter link run is under the pointer
	click_at(box.x + 4, box.y + box.height / 2, { modifiers })
}

// links follow only on Cmd-click, as editmd's onClick (`if (!event.metaKey) return`); scrolling needs App's Scroller
await view.unmount()
stopTheme()
let app = mount_headless(App, { width: 800, height: 538 })

const linkRuns: [string, string[]][] = []
// the File menu's effects too, so nothing a link test could reach opens a window or writes the real Open Recent
const linkDirectory = mkdtempSync(join(tmpdir(), 'eg-link-'))
const linkOptions = {
	run: (command: string, args: string[]) => void linkRuns.push([command, args]),
	openInEditor: (linkPath: string) => void linkRuns.push(['openInEditor', [linkPath]]),
	openWindow: (windowPath: string | null) => void linkRuns.push(['openWindow', [windowPath ?? '']]),
	choosePaths: () => Promise.resolve(null),
	recentFiles: new RecentFiles(join(linkDirectory, 'recent.json'))
}
const filler = Array.from({ length: 30 }, (_value, index) => `Filler paragraph ${index + 1}.`)
documentController.load(
	`[jump](#later)\n\n[web](https://example.com)\n\n${filler.join('\n\n')}\n\n## Later\n`,
	linkOptions
)
settle()

clickLinkIn('block-1', 'cmd')
// `linkDestination` resolves every link to an absolute URL, which adds the root path's slash
check('Cmd-clicking a web link opens it through `open`', linkRuns, [
	['open', ['https://example.com/']]
])
// closes the editor a Cmd-click that does not follow would open, so the next click finds its Block
press('escape')

linkRuns.length = 0
clickLinkIn('block-1')
check(
	'a plain click on a link opens its Block for editing and runs nothing',
	[documentController.activeIndex, find_test_id('block-editor')?.type, linkRuns],
	[1, 'textarea', []]
)
press('escape')

// the heading starts below the fold, so only following the link can bring it into view
const laterBefore = bounds(find_test_id('block-32') ?? 0)
clickLinkIn('block-0', 'cmd')
const laterBounds = bounds(find_test_id('block-32') ?? 0)
check(
	'Cmd-clicking a #fragment link scrolls its heading into view',
	[
		laterBefore !== null && laterBefore.y >= 538,
		laterBounds !== null && laterBounds.y >= 0 && laterBounds.y + laterBounds.height <= 538
	],
	[true, true]
)
check('following a link opens no editor', find_test_id('block-editor'), null)

// a footnote reference paints as a `footnote:` link run, so Cmd-click follows it to the definition as editmd's anchors do
documentController.load(
	`[^1] starts here.\n\n${filler.join('\n\n')}\n\n[^1]: The note.\n`,
	linkOptions
)
settle()
// the column keeps the scroll the #fragment link left it at, so it goes back to the top first
wheel({ x: 400, y: 200 }, 0, 10000)
settle()
const definitionBefore = bounds(find_test_id('footnote-31') ?? 0)
clickLinkIn('block-0', 'cmd')
const definitionAfter = bounds(find_test_id('footnote-31') ?? 0)
check(
	'Cmd-clicking a footnote reference scrolls its definition into view and opens no editor',
	[
		definitionBefore !== null && definitionBefore.y >= 538,
		definitionAfter !== null &&
			definitionAfter.y >= 0 &&
			definitionAfter.y + definitionAfter.height <= 538,
		find_test_id('block-editor')
	],
	[true, true, null]
)

/**
 * a link in the middle of a paragraph's text: <markdown> gives no run positions, so Cmd-clicks walk along the
 * line in 4px steps until one follows a link, closing the editor each plain-text Cmd-click opens on the way
 */
linkRuns.length = 0
documentController.load('Read the [manual](https://example.com/manual) first.\n', linkOptions)
settle()
const sentence = bounds(find_test_id('block-0') ?? 0)
let linkOffset: number | null = null
for (let x = 2; sentence && linkOffset === null && x < sentence.width; x += 4) {
	click_at(sentence.x + x, sentence.y + sentence.height / 2, { modifiers: 'cmd' })
	if (linkRuns.length > 0) linkOffset = x
	else press('escape')
}
// "Read the " paints well over 20px wide, so a link found nearer the start is not the one mid-sentence
check(
	'Cmd-clicking a link in the middle of a paragraph opens it through `open`, the text before it following nothing',
	[linkRuns, linkOffset !== null && linkOffset > 20],
	[[['open', ['https://example.com/manual']]], true]
)
press('escape')

linkRuns.length = 0
documentController.load('[write](mailto:kira@example.com)\n', linkOptions)
settle()
clickLinkIn('block-0', 'cmd')
check('Cmd-clicking a mail link opens it through `open`', linkRuns, [
	['open', ['mailto:kira@example.com']]
])

/**
 * with no runner handed in, the window's own runner starts `open`: here a stand-in for it, first on PATH, that
 * writes its arguments to a file. the click only happens once `which` resolves `open` to the stand-in, so the
 * real `open` is never reached
 */
const openStandIn = mkdtempSync(join(tmpdir(), 'eg-open-'))
const openArguments = join(openStandIn, 'arguments')
writeFileSync(join(openStandIn, 'open'), `#!/bin/sh\nprintf '%s|' "$@" > '${openArguments}'\n`, {
	mode: 0o755
})
const pathBefore = process.env.PATH
process.env.PATH = `${openStandIn}:${pathBefore ?? ''}`
const resolvedOpen = execFileSync('/usr/bin/which', ['open'], { encoding: 'utf8' }).trim()
if (resolvedOpen === join(openStandIn, 'open')) {
	documentController.load('[web](https://example.com/default)\n', {
		...linkOptions,
		run: undefined
	})
	settle()
	clickLinkIn('block-0', 'cmd')
	for (let poll = 0; poll < 40 && !existsSync(openArguments); poll++) await wait(50)
}
process.env.PATH = pathBefore
check(
	'with no runner handed in, Cmd-clicking a web link starts `open` with the URL',
	[
		resolvedOpen === join(openStandIn, 'open'),
		existsSync(openArguments) && readFileSync(openArguments, 'utf8')
	],
	[true, 'https://example.com/default|']
)
rmSync(openStandIn, { recursive: true, force: true })

/** clicks `testId` only when it is in the tree, so a dialog that never opened fails its checks, not the run */
function clickIfPresent(testId: string): void {
	if (find_test_id(testId)) click_test_id(testId)
}

// another scheme could start any app, so editmd asks first (LinkOpener.swift `confirm`)
linkRuns.length = 0
documentController.load('[x](ftp://example.com/x)\n', linkOptions)
settle()
clickLinkIn('block-0', 'cmd')
// the dialog's title and message are its first two <text> elements, each string on its child text node
check(
	'Cmd-clicking a link of another scheme asks first, showing the URL, and runs nothing',
	[
		find_test_id('confirm-link')
			?.children?.slice(0, 2)
			.map((element) => element.children?.[0]?.text),
		linkRuns
	],
	[['Open this link?', 'It opens in another app:\n\nftp://example.com/x'], []]
)
const shownBeforeCancel = find_test_id('confirm-link') !== null
clickIfPresent('confirm-link-cancel')
check(
	'Cancel closes the dialog and runs nothing',
	[shownBeforeCancel, find_test_id('confirm-link'), linkRuns],
	[true, null, []]
)

clickLinkIn('block-0', 'cmd')
const shownBeforeOpen = find_test_id('confirm-link') !== null
clickIfPresent('confirm-link-open')
check(
	'Open runs `open` with the URL and closes the dialog',
	[shownBeforeOpen, linkRuns, find_test_id('confirm-link')],
	[true, [['open', ['ftp://example.com/x']]], null]
)

linkRuns.length = 0
clickLinkIn('block-0', 'cmd')
const shownBeforeEscape = find_test_id('confirm-link') !== null
press('escape')
check(
	'Escape cancels the dialog',
	[shownBeforeEscape, find_test_id('confirm-link'), linkRuns],
	[true, null, []]
)

/**
 * a scheme editmd's page strips (Milkdown's `sanitizeLinkHref` keeps none but http, https, mailto, tel and ftp)
 * leaves the link with an empty href there, so a ⌘-click on it does nothing: no dialog, nothing run, no Block opened
 */
linkRuns.length = 0
documentController.load('[x](obsidian://open?vault=a)\n', linkOptions)
settle()
clickLinkIn('block-0', 'cmd')
check(
	'Cmd-clicking a link editmd’s page strips, `obsidian://open?vault=a`, does nothing: no dialog, nothing run, no Block opened',
	[find_test_id('confirm-link'), linkRuns, documentController.activeIndex],
	[null, [], null]
)
press('escape')

// a linked image, as a README badge (parity row r-image-linked): it paints as an image, and Cmd-click follows its link
const badgeDirectory = mkdtempSync(join(tmpdir(), 'eg-badge-'))
writeFileSync(join(badgeDirectory, 'badge.png'), png(90, 20))
const badgePath = join(badgeDirectory, 'r-image-linked.md')
writeFileSync(badgePath, '[![badge](badge.png)](https://example.com/ci) after a badge.\n')
linkRuns.length = 0
documentController.open(badgePath, { ...linkOptions, socketsDirectory: join(badgeDirectory, 's') })
settle()
check(
	'a linked image paints as an image with its own src, not as its link text',
	[find_test_id('image-0-0')?.type, propOf('image-0-0', 'src')],
	['img', join(badgeDirectory, 'badge.png')]
)
const badgeBounds = bounds(find_test_id('image-0-0') ?? 0)
if (badgeBounds)
	click_at(badgeBounds.x + badgeBounds.width / 2, badgeBounds.y + badgeBounds.height / 2, {
		modifiers: 'cmd'
	})
check(
	'Cmd-clicking a linked image opens its link through `open` and opens no editor',
	[linkRuns, find_test_id('block-editor')],
	[[['open', ['https://example.com/ci']]], null]
)
press('escape')
linkRuns.length = 0
if (badgeBounds)
	click_at(badgeBounds.x + badgeBounds.width / 2, badgeBounds.y + badgeBounds.height / 2)
check(
	'a plain click on a linked image opens its paragraph for editing and runs nothing',
	[documentController.activeIndex, find_test_id('block-editor')?.type, linkRuns],
	[0, 'textarea', []]
)
press('escape')
rmSync(badgeDirectory, { recursive: true, force: true })

// an empty Document shows editmd's hint where its first line would be (parity row r-empty-doc), in the faint colour
documentController.load('', linkOptions)
settle()
const hintShown = painted().includes('Start writing…')
const hintTheme = propOf('empty-hint-text', 'theme')
const hintInFaint =
	typeof hintTheme === 'object' &&
	hintTheme !== null &&
	!Array.isArray(hintTheme) &&
	hintTheme.text === hintTheme.textFaint
documentController.load('Some text.\n', linkOptions)
settle()
check(
	'an empty Document paints “Start writing…” in the faint colour, and one with text does not',
	[hintShown, hintInFaint, painted().includes('Start writing…')],
	[true, true, false]
)
documentController.load('', linkOptions)
settle()
clickIfPresent('empty-hint')
type('H')
type('i')
press('escape')
check(
	'clicking the hint and typing `Hi` makes the Document’s text `Hi`, and the hint is gone',
	[documentController.text, painted().includes('Start writing…'), find_test_id('empty-hint')],
	['Hi', false, null]
)

/**
 * editmd's hint is a CSS ::before, which find never matches: Cmd-F `Start` on an empty Document finds nothing,
 * and the hint paints where a paragraph of the same words paints as the first Block
 */
documentController.load('Start writing…\n', linkOptions)
settle()
const firstParagraphBox = bounds(find_test_id('block-0') ?? 0)
documentController.load('', linkOptions)
settle()
const hintBox = bounds(find_test_id('empty-hint') ?? 0)
press('cmd-f')
for (const key of ['S', 't', 'a', 'r', 't']) type(key)
await wait(350)
settle()
check(
	'Cmd-F `Start` on an empty Document matches nothing, the hint painting where a first paragraph would',
	[findController.total, painted_highlights().length, hintBox, hintBox !== null],
	[0, 0, firstParagraphBox, true]
)
for (let index = 0; index < 5; index++) type('backspace')
press('escape')

/** a native prop's value as the tree carries it, e.g. the `theme` object a <markdown> holds */
type PropValue = NonNullable<TreeNode['customProps']>[string]

/** one key of a native prop object (`theme.metrics`), undefined when the value is no object or lacks it */
function fieldOf(value: PropValue | undefined, key: string): PropValue | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
	return value[key]
}

// the appearance follows the system live: an injected reader stands in for `defaults`, polled every 50ms
await app.unmount()
const systemAnswers: Appearance[] = ['light']
const polledTheme = new ThemeController({
	readAppearance: () => systemAnswers.at(-1) ?? 'light',
	pollInterval: 50
})
app = mount_headless(App, { width: 800, height: 538, props: { theme: polledTheme } })
documentController.load('Body[^1]\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n[^1]: Note.\n')
settle()

/** what each appearance-dependent part paints in: block text, footnote text, window background */
function appearanceLook() {
	const blockTheme = find((node) => node.type === 'markdown')?.customProps?.theme
	return {
		appearance: fieldOf(blockTheme, 'appearance'),
		text: fieldOf(blockTheme, 'text'),
		footnoteText: fieldOf(propOf('footnote-2', 'theme'), 'text'),
		background: find_test_id('window')?.style?.backgroundColor
	}
}
const lightLook = appearanceLook()
const lightDiagram = propOf('mermaid-1', 'src')

/** the colour gpuix's Scroller paints App's scrollbar thumb in, plain and hovered, as resolved from the palette */
function thumbColours() {
	const style = find_test_id('page-scroller-thumb')?.style
	return [style?.backgroundColor, style?.hover?.backgroundColor]
}
const lightThumb = thumbColours()
systemAnswers.push('dark')
await wait(150)
settle()
check(
	'the next poll after the system turns dark repaints blocks, footnotes, diagrams and the window in the dark palette',
	[lightLook, appearanceLook(), lightDiagram, propOf('mermaid-1', 'src')],
	[
		{
			appearance: 'light',
			text: paletteFor('light').text,
			footnoteText: paletteFor('light').muted,
			background: paletteFor('light').background
		},
		{
			appearance: 'dark',
			text: paletteFor('dark').text,
			footnoteText: paletteFor('dark').muted,
			background: paletteFor('dark').background
		},
		// the diagram is its own source drawn in pele's light palette, then in its dark one
		diagramSrcOf('flowchart LR\n  A --> B', mermaidPaletteFor('light')),
		diagramSrcOf('flowchart LR\n  A --> B', mermaidPaletteFor('dark'))
	]
)
// editmd shows the system's overlay scroller, a quiet grey in either appearance, where gpuix's own thumb is a dark slate
check(
	'the scrollbar thumb paints in the palette’s faint grey, muted when hovered, in light and in dark',
	[lightThumb, thumbColours()],
	[
		[paletteFor('light').faint, paletteFor('light').muted],
		[paletteFor('dark').faint, paletteFor('dark').muted]
	]
)
await app.unmount()

// the poll reads the system without blocking the main thread: an async reader stands in for `readSystemAppearance`
const asyncAnswers: Appearance[] = ['light']
const asyncTheme = new ThemeController({
	initialAppearance: () => 'light',
	readAppearance: () => Promise.resolve(asyncAnswers.at(-1) ?? 'light'),
	pollInterval: 50
})
app = mount_headless(App, { width: 800, height: 538, props: { theme: asyncTheme } })
settle()
const asyncLightLook = appearanceLook()
asyncAnswers.push('dark')
await wait(150)
settle()
check(
	'an async appearance read that answers dark repaints blocks, footnotes and the window in the dark palette',
	[asyncLightLook, appearanceLook()],
	[
		{
			appearance: 'light',
			text: paletteFor('light').text,
			footnoteText: paletteFor('light').muted,
			background: paletteFor('light').background
		},
		{
			appearance: 'dark',
			text: paletteFor('dark').text,
			footnoteText: paletteFor('dark').muted,
			background: paletteFor('dark').background
		}
	]
)
await app.unmount()

// a system already dark when the window opens: its first frame is dark, with no poll needed to get there
const darkLook = {
	appearance: 'dark',
	text: paletteFor('dark').text,
	footnoteText: paletteFor('dark').muted,
	background: paletteFor('dark').background
}
// every read of the injected system, counted: the poll's first is 60s away, so any read before then is not the poll's
let darkFromStartReads = 0
const darkFromStartTheme = new ThemeController({
	readAppearance: () => {
		darkFromStartReads++
		return 'dark'
	},
	pollInterval: 60_000
})
const readsAtConstruction = darkFromStartReads
app = mount_headless(App, { width: 800, height: 538, props: { theme: darkFromStartTheme } })
const firstFrameLook = appearanceLook()
settle()
check(
	'a window whose system is dark from the start paints its first frame dark, before any poll',
	[firstFrameLook, appearanceLook()],
	[darkLook, darkLook]
)
check(
	'the first paint’s appearance is read synchronously, once: one read by the time the constructor returns, none more by the first frame',
	[readsAtConstruction, darkFromStartReads],
	[1, 1]
)
await app.unmount()

/**
 * a slow `defaults` (300ms) under a 50ms poll: the ticks it overlaps are skipped, so no second read starts while
 * one is pending
 */
let pendingReads = 0
let mostPendingReads = 0
let slowReads = 0
const slowTheme = new ThemeController({
	initialAppearance: () => 'light',
	readAppearance: () => {
		slowReads++
		pendingReads++
		mostPendingReads = Math.max(mostPendingReads, pendingReads)
		return new Promise<Appearance>((resolve) =>
			setTimeout(() => {
				pendingReads--
				resolve('light')
			}, 300)
		)
	},
	pollInterval: 50
})
app = mount_headless(App, { width: 800, height: 538, props: { theme: slowTheme } })
await wait(800)
check(
	'a read that takes 300ms under a 50ms poll is the only one pending, the poll reading again once it answers',
	[mostPendingReads, slowReads >= 2],
	[1, true]
)
await app.unmount()

// the default poll: no option given, the first read comes 2s after the window starts its theme, the next 2s later
const appearanceReadTimes: number[] = []
const defaultPollTheme = new ThemeController({
	initialAppearance: () => 'light',
	readAppearance: () => {
		appearanceReadTimes.push(performance.now())
		return 'light'
	}
})
const mountingAt = performance.now()
app = mount_headless(App, { width: 800, height: 538, props: { theme: defaultPollTheme } })
await wait_for(() => appearanceReadTimes.length > 1, {
	label: 'the second default poll',
	timeout: 5000
}).catch(() => null)
const firstReadAfter = (appearanceReadTimes[0] ?? Number.POSITIVE_INFINITY) - mountingAt
const secondReadAfter =
	(appearanceReadTimes[1] ?? Number.POSITIVE_INFINITY) -
	(appearanceReadTimes[0] ?? Number.POSITIVE_INFINITY)
// whole seconds, so the mount's own few ms do not count
check(
	'with no pollInterval the appearance is read every 2s: the first read lands 2s after the window starts, the second 2s after the first',
	[Math.round(firstReadAfter / 1000), Math.round(secondReadAfter / 1000)],
	[2, 2]
)
await app.unmount()
app = mount_headless(App, { width: 800, height: 538 })

// View > Zoom (Cmd-=, Cmd--, Cmd-0) scales native text and the views' own lengths, as editmd's page zoom
documentController.load('---\ntitle: A\n---\n\nBody\n')
settle()

/** the body Block's text size in the native theme and the front matter's mono size, as painted */
function zoomedSizes() {
	// the front matter's own <markdown> comes first; the body's is the next one
	const blockTheme = find(
		(node) => node.type === 'markdown' && node.testId?.startsWith('frontmatter-') !== true
	)?.customProps?.theme
	return [fieldOf(fieldOf(blockTheme, 'metrics'), 'mdTextSize'), monoLook('frontmatter-0')[1]]
}
/** the column's left padding and the gap between the first two Blocks, as painted: lengths of the views' own */
function zoomedLengths() {
	const first = bounds(find_test_id('block-0') ?? 0)
	const second = bounds(find_test_id('block-1') ?? 0)
	if (!first || !second) return null
	return [first.x, Math.round((second.y - first.y - first.height) * 1000) / 1000]
}
const lengthsBefore = zoomedLengths()
press('cmd-=')
settle()
const zoomedIn = zoomedSizes()
check('Cmd-= zooms block text and the front matter box by 1.1', zoomedIn, [17.6, 13.75])
// GPUI lays out on the 2x display's half-pixel grid, so 26.4px paints at 26.5 and 13.2px at 13
const toHalfPixels = (length: number) => Math.round(length * 2) / 2
/**
 * at actual size the 736px column sits centred in the 800px window, its Blocks 40px inside it; at 1.1 the column
 * would be 809.6px, so it fills the window and only its zoomed 44px padding is left of the first Block
 */
check(
	'Cmd-= zooms the column’s padding and the space under the front matter by 1.1 too, editmd’s 40px and 2rem',
	[lengthsBefore, zoomedLengths()],
	[
		[(800 - 736) / 2 + 40, 32],
		[toHalfPixels(40 * 1.1), toHalfPixels(32 * 1.1)]
	]
)
// an open Block's field is native text too, so it takes the zoomed theme: 17.6px text at 1.1
click_test_id('block-1')
check(
	'a Block field opened at Cmd-= takes the zoomed text theme',
	[
		fieldOf(fieldOf(propOf('block-editor', 'theme'), 'metrics'), 'mdTextSize'),
		propOf('block-editor', 'theme')
	],
	[17.6, textThemeFor(themeController.appearance, 1.1)]
)
press('escape')
press('cmd-0')
settle()
// from the zoomed sizes, so the check fails while zoom does nothing at all
check(
	'Cmd-0 restores the actual size',
	[zoomedIn, zoomedSizes()],
	[
		[17.6, 13.75],
		[16, 12.5]
	]
)
press('cmd--')
settle()
// 16 / 1.1 and 12.5 / 1.1, rounded to three decimals as the theme and the size tokens are
check('Cmd-- zooms out one step, dividing by 1.1', zoomedSizes(), [14.545, 11.364])
press('cmd-0')
for (let step = 0; step < 10; step++) press('cmd--')
settle()
check('Cmd-- stops at half size', zoomedSizes(), [8, 6.25])
press('cmd-0')
// 1.1 to the 12th is past 3, so 15 steps reach the upper clamp
for (let step = 0; step < 15; step++) press('cmd-=')
settle()
check('Cmd-= stops at three times the size', zoomedSizes(), [48, 37.5])
press('cmd-0')

// editmd's page zoom grows diagrams and nested list indentation with the text
documentController.load('```mermaid\ngraph TD\n  A-->B\n```\n\n- [ ] a\n  - [ ] b\n')
settle()
/** the diagram's painted width, and how far the nested task's checkbox sits right of the outer one */
function zoomedDrawing() {
	const diagram = bounds(find_test_id('mermaid-0') ?? 0)
	// a task's id is its mark's offset in the Document: after the 33-character fence, 36 and 46
	const outer = bounds(find_test_id('task-36') ?? 0)
	const nested = bounds(find_test_id('task-46') ?? 0)
	return [diagram?.width ?? 0, outer && nested ? nested.x - outer.x : 0]
}
const [diagramWidthBefore, indentBefore] = zoomedDrawing()
press('cmd-=')
settle()
const [diagramWidthZoomed, indentZoomed] = zoomedDrawing()
press('cmd-0')
settle()
check(
	'Cmd-= grows a mermaid diagram and a nested task’s indentation by 1.1',
	[
		diagramWidthBefore > 0 && Math.abs(diagramWidthZoomed / diagramWidthBefore - 1.1) <= 0.01,
		indentBefore,
		indentZoomed
	],
	// `ul { padding-left: 1.75em }`: 28px a level
	[true, 28, toHalfPixels(28 * 1.1)]
)

// the link dialog is modal like editmd's NSAlert: Return presses Open, its default button, and the Document takes no clicks
linkRuns.length = 0
documentController.load('[x](ftp://example.com/x)\n', linkOptions)
settle()
clickLinkIn('block-0', 'cmd')
const shownBeforeReturn = find_test_id('confirm-link') !== null
press('enter')
check(
	'Return presses Open: it runs `open` with the URL and closes the dialog',
	[shownBeforeReturn, linkRuns, find_test_id('confirm-link')],
	[true, [['open', ['ftp://example.com/x']]], null]
)

linkRuns.length = 0
clickLinkIn('block-0', 'cmd')
const shownBeforeClick = find_test_id('confirm-link') !== null
click_test_id('block-0')
check(
	'while the dialog is open a click on the Document opens no editor and keeps the dialog',
	[shownBeforeClick, find_test_id('block-editor'), find_test_id('confirm-link') !== null, linkRuns],
	[true, null, true, []]
)
press('escape')

// Find, as editmd's FindBar: a bar above the document; the matches inside every Block's native <markdown> count
const findFiller = Array.from({ length: 30 }, (_value, index) => `Filler paragraph ${index + 1}.`)
documentController.load(
	`Be **bold**, be brave.\n\n${findFiller.join('\n\n')}\n\nLast one to be here.\n`
)
settle()
press('cmd-f')
settle()
const findBarBox = bounds(find_test_id('find-bar') ?? 0)
const firstBlockBox = bounds(find_test_id('block-0') ?? 0)
check(
	'Cmd-F shows the find bar above the document, its field’s placeholder Find',
	[
		find_test_id('find-field')?.type,
		propOf('find-field', 'placeholder'),
		findBarBox !== null &&
			firstBlockBox !== null &&
			findBarBox.y + findBarBox.height <= firstBlockBox.y
	],
	['textarea', 'Find', true]
)

/**
 * what Find reports and what native paints: the match count, the active match (0-based, like `activeIndex`)
 * and which painted wash is the active one. the counts come from the paint, a 100ms poll behind it, and a
 * query with no match turns the field red only on the second empty read, so a stale frame does not flash it
 */
async function findState() {
	await wait(350)
	settle()
	return [
		findController.total,
		findController.active,
		painted_highlights().findIndex(({ active }) => active)
	]
}

type('b')
type('e')
check(
	'typing `be` finds its 3 matches across the Blocks, the first active',
	await findState(),
	[3, 0, 0]
)
press('enter')
check('Enter makes the second match active', await findState(), [3, 1, 1])
press('shift-enter')
check('Shift-Enter makes the first match active again', await findState(), [3, 0, 0])

press('enter')
press('enter')
const lastMatchState = await findState()
const lastBlockBox = bounds(find_test_id('block-31') ?? 0)
check(
	'the active match’s Block below the fold scrolls into view',
	[
		lastMatchState,
		lastBlockBox !== null && lastBlockBox.y >= 0 && lastBlockBox.y + lastBlockBox.height <= 538
	],
	[[3, 2, 2], true]
)
press('cmd-g')
check('Cmd-G from the last match wraps to the first', await findState(), [3, 0, 0])

clickIfPresent('find-next')
const afterNextChevron = await findState()
clickIfPresent('find-previous')
check(
	'the chevrons step to the next and the previous match',
	[afterNextChevron, await findState()],
	[
		[3, 1, 1],
		[3, 0, 0]
	]
)

// Cmd-F again focuses the field it already shows
press('cmd-f')
type('x')
await findState()
check(
	'a query with no match turns the field’s text the danger colour',
	[findController.query, findController.total, fieldOf(propOf('find-field', 'theme'), 'text')],
	['bex', 0, themeController.palette.danger]
)

press('escape')
type('y')
check(
	'Escape hides the bar and hands the keys back to the document',
	[find_test_id('find-bar'), findController.query],
	[null, 'bex']
)

press('cmd-f')
type('backspace')
type('backspace')
type('backspace')
const queryBeforeDone = findController.query
const shownBeforeDone = find_test_id('find-bar') !== null
clickIfPresent('find-done')
check(
	'Done hides the bar',
	[queryBeforeDone, shownBeforeDone, find_test_id('find-bar') !== null],
	['', true, false]
)
press('cmd-g')
check(
	'Cmd-G with an empty query shows the bar with its field',
	find_test_id('find-field')?.type,
	'textarea'
)
press('escape')

/**
 * editmd's field is an NSSearchField (EditorWindowController.swift:240): a magnifier inside it at its left, before
 * the text, and a clear button while it holds text, which empties it
 */
press('cmd-f')
const clearWhileEmpty = find_test_id('find-clear')
type('b')
await findState()
const searchFieldBox = bounds(find_test_id('find-field-box') ?? 0)
const magnifierBox = bounds(find_test_id('find-magnifier') ?? 0)
const searchTextBox = bounds(find_test_id('find-field') ?? 0)
const clearWhileTyped = find_test_id('find-clear') !== null
clickIfPresent('find-clear')
await findState()
check(
	'the find field shows a magnifier inside its left edge before the text, and a clear button only while it holds text, which empties it',
	[
		clearWhileEmpty,
		searchFieldBox && magnifierBox && searchTextBox
			? // GPUI's `bounds` gives the bezel's x inside its border and padding, where the magnifier starts
				magnifierBox.x >= searchFieldBox.x && magnifierBox.x + magnifierBox.width <= searchTextBox.x
			: null,
		clearWhileTyped,
		findController.query,
		propOf('find-field', 'value'),
		find_test_id('find-clear'),
		findController.total
	],
	[null, true, true, '', '', null, 0]
)
press('escape')

/** a pixel's colour in a decoded screenshot, as `#rrggbb`, at logical point (`x`, `y`) */
function shotColourAt(shot: Pixels, scale: number, x: number, y: number): string {
	const at = (Math.round(y * scale) * shot.width + Math.round(x * scale)) * 4
	return `#${[shot.data[at]!, shot.data[at + 1]!, shot.data[at + 2]!].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/** whether two `#rrggbb` colours are within `tolerance` on every channel */
function near(a: string, b: string, tolerance = 16): boolean {
	const channels = (hex: string) =>
		[1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
	const [ca, cb] = [channels(a), channels(b)]
	return ca.every((value, index) => Math.abs(value - cb[index]!) <= tolerance)
}

/**
 * NSSearchField's clear button is `xmark.circle.fill`: a disc with the × cut out of it, so the × shows the field's
 * own background, dark on a light disc in dark mode and the reverse in light. read off a real paint: the glyph's
 * centre, where the ×'s strokes cross, is the field's background, and a point inside the disc away from the strokes
 * is the disc's colour
 */
press('cmd-f')
type('b')
await findState()
const clearBox = bounds(find_test_id('find-clear') ?? 0)
const clearShotPath = join(tmpdir(), `eg-find-clear-${process.pid}.png`)
screenshot(clearShotPath)
const clearShot = decodePng(readFileSync(clearShotPath))
rmSync(clearShotPath, { force: true })
const clearScale = clearShot.width / 800
const clearColours = clearBox
	? [
			shotColourAt(
				clearShot,
				clearScale,
				clearBox.x + clearBox.width / 2,
				clearBox.y + clearBox.height / 2
			),
			shotColourAt(
				clearShot,
				clearScale,
				clearBox.x + clearBox.width / 2,
				clearBox.y + clearBox.height * 0.2
			)
		]
	: []
check(
	`the find field’s clear button paints its × in the field’s background, cut out of the disc (centre, disc: ${clearColours.join(', ')})`,
	[
		near(clearColours[0] ?? '', themeController.palette.background),
		near(clearColours[1] ?? '', themeController.palette.faint),
		!near(clearColours[0] ?? '', clearColours[1] ?? '', 40)
	],
	[true, true, true]
)
clickIfPresent('find-clear')
press('escape')

/** the string a <text> element paints: it lives on its child text node, not on the node carrying the test id */
function textOf(testId: string) {
	return find_test_id(testId)?.children?.[0]?.text
}

/** `wait_for` that gives up quietly, so a condition that never holds fails its check rather than the run */
async function waitUntil(condition: () => boolean, label: string): Promise<void> {
	await wait_for(condition, { label }).catch(() => null)
}

/** clears a field's text key by key: the field has no selection API (gap G1), so its prefill cannot be selected */
function retype(previous: string, next: string): void {
	for (let index = 0; index < previous.length; index++) type('backspace')
	for (const key of next) type(key)
}

// File > Save As, as editmd's NSSavePanel: a name field and a folder, from an injected picker since gpuix has none
const fileDirectory = mkdtempSync(join(tmpdir(), 'eg-file-'))
const windowRuns: [string, string[]][] = []
const windowOptions = {
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
	// Save As adds to Open Recent, so its store is this test's too; New and Open only record
	openWindow: (windowPath: string | null) =>
		void windowRuns.push(['openWindow', [windowPath ?? '']]),
	choosePaths: () => Promise.resolve(null),
	recentFiles: new RecentFiles(join(fileDirectory, 'recent.json'))
}

documentController.load('# Plan\n\nfirst\n', windowOptions)
settle()
press('cmd-s')
settle()
check(
	'Cmd-S on an untitled Document opens the Save As dialog, named Untitled.md in ~/Documents',
	[find_test_id('save-as') !== null, propOf('save-as-name', 'value'), textOf('save-as-folder')],
	[true, 'Untitled.md', join(homedir(), 'Documents')]
)

retype('Untitled.md', 'plan')
clickIfPresent('save-as-choose')
await waitUntil(() => textOf('save-as-folder') === fileDirectory, 'the chosen folder')
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
// polled, not sampled after a fixed wait: under load the 1s autosave lands past any guessed delay (the window's
// own timing is checked on its own above); 4s leaves room for the 1s idle and the 5s cap never comes into it
const planSaved = async () => {
	for (const deadline = Date.now() + 4000; Date.now() < deadline; await wait(50)) {
		if (existsSync(planPath) && readFileSync(planPath, 'utf8') === '# Plan\n\nfirstx\n') return true
	}
	return false
}
check('a following edit autosaves to plan.md', await planSaved(), true)
press('escape')

// Save As on an opened file: the new file is written, the old one keeps its bytes, and the window follows the new one
const firstPath = join(fileDirectory, 'first.md')
const secondPath = join(fileDirectory, 'second.md')
writeFileSync(firstPath, '# First\n\nbody\n')
documentController.open(firstPath, windowOptions)
settle()
press('cmd-shift-s')
settle()
check(
	'Cmd-Shift-S on an opened file offers its own name in its own folder',
	[propOf('save-as-name', 'value'), textOf('save-as-folder')],
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
check('the window title follows the new file', windowRuns.at(-1), ['setWindowTitle', ['second.md']])

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
		textOf('replace-file-title'),
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
		propOf('save-as-name', 'value')
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
const closePath = join(fileDirectory, 'close.md')
writeFileSync(closePath, 'Draft\n')
documentController.open(closePath, windowOptions)
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
		textOf('save-changes-title'),
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
		textOf('save-changes-title'),
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
await waitUntil(() => textOf('save-as-folder') === fileDirectory, 'the chosen folder')
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

// File > Revert to Saved has no key in editmd; the command palette will run it, so the test runs it the same way
const revertPath = join(fileDirectory, 'revert.md')
writeFileSync(revertPath, '# Saved\n')
documentController.open(revertPath, windowOptions)
settle()
click_test_id('block-0')
type('x')
press('escape')
documentController.run('revert')
settle()
check(
	'Revert to Saved asks first, in NSDocument’s words',
	[find_test_id('revert') !== null, textOf('revert-title')],
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
function printedBy(keystroke: string) {
	windowRuns.length = 0
	press(keystroke)
	const page = windowRuns[0]?.[1][0]
	return {
		runs: windowRuns.slice(),
		heading: page !== undefined && /<h1[^>]*>Printed heading<\/h1>/.test(readFileSync(page, 'utf8'))
	}
}
const printPage = join(fileDirectory, 'Untitled.html')
check('Cmd-P writes a printable page with the rendered heading and opens it', printedBy('cmd-p'), {
	runs: [['open', [printPage]]],
	heading: true
})
check(
	'Cmd-Shift-P (Page Setup) does the same, the browser’s print dialog holding page setup',
	printedBy('cmd-shift-p'),
	{ runs: [['open', [printPage]]], heading: true }
)

rmSync(fileDirectory, { recursive: true, force: true })
rmSync(linkDirectory, { recursive: true, force: true })

/**
 * File > New, Open… and Open Recent, as editmd's NSDocumentController: one process per Document (ADR-0008), so
 * a new window is the injected opener's call, the picker answers from `picks` and Open Recent lives in this
 * test's folder; nothing spawns, no picker shows and the real store is never read or written
 */
const openDirectory = mkdtempSync(join(tmpdir(), 'eg-open-'))
const openedWindows: (string | null)[] = []
const openRuns: [string, string[]][] = []
const picks: string[][] = []
const openRecent = new RecentFiles(join(openDirectory, 'recent.json'))
const openOptions = {
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

// Open Recent has no key and no menu bar to live in (gap G2): the command palette will run it, as the test does
documentController.run('openRecent')
settle()
check(
	'Open Recent lists the recent files, newest first',
	[0, 1, 2, 3].map((index) => textOf(`open-recent-name-${index}`)),
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

/**
 * a Finder drop of `paths` on the centre of `testId`. a real drag travels over the window before it drops, so the
 * pointer moves there first: without a move between two `drop_files`, GPUI delivered only the first (measured
 * headlessly; a `key_up` of the last shortcut did not help)
 */
function dropOn(testId: string, paths: string[]): void {
	const target = find_test_id(testId)
	if (!target) throw new Error(`no painted ${testId}`)
	mouse_move(target)
	drop_files(target, paths)
}

// dropped files, as editmd's SelfTest `droppingFiles`: images are linked where they land, text files open
mkdirSync(join(openDirectory, 'images'))
const droppedImage = join(openDirectory, 'images', 'my pic.png')
writeFileSync(droppedImage, png(2, 2))
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
// a new window starts once the other windows said none of them has the file (`focusWindowFor`)
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

// while a dialog is open the menu keys stay away from the Document: Cmd-S used to reopen Save As over the typing
documentController.load('Draft\n', openOptions)
settle()
press('cmd-s')
settle()
retype('Untitled.md', 'kept')
clickIfPresent('save-as-choose')
await waitUntil(() => textOf('save-as-folder') === openDirectory, 'the chosen folder')
press('cmd-s')
settle()
check(
	'Cmd-S while the Save As dialog is open keeps the typed name and the chosen folder',
	[propOf('save-as-name', 'value'), textOf('save-as-folder')],
	['kept', openDirectory]
)
// Save only into this test's folder: had Cmd-S put the dialog back on ~/Documents, Escape writes nothing
press(textOf('save-as-folder') === openDirectory ? 'enter' : 'escape')
settle()
check(
	'Save As adds the new file to Open Recent',
	openRecent.list()[0],
	join(openDirectory, 'kept.md')
)

rmSync(openDirectory, { recursive: true, force: true })

/**
 * the menus with no menu bar (gap G2): the items with no key run through the same `run` as the shortcuts, and
 * the command palette runs any of them. a palette entry can reach every File menu effect, so each is this
 * test's: nothing spawns, no picker shows, no window closes and the real Open Recent is never read or written
 */
const menuDirectory = mkdtempSync(join(tmpdir(), 'eg-menu-'))
const menuRuns: [string, string[]][] = []
const menuWindows: (string | null)[] = []
const menuPicks: string[][] = []
const menuRecent = new RecentFiles(join(menuDirectory, 'recent.json'))
/** what Add Link's sheet reads as the pasteboard's URL: this test's, so the real clipboard is never read */
let menuClipboardUrl: string | null = null
const menuOptions = {
	socketsDirectory: join(menuDirectory, 's'),
	run: (command: string, args: string[]) => void menuRuns.push([command, args]),
	openInEditor: (linkPath: string) => void menuRuns.push(['openInEditor', [linkPath]]),
	chooseFolder: () => Promise.resolve(menuDirectory),
	closeWindow: () => void menuRuns.push(['closeWindow', []]),
	setWindowTitle: (title: string) => void menuRuns.push(['setWindowTitle', [title]]),
	writePrintable: (_text: string, title: string) => join(menuDirectory, `${title}.html`),
	openWindow: (windowPath: string | null) => void menuWindows.push(windowPath),
	choosePaths: () => Promise.resolve(menuPicks.shift() ?? null),
	recentFiles: menuRecent,
	// no `ps`: a write nobody reported is Outside edit, whatever agents run on this machine
	listAgentProcesses: () => [],
	// Window > Minimize, Zoom and Bring All to Front record instead of touching the test window
	minimizeWindow: () => void menuRuns.push(['minimize', []]),
	zoomWindow: () => void menuRuns.push(['zoomWindow', []]),
	activateWindow: () => void menuRuns.push(['activateWindow', []]),
	// View > Enter Full Screen records instead of taking the test window full screen
	toggleFullScreen: () => void menuRuns.push(['toggleFullScreen', []]),
	readClipboardUrl: () => menuClipboardUrl,
	// the legend's minimized state lives in this test's folder, never the real support folder
	legendPreference: new LegendPreference(join(menuDirectory, 'legend.json')),
	// a highlight's time in one locale and zone, so its tooltip reads the same on any machine
	timeFormat: { locale: 'en-US', timeZone: 'UTC' }
}

// Format > Table and Horizontal Rule have no key in editmd: each goes in as a Block of its own, one Undo step
documentController.load('Intro\n\nEnd\n', menuOptions)
settle()
click_test_id('block-0')
type('x')
documentController.run('table')
settle()
/**
 * the inserted Block's field stays closed: a focused <textarea> takes Cmd-Z as its own native undo before any listener
 * hears it (measured headless), and editmd's one Cmd-Z takes the insert back
 */
check(
	'Table after an Active paragraph inserts editmd’s 3x3 table as the Block after it',
	[documentController.text, documentController.blocks[1]?.kind, documentController.activeIndex],
	[`Introx\n\n${TABLE}\n\nEnd\n`, 'table', null]
)
press('cmd-z')
check(
	'Cmd-Z takes the table out again, the typing before it staying',
	documentController.text,
	'Introx\n\nEnd\n'
)

documentController.load('A\n\nB\n', menuOptions)
settle()
documentController.run('horizontalRule')
settle()
/**
 * editmd's caret sits at the Document's start after it loads, so a rule goes in before the first Block
 * (measured in editmd's own editor: `---` then the first paragraph); no field opens
 */
check(
	'Horizontal Rule with no Active block puts `---` before the first Block',
	[documentController.text, documentController.activeIndex],
	['---\n\nA\n\nB\n', null]
)
documentController.run('toggleSource')
settle()
const inSourceBeforeTable = [documentController.sourceMode, find_test_id('source-editor')?.type]
documentController.run('table')
check(
	'Table does nothing in Source mode, where editmd disables Format',
	[inSourceBeforeTable, documentController.text],
	[[true, 'textarea'], '---\n\nA\n\nB\n']
)
documentController.run('horizontalRule')
check(
	'Horizontal Rule does nothing in Source mode either',
	[documentController.sourceMode, documentController.text],
	[true, '---\n\nA\n\nB\n']
)
documentController.run('toggleSource')

documentController.load('A\n\nB\n', menuOptions)
settle()
documentController.run('table')
settle()
// editmd at load inserts the table before the first paragraph (measured in editmd's own editor)
check(
	'Table with no Active block puts editmd’s 3x3 table before the first Block',
	[documentController.text, documentController.activeIndex],
	[`${TABLE}\n\nA\n\nB\n`, null]
)
press('cmd-z')
check(
	'Cmd-Z takes the inserted table out again as one Undo step',
	documentController.text,
	'A\n\nB\n'
)
documentController.run('horizontalRule')
settle()
const withInsertedRule = documentController.text
press('cmd-z')
check(
	'Cmd-Z takes an inserted rule out again as one Undo step',
	[withInsertedRule, documentController.text],
	['---\n\nA\n\nB\n', 'A\n\nB\n']
)

documentController.load('A\n\nB\n', menuOptions)
settle()
click_test_id('block-0')
type('x')
documentController.run('horizontalRule')
settle()
check(
	'Horizontal Rule after an Active paragraph inserts `---` as the Block after it',
	[documentController.text, documentController.blocks[1]?.kind, documentController.activeIndex],
	['Ax\n\n---\n\nB\n', 'thematicBreak', null]
)
press('cmd-z')
check(
	'Cmd-Z takes the rule out again, the typing before it staying',
	documentController.text,
	'Ax\n\nB\n'
)

// Format > Table and Horizontal Rule through the command palette, as a user without a menu bar runs them
documentController.load('A\n\nB\n', menuOptions)
settle()
click_test_id('block-0')
documentController.run('commandPalette')
settle()
typeQuery('table')
settle()
const tableTitles = paletteTitles()
press('enter')
settle()
check(
	'typing `table` in the command palette lists Table, and Return inserts it after the Active block',
	[tableTitles, documentController.text, find_test_id('command-palette')],
	[['Table'], `A\n\n${TABLE}\n\nB\n`, null]
)
documentController.load('A\n\nB\n', menuOptions)
settle()
documentController.run('commandPalette')
settle()
typeQuery('horizontal')
settle()
const ruleTitles = paletteTitles()
press('enter')
settle()
check(
	'typing `horizontal` in the command palette lists Horizontal Rule, and Return puts it before the first Block',
	[ruleTitles, documentController.text, find_test_id('command-palette')],
	[['Horizontal Rule'], '---\n\nA\n\nB\n', null]
)

documentController.load('![tracker](https://example.com/p.png)\n', menuOptions)
settle()
const blockedBeforeLoad = textOf('image-blocked-0-0')
documentController.run('loadRemoteImages')
settle()
check(
	'Load Remote Images through `run` paints a blocked remote image',
	[blockedBeforeLoad, propOf('image-0-0', 'src')],
	['tracker', 'https://example.com/p.png']
)

// a paragraph mixing text and images, as editmd paints them inline: each text run as markdown, each image as one
writeFileSync(join(menuDirectory, 'pic.png'), png(300, 200))
const mixedPath = join(menuDirectory, 'mixed.md')
writeFileSync(mixedPath, 'See ![a](pic.png) here.\n')
documentController.open(mixedPath, menuOptions)
settle()
const mixedLines = painted().split('\n')
check(
	'a paragraph mixing text and an image paints `See`, the image from the document’s folder, and `here.`',
	[
		mixedLines.includes('See'),
		mixedLines.includes('here.'),
		find_test_id('image-0-0')?.type,
		propOf('image-0-0', 'src')
	],
	[true, true, 'img', join(menuDirectory, 'pic.png')]
)
if (find_test_id('image-0-0')) click_test_id('image-0-0')
check(
	'clicking the image in a mixed paragraph opens the whole paragraph for editing',
	[documentController.activeIndex, propOf('block-editor', 'value')],
	[0, 'See ![a](pic.png) here.']
)
press('escape')

documentController.load('Look ![tracker](https://example.com/p.png) there.\n', menuOptions)
settle()
const mixedBlocked = textOf('image-blocked-0-0')
documentController.run('loadRemoteImages')
settle()
check(
	'a remote image in a mixed paragraph shows its alt text until Load Remote Images paints it',
	[mixedBlocked, propOf('image-0-0', 'src')],
	['tracker', 'https://example.com/p.png']
)

/**
 * a local image whose file is gone paints as WebKit, editmd's renderer, paints a broken image: small, with its alt
 * text, not GPUI's "img: load failed" atop the 240px fallback box. a file that is there but of unknown size (not a
 * PNG, GIF, JPEG or WebP) keeps the box
 */
writeFileSync(join(menuDirectory, 'junk.png'), 'not an image')
const missingPath = join(menuDirectory, 'missing.md')
writeFileSync(missingPath, '![gone](gone.png)\n\n![junk](junk.png)\n')
documentController.open(missingPath, menuOptions)
settle()
check(
	'a missing local image paints its alt text, small, with no image',
	[
		textOf('image-missing-0-0'),
		find_test_id('image-0-0'),
		(bounds(find_test_id('image-missing-0-0') ?? 0)?.height ?? 240) < 120
	],
	['gone', null, true]
)
check(
	'an existing local image of unknown size keeps the fixed box',
	[find_test_id('image-1-0')?.type, bounds(find_test_id('image-1-0') ?? 0)?.height],
	['img', 240]
)

// text with no size of its own paints at GPUI's 16px whatever the zoom, so these take size tokens
// a numbered item's marker is text; a bullet is a drawn disc, sized by tokens
documentController.load('1. a\n2. [ ] b\n\n![tracker](https://example.com/p.png)\n', menuOptions)
settle()

/** the font size of the first item's number and of the blocked image's alt text */
function unsizedTextSizes() {
	return [
		find_test_id('list-marker-3')?.style?.fontSize,
		find_test_id('image-blocked-1-0')?.style?.fontSize
	]
}
const actualSizeText = unsizedTextSizes()
press('cmd-=')
settle()
check(
	'Cmd-= scales a list marker and a blocked image’s alt text by 1.1, from GPUI’s 16px and editmd’s 0.9em',
	[actualSizeText, unsizedTextSizes()],
	[
		[16, 14.4],
		[17.6, 15.84]
	]
)
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
 * only this window's messages count: an earlier window whose folder this test removed while its socket was still
 * being set up logs its own ENOENT from `chmodSync` whenever that lands (host/agentIpc.ts), here too at times
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

/** the titles the command palette lists, in order */
function paletteTitles(): string[] {
	const titles: string[] = []
	for (let index = 0; find_test_id(`palette-title-${index}`); index++) {
		titles.push(textOf(`palette-title-${index}`) ?? '')
	}
	return titles
}

/** types `query` into the focused field one key per `type`, so it stays literal */
function typeQuery(query: string): void {
	for (const key of query) type(key === ' ' ? 'space' : key)
}

// the command palette (gap G2) on ⇧⌘/, where macOS's Help menu searches menu items; editmd's Help menu is empty
documentController.load('Title\n\nBody\n', menuOptions)
settle()
click_test_id('block-0')
press('cmd-shift-/')
settle()
check(
	'Cmd-Shift-/ opens the command palette, its field’s placeholder Search menus',
	[find_test_id('command-palette') !== null, propOf('command-palette-field', 'placeholder')],
	[true, 'Search menus']
)
// the checks after it drive the palette through its command, so a key that misses fails only the check above
if (find_test_id('command-palette') === null) documentController.run('commandPalette')
settle()
typeQuery('head 2')
settle()
const headingTitles = paletteTitles()
check('typing `head 2` lists exactly Heading 2', headingTitles, ['Heading 2'])
press('enter')
settle()
check(
	'Return runs the selected entry on the Active block and closes the palette',
	[headingTitles, documentController.text, find_test_id('command-palette')],
	[['Heading 2'], '## Title\n\nBody\n', null]
)
press('escape')

documentController.run('commandPalette')
settle()
typeQuery('zoom')
settle()
const zoomTitles = paletteTitles()
press('down')
press('enter')
settle()
check(
	'`zoom` lists Zoom In and Zoom Out, and Down then Return zooms out',
	[zoomTitles, themeController.zoom, find_test_id('command-palette')],
	[['Zoom In', 'Zoom Out'], zoomOut(1), null]
)
press('cmd-0')

// Bold needs a text selection the gpuix textarea does not expose (gap G1), so it is listed but disabled
documentController.run('commandPalette')
settle()
typeQuery('bold')
settle()
const textBeforeBold = documentController.text
press('enter')
settle()
check(
	'Bold is listed but greyed, and Return on it does nothing',
	[
		paletteTitles(),
		find_test_id('palette-row-0')?.style?.color,
		documentController.text,
		find_test_id('command-palette') !== null
	],
	[['Bold'], themeController.palette.muted, textBeforeBold, true]
)
const paletteBeforeEscape = find_test_id('command-palette') !== null
press('escape')
settle()
check(
	'Escape closes the palette',
	[paletteBeforeEscape, find_test_id('command-palette')],
	[true, null]
)

// as editmd's `validateMenuItem`: Source mode renames the toggle and disables Format
documentController.run('toggleSource')
settle()
documentController.run('commandPalette')
settle()
typeQuery('markdown')
settle()
const sourceToggleTitles = paletteTitles()
retype('markdown', 'format')
settle()
const formatColours = paletteTitles().map(
	(_title, index) => find_test_id(`palette-row-${index}`)?.style?.color
)
check('in Source mode the toggle reads Show Rendered Markdown', sourceToggleTitles, [
	'Show Rendered Markdown'
])
check(
	'in Source mode every Format entry is greyed',
	[formatColours.length, formatColours.every((colour) => colour === themeController.palette.muted)],
	[20, true]
)
press('escape')
documentController.run('toggleSource')

documentController.load('Plain\n', menuOptions)
settle()
click_test_id('block-0')
documentController.run('commandPalette')
settle()
typeQuery('quote')
settle()
clickIfPresent('palette-row-0')
settle()
check(
	'clicking an entry runs it and closes the palette',
	[documentController.text, find_test_id('command-palette')],
	['> Plain\n', null]
)
press('escape')

/**
 * twenty Downs from New, past Revert to Saved (greyed for this untitled Document, as NSDocument validates it), Copy
 * (greyed with nothing selected) and Format's four disabled inline entries (Link… is enabled), select Heading 6, far
 * below the first rows
 */
documentController.run('commandPalette')
settle()
for (let step = 0; step < 20; step++) {
	press('down')
	settle()
}
// the list's own box, below the field: the rows scroll inside it
const paletteListBox = bounds(find_test_id('command-palette-list') ?? 0)
const selectedRowBox = bounds(find_test_id('palette-row-26') ?? 0)
check(
	'Down past the visible rows scrolls the selected entry into view',
	[
		textOf('palette-title-26'),
		find_test_id('palette-row-26')?.style?.backgroundColor,
		paletteListBox !== null &&
			selectedRowBox !== null &&
			selectedRowBox.y >= paletteListBox.y &&
			selectedRowBox.y + selectedRowBox.height <= paletteListBox.y + paletteListBox.height
	],
	['Heading 6', themeController.palette.accent, true]
)
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
		textOf('open-failed-title'),
		textOf('open-failed-message'),
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

documentController.open(launchedPath, menuOptions)
settle()
const gonePath = join(menuDirectory, 'gone.md')
menuRecent.add(gonePath)
documentController.run('openRecent')
settle()
clickIfPresent('open-recent-0')
settle()
check(
	'a recent file that is gone alerts that it does not exist and opens no window',
	[textOf('open-failed-title'), find_test_id('open-failed-message'), menuWindows],
	['The document “gone.md” could not be opened. The file doesn’t exist.', null, []]
)
press('escape')
settle()

const lockedPath = join(menuDirectory, 'locked.md')
writeFileSync(lockedPath, '# Locked\n')
chmodSync(lockedPath, 0o000)
dropOn('block-0', [lockedPath])
settle()
check(
	'a dropped text file it may not read alerts that permission is missing and changes nothing',
	[
		textOf('open-failed-title'),
		textOf('open-failed-message'),
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
 * a file named at launch that cannot be read: NSDocumentController alerts and the window opens untitled, where the
 * process used to end. a throw is caught, so it fails the check instead of the run
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
		textOf('open-failed-title'),
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

// a save that had to leave the file's encoding says so, as editmd's EditorWindowController `showNotice` sheet
const latinPath = join(menuDirectory, 'latin.md')
// "# Café\n" in Windows-1252, whose é is no valid UTF-8
writeFileSync(latinPath, Buffer.from([0x23, 0x20, 0x43, 0x61, 0x66, 0xe9, 0x0a]))
documentController.open(latinPath, menuOptions)
settle()
click_test_id('block-0')
type('😀')
press('cmd-s')
settle()
check(
	'a save that Windows-1252 cannot hold writes UTF-8 and shows editmd’s Saved in a Different Encoding alert',
	[
		textOf('save-notice-title'),
		textOf('save-notice-message'),
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
const latinBytes = Buffer.from([0x23, 0x20, 0x43, 0x61, 0x66, 0xe9, 0x0a])
const latinSourcePath = join(menuDirectory, 'latin-source.md')
const latinMovedPath = join(menuDirectory, 'latin-moved.md')
writeFileSync(latinSourcePath, latinBytes)
documentController.open(latinSourcePath, menuOptions)
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
		textOf('save-notice-title'),
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
const latinPalettePath = join(menuDirectory, 'latin-palette.md')
writeFileSync(latinPalettePath, latinBytes)
documentController.open(latinPalettePath, menuOptions)
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
await wait(100)
settle()
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
	[find_test_id('command-palette'), textOf('save-notice-title'), textOf('save-notice-message')],
	[
		null,
		'Saved in a Different Encoding',
		"The file was saved as UTF-8, because it now contains characters Windows-1252 can't represent."
	]
)
clickIfPresent('save-notice-ok')
settle()

// the same behind the Save As dialog, a sheet in editmd too: its Cancel shows the waiting notice
const latinSaveAsPath = join(menuDirectory, 'latin-save-as.md')
writeFileSync(latinSaveAsPath, latinBytes)
documentController.open(latinSaveAsPath, menuOptions)
settle()
click_test_id('block-0')
type('😀')
press('escape')
press('cmd-shift-s')
settle()
const saveAsBeforeAutosave = find_test_id('save-as') !== null
await wait(1300)
settle()
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
	[find_test_id('save-as'), textOf('save-notice-title')],
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
await waitUntil(() => textOf('save-as-folder') === menuDirectory, 'the chosen folder')
press(textOf('save-as-folder') === menuDirectory ? 'enter' : 'escape')
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
const untitledFolder = mkdtempSync(join(tmpdir(), 'eg-untitled-'))
/**
 * every file in `folder` with its modification time; the sockets folder is left out, since the previous file's
 * listener closing changes it, not a save
 */
const folderSnapshot = (folder: string) =>
	readdirSync(folder)
		.sort()
		.filter((name) => statSync(join(folder, name)).isFile())
		.map((name) => [name, statSync(join(folder, name)).mtimeMs])
documentController.load('Untitled draft\n', {
	...menuOptions,
	chooseFolder: () => Promise.resolve(untitledFolder)
})
settle()
const menuFolderBefore = folderSnapshot(menuDirectory)
click_test_id('block-0')
type('u')
press('escape')
await wait(1500)
settle()
check(
	'an untitled Document with an edit writes no file 1.5s later, shows no save label and no Save As',
	[
		documentController.text,
		readdirSync(untitledFolder),
		folderSnapshot(menuDirectory),
		documentController.label,
		find_test_id('save-status'),
		find_test_id('save-as')
	],
	['Untitled draftu\n', [], menuFolderBefore, '', null, null]
)
rmSync(untitledFolder, { recursive: true, force: true })

/**
 * the Agent legend, as editmd's (web/src/highlights.ts `Legend`, style.css `.agent-legend`): a write nobody
 * reported is Outside edit, then Claude changes two Blocks below the fold and Codex one. the file has forty
 * fillers, so revealing a Block has to scroll
 */
const legendPath = join(menuDirectory, 'legend.md')
const legendFiller = Array.from({ length: 40 }, (_value, index) => `Filler paragraph ${index + 1}.`)
/** the legend file, each filler numbered in `changes` replaced by its new text */
function legendText(changes: Record<number, string>): string {
	return `# Plan\n\n${legendFiller.map((line, index) => changes[index + 1] ?? line).join('\n\n')}\n`
}
/** an Agent hook's Report that it is about to edit the legend file */
async function reportLegendEdit(session: string, environment: Record<string, string>) {
	await reportEdit(
		JSON.stringify({
			session_id: session,
			cwd: menuDirectory,
			hook_event_name: 'PreToolUse',
			tool_input: { file_path: legendPath }
		}),
		environment,
		join(menuDirectory, 's')
	)
}
const outsideChange = { 2: 'Changed outside.' }
const claudeChanges = { ...outsideChange, 20: 'Twenty, by Claude.', 34: 'Thirty-four, by Claude.' }
writeFileSync(legendPath, legendText({}))
documentController.open(legendPath, menuOptions)
await wait(100)
writeFileSync(legendPath, legendText(outsideChange))
await waitUntil(() => documentController.highlights.length === 1, 'the outside edit')
await reportLegendEdit('abc', {})
writeFileSync(legendPath, legendText(claudeChanges))
await waitUntil(() => documentController.highlights.length === 3, 'Claude’s two Blocks')
await reportLegendEdit('def', { EDITMD_AGENT_NAME: 'Codex' })
writeFileSync(legendPath, legendText({ ...claudeChanges, 8: 'Eight, by Codex.' }))
await waitUntil(() => documentController.highlights.length === 4, 'Codex’s Block')
settle()

const claudeName = `Claude · ${basename(menuDirectory)}`
/** what each legend row paints, top to bottom: its name and its count */
function legendRows() {
	const rows: [string | undefined, string | undefined][] = []
	for (let index = 0; find_test_id(`legend-row-${index}`); index++) {
		rows.push([textOf(`legend-name-text-${index}`), textOf(`legend-count-${index}`)])
	}
	return rows
}
check(
	'the legend lists each Agent with its count of changes, in order of arrival and Outside edit last',
	[textOf('legend-header'), legendRows()],
	[
		'AGENTS',
		[
			[claudeName, '2'],
			['Codex', '1'],
			['Outside edit', '1']
		]
	]
)
check(
	'each row has editmd’s minimize –, its × and a Clear all below',
	[
		textOf('legend-minimize'),
		[0, 1, 2].map((index) => textOf(`legend-clear-${index}`)),
		textOf('legend-clear-all')
	],
	['–', ['×', '×', '×'], 'Clear all']
)
const legendPalette = themeController.palette
check(
	'each Agent’s dot is its slot’s colour, and Outside edit takes agent-unknown, on its changed text too',
	[
		[0, 1, 2].map((index) => find_test_id(`legend-dot-${index}`)?.style?.backgroundColor),
		// its paragraph kept its kind, so the change is washed as its changed text (`changedRunsOf`), not the Block
		(() => {
			const washes = propOf('block-2', 'highlight')
			return Array.isArray(washes) ? fieldOf(washes.at(-1), 'activeColor') : null
		})()
	],
	[
		[legendPalette['agent-0'], legendPalette['agent-1'], legendPalette['agent-unknown']],
		legendPalette['agent-unknown-change']
	]
)

/**
 * the painted width of the legend's first ×, a <text> with no size of its own: its width follows its font size,
 * where its height is the legend's line height, which zooms on its own
 */
const clearWidth = () => bounds(find_test_id('legend-clear-0') ?? 0)?.width ?? 0
/** the node holding `testId` as a direct child */
const parentOf = (testId: string) =>
	find((node) => node.children?.some((child) => child.testId === testId) ?? false)
// the legend's root holds the rows; GPUI text takes its parent's size, so the × takes the size of the first ancestor that sets one
// a node that is not there reads `missing`, so "no size of its own" (`none`) needs the node present
const sizeOf = (node: TreeNode | null | undefined) =>
	node ? (node.style?.fontSize ?? 'none') : 'missing'
const legendSizes = () => [
	sizeOf(parentOf('legend-row-0')),
	sizeOf(find_test_id('legend-clear-0')),
	sizeOf(parentOf('legend-clear-0'))
]
const legendSizesBefore = legendSizes()
const clearWidthBefore = clearWidth()
press('cmd-=')
settle()
const legendSizesZoomed = legendSizes()
const clearWidthZoomed = clearWidth()
press('cmd-0')
settle()
check(
	'the legend’s text is editmd’s 12px, 13.2px after Cmd-=, and neither its × nor the button around it sets a size of its own',
	[legendSizesBefore, legendSizesZoomed],
	[
		[12, 'none', 'none'],
		[13.2, 'none', 'none']
	]
)
// GPUI text takes its parent's size, so the × follows the legend's own zoomed 12px, as editmd's `font: inherit`
// a glyph's width follows its font size, so the zoomed × is 1.1 times as wide, give or take subpixel rounding
const clearWidthRatio = clearWidthBefore > 0 ? clearWidthZoomed / clearWidthBefore : 0
check(
	'the legend’s × takes the legend’s text size, so Cmd-= scales its width by 1.1',
	[clearWidthBefore > 0, Math.abs(clearWidthRatio - 1.1) <= 0.03],
	[true, true]
)

/** whether Block `index` paints whole inside the 538px window */
function blockInView(index: number): boolean {
	const box = bounds(find_test_id(`block-${index}`) ?? 0)
	return box !== null && box.y >= 0 && box.y + box.height <= 538
}
// the first Block's top with the page unscrolled, where a reveal near the top has to stop
const unscrolledTop = bounds(find_test_id('block-0') ?? 0)?.y ?? Number.NaN
const claudeBlocksBefore = [blockInView(20), blockInView(34)]
clickIfPresent('legend-name-0')
settle()
const afterFirstReveal = [blockInView(20), blockInView(34)]
clickIfPresent('legend-name-0')
settle()
const afterSecondReveal = blockInView(34)
clickIfPresent('legend-name-0')
settle()
check(
	'clicking an Agent’s name scrolls to its next changed Block, cycling back to the first, and opens no editor',
	[
		claudeBlocksBefore,
		afterFirstReveal,
		afterSecondReveal,
		blockInView(20),
		find_test_id('block-editor')
	],
	[[false, false], [true, false], true, true, null]
)

/**
 * Block `index`'s top less the middle of the page on screen, from the menu bar's bottom to the 538px window's
 * bottom edge (the Scroller's own box is the whole column, which moves as it scrolls)
 */
function topFromMiddle(index: number): number {
	const box = bounds(find_test_id(`block-${index}`) ?? 0)
	const bar = bounds(find_test_id('menu-bar') ?? 0)
	return box && bar ? box.y - (bar.y + bar.height + 538) / 2 : Number.NaN
}
// the third click revealed Claude's first Block again; Outside edit's Block sits near the top
const revealedOffset = topFromMiddle(20)
clickIfPresent('legend-name-2')
settle()
// GPUI snaps both the Block's edges and the scroll offset to the 2x display's half-pixel grid, so within a pixel
check(
	'a revealed Block’s top meets the middle of the page, as editmd scrolls a change’s top to the window’s middle (`coordsAtPos(at).top` to `innerHeight / 2`), and a Block near the top stops the page at its top',
	[Math.abs(revealedOffset) <= 1, bounds(find_test_id('block-0') ?? 0)?.y],
	[true, unscrolledTop]
)

/** the text of the tip `tipId` once the pointer has rested on `testId` past the tip's delay, null when none shows */
async function tipAfterHover(testId: string, tipId: string): Promise<string | null> {
	const node = find_test_id(testId)
	if (!node) return `no ${testId}`
	// a node scrolled out of the window cannot be hovered, which fails the check rather than the run
	try {
		mouse_move(node)
	} catch (error) {
		return error instanceof Error ? error.message : String(error)
	}
	await wait(400)
	settle()
	return textOf(tipId) ?? null
}
// editmd titles a highlight "<name>, <time>" (web/src/highlights.ts:184, 214-216); this test's time is en-US in UTC
const outsideBlock = documentController.blocks[2]
const outsideHighlight = documentController.highlights.find(
	({ start, end }) =>
		outsideBlock !== undefined && start < outsideBlock.end && end > outsideBlock.start
)
const outsideTime = outsideHighlight
	? new Date(outsideHighlight.at).toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			timeZone: 'UTC'
		})
	: 'no highlight'
const outsideTip = await tipAfterHover('block-2', 'block-tooltip-2-tip')
const plainTip = await tipAfterHover('block-1', 'block-tooltip-1-tip')
check(
	'hovering a highlighted Block shows editmd’s tooltip, the Agent’s name and the time of the change; a Block with no highlight shows none',
	[outsideTip, /^Outside edit, \d{1,2}:\d{2}\s[AP]M$/.test(outsideTip ?? ''), plainTip],
	[`Outside edit, ${outsideTime}`, true, null]
)

// editmd's legend titles (web/src/highlights.ts:274, 284, 295, 300); Clear all has none
const legendTips = [
	await tipAfterHover('legend-minimize', 'legend-minimize-tooltip-tip'),
	await tipAfterHover('legend-name-0', 'legend-name-tooltip-0-tip'),
	await tipAfterHover('legend-name-2', 'legend-name-tooltip-2-tip'),
	await tipAfterHover('legend-clear-0', 'legend-clear-tooltip-0-tip')
]
await tipAfterHover('legend-clear-all', 'legend-clear-all-tip')
check(
	'the legend’s buttons show editmd’s tooltips: Minimize, the name’s reveal and rename, Outside edit’s reveal only, and the ×’s Clear <name>’s highlights; Clear all none',
	[legendTips, find_all((node) => node.testId?.endsWith('-tip') === true).length],
	[
		[
			'Minimize',
			'Show the next change. Double-click to rename.',
			'Show the next change',
			`Clear ${claudeName}'s highlights`
		],
		0
	]
)

/**
 * a double click on `testId`. headless GPUI reports every click with clickCount 1, so after a real
 * click the second one is dispatched as GPUI delivers it in a window, with clickCount 2
 */
function doubleClick(testId: string): void {
	click_test_id(testId)
	const node = find_test_id(testId)
	if (node) dispatch({ elementId: node.id, eventType: 'click', clickCount: 2 })
	settle()
}
if (find_test_id('legend-name-0')) doubleClick('legend-name-0')
check(
	'double-clicking an Agent’s name swaps it for a field holding the name',
	[find_test_id('legend-rename')?.type, propOf('legend-rename', 'value')],
	['input', claudeName]
)
retype(claudeName, 'planner')
press('enter')
settle()
check(
	'Return keeps the new name',
	[find_test_id('legend-rename'), legendRows()[0]],
	[null, ['planner', '2']]
)
await reportLegendEdit('abc', {})
writeFileSync(
	legendPath,
	legendText({ ...claudeChanges, 8: 'Eight, by Codex.', 30: 'Thirty, by Claude.' })
)
await waitUntil(() => documentController.highlights.length === 5, 'Claude’s third Block')
settle()
check('the new name sticks for the Agent’s later changes', legendRows()[0], ['planner', '3'])

/**
 * the rename field opens with the name selected, as editmd's `edit` selects it (highlights.ts:326-349): a key typed at
 * once replaces the whole name. headless GPUI sends no blur, so leaving the field is its blur event, as a window sends
 */
if (find_test_id('legend-name-0')) doubleClick('legend-name-0')
await wait(100)
pump()
type('k')
const typedOverName = propOf('legend-rename', 'value')
const renameField = find_test_id('legend-rename')
if (renameField) dispatch({ elementId: renameField.id, eventType: 'blur' })
settle()
const keptOnBlur = legendRows()[0]
if (find_test_id('legend-name-0')) doubleClick('legend-name-0')
await wait(100)
pump()
for (const key of 'planner') type(key)
press('enter')
settle()
check(
	'the rename field opens with the name selected, so a typed key replaces it; leaving the field keeps the typed name',
	[typedOverName, keptOnBlur, legendRows()[0]],
	['k', ['k', '3'], ['planner', '3']]
)

if (find_test_id('legend-name-0')) doubleClick('legend-name-0')
const renamingBeforeEscape = find_test_id('legend-rename') !== null
type('x')
press('escape')
settle()
check(
	'Escape drops the typing and keeps the name',
	[renamingBeforeEscape, find_test_id('legend-rename'), legendRows()[0]],
	[true, null, ['planner', '3']]
)
if (find_test_id('legend-name-2')) doubleClick('legend-name-2')
check('Outside edit has no name to change', find_test_id('legend-rename'), null)

clickIfPresent('legend-clear-1')
settle()
check(
	'× clears that Agent’s highlights only',
	[legendRows(), find_test_id('block-8')?.style?.borderColor],
	[
		[
			['planner', '3'],
			['Outside edit', '1']
		],
		undefined
	]
)

clickIfPresent('legend-minimize')
settle()
check(
	'minimize shrinks the legend to a pill of the dots and the total count',
	[
		find_test_id('legend-row-0'),
		[0, 1].map((index) => find_test_id(`legend-pill-dot-${index}`)?.style?.backgroundColor),
		textOf('legend-pill-count')
	],
	[null, [legendPalette['agent-0'], legendPalette['agent-unknown']], '4']
)
// editmd titles the pill "Show agents" and each dot with its Agent's name (highlights.ts:253,257)
const pillTip = await tipAfterHover('legend-pill-count', 'legend-pill-tooltip-tip')
const dotTips = [
	await tipAfterHover('legend-pill-dot-0', 'legend-pill-dot-tooltip-0-tip'),
	await tipAfterHover('legend-pill-dot-1', 'legend-pill-dot-tooltip-1-tip')
]
check(
	'the minimized pill’s tooltip says Show agents, and each dot’s names its Agent',
	[pillTip, dotTips],
	['Show agents', documentController.agents.map(({ name }) => name)]
)
/** whether a window opened now, reading the same store as this one, starts with its legend minimized */
function nextWindowMinimized(): boolean {
	const nextWindow = new DocumentController()
	nextWindow.load('', menuOptions)
	return nextWindow.legendMinimized
}
const minimizedInNextWindow = nextWindowMinimized()
clickIfPresent('legend-pill')
settle()
check(
	'clicking the pill shows the rows again',
	[find_test_id('legend-pill'), legendRows()],
	[
		null,
		[
			['planner', '3'],
			['Outside edit', '1']
		]
	]
)
check(
	'the minimized legend is remembered for the next window, as editmd keeps it in localStorage, and so is showing it again',
	[minimizedInNextWindow, nextWindowMinimized()],
	[true, false]
)
clickIfPresent('legend-clear-all')
settle()
check(
	'Clear all removes every highlight and the legend',
	[documentController.highlights.length, find_test_id('legend')],
	[0, null]
)

/**
 * Source mode, as editmd's `destroyRich` (web/src/editor.ts:313, 537-548): the highlights go with the rich editor,
 * so the legend hides, and a change merged while the source shows is not highlighted (`mergeNow`'s Source mode branch)
 */
const legendChanges = { ...claudeChanges, 8: 'Eight, by Codex.', 30: 'Thirty, by Claude.' }
writeFileSync(legendPath, legendText({ ...legendChanges, 5: 'Five, changed before Source mode.' }))
await waitUntil(() => documentController.highlights.length === 1, 'a change before Source mode')
settle()
const legendBeforeSource = find_test_id('legend') !== null
press('cmd-/')
settle()
const legendInSource = find_test_id('legend') !== null
writeFileSync(
	legendPath,
	legendText({
		...legendChanges,
		5: 'Five, changed before Source mode.',
		6: 'Six, changed in Source mode.'
	})
)
await waitUntil(() => documentController.text.includes('Six, changed'), 'a change in Source mode')
settle()
const legendAfterSourceMerge = find_test_id('legend') !== null
press('cmd-/')
settle()
const highlightedBlocks = find_all(
	(node) => /^block-\d+$/.test(node.testId ?? '') && node.style?.borderColor !== undefined
)
check(
	'Cmd-/ hides the legend and drops the highlights, a change merged in Source mode is not highlighted, and Cmd-/ again paints no highlight',
	[
		legendBeforeSource,
		legendInSource,
		legendAfterSourceMerge,
		documentController.highlights.length,
		find_test_id('legend') !== null,
		highlightedBlocks.length
	],
	[true, false, false, 0, false, 0]
)

/**
 * a Block removed on disk, as editmd marks a `deleted` change between Blocks (changes.ts:41-44, highlights.ts:189-208,
 * style.css:494-498): a 2px line in the Agent's colour at 70% (its dashes measured further down) with its 0.2rem
 * margins, between the Blocks around it, titled "Deleted by <name>, <time>:" and the text; it counts in the legend
 */
const textWithTwelve = legendText({
	...legendChanges,
	5: 'Five, changed before Source mode.',
	6: 'Six, changed in Source mode.'
})
writeFileSync(legendPath, textWithTwelve.replace('Filler paragraph 12.\n\n', ''))
await waitUntil(() => documentController.deletions.length === 1, 'the removed twelfth filler')
settle()
const deletion = documentController.deletions[0]
const deletedName = documentController.agents.find(({ id }) => id === deletion?.author.id)?.name
const deletedTime = deletion
	? new Date(deletion.at).toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			timeZone: 'UTC'
		})
	: 'no deletion'
const deletedSlot = documentController.agents.find(({ id }) => id === deletion?.author.id)?.slot
// the legend's Reveal brings the line into the window: a Deletion's stop is the Block below it
clickIfPresent('legend-name-0')
settle()
const deletedLine = find_test_id('deleted-0')
const deletedBox = bounds(deletedLine ?? 0)
const aboveDeleted = bounds(find_test_id('block-11') ?? 0)
const belowDeleted = bounds(find_test_id('block-12') ?? 0)
const deletedTip = await tipAfterHover('deleted-0', 'deleted-tooltip-0-tip')
check(
	'a Block removed on disk leaves a 2px line in its Agent’s colour at 70% between the Blocks around it, titled as editmd titles a deletion, and counted in the legend',
	[
		documentController.sliceOf(
			documentController.blocks[12] ?? { kind: 'other', start: 0, end: 0 }
		),
		deletedLine?.style?.height,
		// the colour its svg dashes paint in
		deletedLine?.style?.color,
		deletedBox && aboveDeleted && belowDeleted
			? nearly(
					[
						deletedBox.y - aboveDeleted.y - aboveDeleted.height,
						belowDeleted.y - deletedBox.y - deletedBox.height,
						deletedBox.height
					],
					[16, 3.2, 2]
				)
			: null,
		deletedTip,
		legendRows()
	],
	[
		'Filler paragraph 13.',
		2,
		legendPalette[deletedSlot === null ? 'agent-unknown-deleted' : `agent-${deletedSlot}-deleted`],
		[16, 3.2, 2],
		`Deleted by ${deletedName}, ${deletedTime}:\nFiller paragraph 12.`,
		[[deletedName, '1']]
	]
)
/**
 * renames across windows, as editmd's `AgentEdits.rename` renames an Agent in every window (AgentEdits.swift:39-45):
 * each window is a process of its own, so a rename travels over the agent sockets every window listens on
 */
const renamedId = deletion?.author.id ?? 'no deletion'
await sendRename(menuOptions.socketsDirectory, { id: renamedId, name: 'Reviewer' })
await waitUntil(() => legendRows()[0]?.[0] === 'Reviewer', 'the rename from another window')
settle()
check(
	'a rename another window sends over the agent sockets renames the legend’s row here',
	legendRows(),
	[['Reviewer', '1']]
)
const renamesElsewhere: AgentRename[] = []
const otherWindow = await listenForReports(
	menuOptions.socketsDirectory,
	() => {},
	(rename) => void renamesElsewhere.push(rename)
)
if (find_test_id('legend-name-0')) doubleClick('legend-name-0')
retype('Reviewer', 'Editor')
press('enter')
settle()
await waitUntil(() => renamesElsewhere.length > 0, 'the rename reaching another window')
await otherWindow()
check(
	'a rename here reaches another window listening on the agent sockets',
	[legendRows(), renamesElsewhere],
	[[['Editor', '1']], [{ id: renamedId, name: 'Editor' }]]
)
// a window that opens now greets the others: this one answers with every name it knows, its own rename included
const namesForNewcomer: AgentRename[] = []
const newcomer = await listenForReports(
	menuOptions.socketsDirectory,
	() => {},
	(rename) => void namesForNewcomer.push(rename)
)
await greetPeers(menuOptions.socketsDirectory, newcomer.socket)
await waitUntil(() => namesForNewcomer.length > 1, 'this window’s answer to a newcomer’s greeting')
await newcomer()
// the names stay for the window's life, so the one learnt from the greeting check above is answered too
check(
	'a window opened later greets this one and gets back every name it knows, its own rename included',
	namesForNewcomer,
	[
		{ id: 'greet-session', name: 'Named elsewhere' },
		{ id: renamedId, name: 'Editor' }
	]
)

clickIfPresent('legend-clear-0')
settle()
const clearedByCross = [documentController.deletions.length, find_test_id('deleted-0')]
writeFileSync(legendPath, textWithTwelve)
await waitUntil(() => documentController.text.includes('Filler paragraph 12.'), 'the twelfth back')
writeFileSync(legendPath, textWithTwelve.replace('Filler paragraph 12.\n\n', ''))
await waitUntil(() => documentController.deletions.length === 1, 'the twelfth removed again')
const deletionsBeforeSource = documentController.deletions.length
press('cmd-/')
settle()
press('cmd-/')
settle()
check(
	'the legend’s × clears a Deletion line with its Agent’s highlights, and Source mode drops it as it drops them',
	[
		clearedByCross,
		deletionsBeforeSource,
		documentController.deletions.length,
		find_test_id('deleted-0')
	],
	[[0, null], 1, 0, null]
)

/**
 * a mermaid Block keeps its diagram under the field while it is edited, as editmd's diagrams.ts: re-rendered from
 * the field's text once typing pauses for 300ms, or its error when the text cannot be drawn
 */
documentController.load('```mermaid\nflowchart LR\n  A --> B\n```\n', menuOptions)
settle()
// what the closed Block paints, so the preview can be held to the same src
const closedDiagram = propOf('mermaid-0', 'src')
click_test_id('block-0')
settle()
const openedDiagram = propOf('mermaid-0', 'src')
const previewFieldBox = bounds(find_test_id('block-editor') ?? 0)
const previewImageBox = bounds(find_test_id('mermaid-0') ?? 0)
check(
	'an open mermaid Block shows its field and, below it, at once, the diagram the closed Block painted for the same source',
	[
		find_test_id('block-editor')?.type,
		find_test_id('mermaid-0')?.type,
		closedDiagram,
		openedDiagram,
		previewFieldBox !== null &&
			previewImageBox !== null &&
			previewImageBox.y >= previewFieldBox.y + previewFieldBox.height
	],
	[
		'textarea',
		'img',
		diagramSrcOf('flowchart LR\n  A --> B'),
		diagramSrcOf('flowchart LR\n  A --> B'),
		true
	]
)
// the box around the preview's image, editmd's `.code-block.mermaid.editing > .diagram`
const previewBox = find_test_id('mermaid-box-0')
check(
	'the live preview is bordered in the palette’s --border colour',
	[previewBox?.style?.borderColor, themeController.palette.border.length > 0],
	[themeController.palette.border, true]
)
// the caret starts after the closing fence: up to the last diagram line, then a new node on a line of its own
press('up')
press('cmd-right')
for (const key of ['enter', 'space', 'space', 'b', 'space', '-', '-', '-', 'space']) type(key)
settle()
// a pause shorter than 300ms, then the last key: the wait for a pause starts again from it
await wait(150)
settle()
type('c')
settle()
const diagramRightAfterTyping = propOf('mermaid-0', 'src')
await wait(150)
settle()
const diagramSoonAfterLastKey = propOf('mermaid-0', 'src')
await wait(300)
settle()
check(
	'typing a new node re-renders the diagram once typing pauses for 300ms: still the opened diagram 150ms after the last key, after a 150ms pause before it, then the new source’s diagram 450ms after it',
	[
		documentController.text,
		diagramRightAfterTyping,
		diagramSoonAfterLastKey,
		propOf('mermaid-0', 'src')
	],
	[
		'```mermaid\nflowchart LR\n  A --> B\n  b --- c\n```\n',
		diagramSrcOf('flowchart LR\n  A --> B'),
		diagramSrcOf('flowchart LR\n  A --> B'),
		diagramSrcOf('flowchart LR\n  A --> B\n  b --- c')
	]
)
for (const key of ['space', '-', '-', '-']) type(key)
await wait(400)
settle()
const undrawable = diagramOf(
	'flowchart LR\n  A --> B\n  b --- c ---',
	themeController.mermaidPalette
)
check(
	'text that cannot be drawn shows diagramOf’s message for it in the diagram’s place, the field staying',
	[
		undrawable.kind,
		propOf('mermaid-error-0', 'source'),
		find_test_id('mermaid-0'),
		find_test_id('block-editor')?.type
	],
	[
		'error',
		undrawable.kind === 'error' ? monoLinesSource(undrawable.message) : null,
		null,
		'textarea'
	]
)
press('escape')

// a fence with nothing in it is editmd's "Empty diagram", closed and while it is edited
documentController.load('```mermaid\n```\n', menuOptions)
settle()
const emptyClosed = [propOf('mermaid-empty-0', 'source'), find_test_id('mermaid-0')]
click_test_id('block-0')
settle()
check(
	'a blank mermaid fence paints editmd’s Empty diagram, closed and in the open Block’s preview',
	[emptyClosed, propOf('mermaid-empty-0', 'source'), find_test_id('block-editor')?.type],
	[['`Empty diagram`', null], '`Empty diagram`', 'textarea']
)
press('escape')

/**
 * the in-window menu bar in place of the one gpuix cannot extend (gap G2): editmd's six menus across the top of
 * the window, each a dropdown under its title that runs its items through the same commands as the shortcuts
 */
const MENU_TITLES = ['File', 'Edit', 'Format', 'View', 'Window', 'Help']

/** what a panel paints, row by row: an item's title and key glyphs, or `separator` */
function panelRows(prefix: 'menu' | 'submenu' = 'menu'): (string | [string, string])[] {
	const rows: (string | [string, string])[] = []
	for (let index = 0; find_test_id(`${prefix}-row-${index}`); index++) {
		const title = textOf(`${prefix}-item-title-${index}`)
		rows.push(
			title === undefined ? 'separator' : [title, textOf(`${prefix}-item-keys-${index}`) ?? '']
		)
	}
	return rows
}

/** the same rows from the model, for the menus as they stand for `state` */
function modelRows(items: readonly MenuBarItem[]): (string | [string, string])[] {
	return items.map((item) => (item.kind === 'separator' ? 'separator' : [item.title, item.keys]))
}

/** the model's menus for the Document as it stands, Open Recent's files from this test's store */
function modelMenus(): MenuBarMenu[] {
	return menuBar({
		sourceMode: documentController.sourceMode,
		remoteImagesAllowed: documentController.remoteImagesAllowed,
		recent: menuRecent.list(),
		hasFile: documentController.hasFile
	})
}

/** the row of the open panel titled `title`, -1 when there is none */
function rowIndexOf(title: string, prefix: 'menu' | 'submenu' = 'menu'): number {
	return panelRows(prefix).findIndex((row) => Array.isArray(row) && row[0] === title)
}

/** clicks the open panel's item titled `title`, if it paints */
function clickRow(title: string, prefix: 'menu' | 'submenu' = 'menu'): void {
	const index = rowIndexOf(title, prefix)
	if (index !== -1) clickIfPresent(`${prefix}-row-${index}`)
	settle()
}

/** opens menu `title` by clicking it in the bar */
function openMenu(title: string): void {
	clickIfPresent(`menu-title-${MENU_TITLES.indexOf(title)}`)
	settle()
}

const barHostPath = join(menuDirectory, 'host.md')
writeFileSync(barHostPath, 'Host.\n')
documentController.load('First.\n\nSecond.\n', menuOptions)
settle()
check(
	'the menu bar paints editmd’s six menu titles in order',
	MENU_TITLES.map((_title, index) => textOf(`menu-title-text-${index}`)),
	MENU_TITLES
)

const barBox = bounds(find_test_id('menu-bar') ?? 0)
const firstUnderBar = bounds(find_test_id('block-0') ?? 0)
check(
	'the document’s first Block paints below the bar',
	[
		barBox !== null && barBox.y === 0,
		barBox !== null && firstUnderBar !== null && firstUnderBar.y >= barBox.y + barBox.height
	],
	[true, true]
)

openMenu('File')
check(
	'clicking File paints editmd’s File items in order, each with its key glyphs',
	panelRows(),
	modelRows(modelMenus()[0]?.items ?? [])
)
clickRow('Save As…')
check(
	'choosing Save As… from File opens the Save As dialog and closes the menu',
	[find_test_id('save-as') !== null, find_test_id('menu-panel')],
	[true, null]
)
// the untitled Document's dialog is on ~/Documents: Escape writes nothing
press('escape')
settle()

openMenu('Format')
const textBeforeMenuBold = documentController.text
const boldIndex = rowIndexOf('Bold')
const boldColour = find_test_id(`menu-row-${boldIndex}`)?.style?.color
clickRow('Bold')
check(
	'clicking the greyed Bold changes nothing and leaves the menu open',
	[boldColour, documentController.text, find_test_id('menu-panel') !== null],
	[themeController.palette.faint, textBeforeMenuBold, true]
)
press('escape')
settle()

openMenu('Edit')
clickRow('Find')
clickRow('Find…', 'submenu')
check(
	'Edit > Find ▸ Find… shows the find bar and closes the menu',
	[find_test_id('find-bar') !== null, find_test_id('menu-panel')],
	[true, null]
)
press('escape')
settle()

menuRuns.length = 0
for (const title of ['Minimize', 'Zoom', 'Bring All to Front']) {
	openMenu('Window')
	clickRow(title)
}
check(
	'Window > Minimize, Zoom and Bring All to Front call the window’s minimize, zoom and activate once each',
	[menuRuns, find_test_id('menu-panel')],
	[
		[
			['minimize', []],
			['zoomWindow', []],
			['activateWindow', []]
		],
		null
	]
)

const recentA = join(menuDirectory, 'recent-a.md')
const recentB = join(menuDirectory, 'recent-b.md')
writeFileSync(recentA, '# A\n')
writeFileSync(recentB, '# B\n')
menuRecent.clear()
menuRecent.add(recentA)
menuRecent.add(recentB)
// an opened file, so a recent one opens through the opener rather than into this window
documentController.open(barHostPath, menuOptions)
settle()
openMenu('File')
clickRow('Open Recent')
const recentRows = panelRows('submenu')
menuWindows.length = 0
clickRow('recent-a.md', 'submenu')
// a new window starts once the other windows said none of them has the file (`focusWindowFor`)
await waitUntil(() => menuWindows.length > 0, 'the recent file’s window')
check(
	'File > Open Recent ▸ lists the store’s files by name, and choosing one opens it through the opener',
	[recentRows, menuWindows, find_test_id('menu-panel')],
	[[['recent-b.md', ''], ['recent-a.md', ''], 'separator', ['Clear Menu', '']], [recentA], null]
)
openMenu('File')
clickRow('Open Recent')
clickRow('Clear Menu', 'submenu')
const recentAfterClear = menuRecent.list()
openMenu('File')
clickRow('Open Recent')
check(
	'Open Recent ▸ Clear Menu empties the list, leaving only Clear Menu',
	[recentAfterClear, panelRows('submenu')],
	[[], [['Clear Menu', '']]]
)
press('escape')
settle()

openMenu('File')
const viewTitle = find_test_id('menu-title-3')
if (viewTitle) mouse_move(viewTitle)
settle()
check(
	'with the File menu open, hovering View switches the panel to View’s items',
	panelRows(),
	modelRows(modelMenus()[3]?.items ?? [])
)
const menuShownBeforeEscape = find_test_id('menu-panel') !== null
press('escape')
settle()
check(
	'Escape closes the open menu',
	[menuShownBeforeEscape, find_test_id('menu-panel')],
	[true, null]
)

openMenu('Edit')
const menuShownBeforePalette = find_test_id('menu-panel') !== null
press('cmd-shift-/')
settle()
check(
	'Cmd-Shift-/ while a menu is open opens the command palette and closes the menu',
	[menuShownBeforePalette, find_test_id('command-palette') !== null, find_test_id('menu-panel')],
	[true, true, null]
)
press('escape')
settle()

documentController.load('Para\n', menuOptions)
settle()
documentController.run('toggleSource')
settle()
openMenu('View')
const sourceViewFirst = panelRows()[0]
// the pointer onto Format would switch to it first, and a click on the open title closes it, so View closes here
press('escape')
settle()
openMenu('Format')
const sourceFormatColours = panelRows().flatMap((row, index) =>
	row === 'separator' ? [] : [find_test_id(`menu-row-${index}`)?.style?.color]
)
const sourceBeforeHeading = documentController.text
clickRow('Heading 1')
check(
	'in Source mode View’s first item reads Show Rendered Markdown and every Format item is greyed and inert',
	[
		sourceViewFirst,
		sourceFormatColours.length > 0 &&
			sourceFormatColours.every((colour) => colour === themeController.palette.faint),
		documentController.text,
		find_test_id('menu-panel') !== null
	],
	[['Show Rendered Markdown', '⌘/'], true, sourceBeforeHeading, true]
)
press('escape')
settle()
documentController.run('toggleSource')
settle()

click_test_id('block-0')
openMenu('Help')
const helpPlaceholder = propOf('help-search', 'placeholder')
for (const key of ['h', 'e', 'a', 'd', 'space', '2']) type(key)
settle()
const helpResults: [string | undefined, string | undefined][] = []
for (let index = 0; find_test_id(`help-result-${index}`); index++) {
	helpResults.push([textOf(`help-result-title-${index}`), textOf(`help-result-keys-${index}`)])
}
press('enter')
settle()
check(
	'Help’s search lists exactly Format ▸ Heading 2 for `head 2`, and Return applies it to the Active block',
	[helpPlaceholder, helpResults, documentController.text, find_test_id('menu-panel')],
	['Search', [['Format ▸ Heading 2', '⌥⌘2']], '## Para\n', null]
)
press('escape')

/** types `query` into Help's search, one key per call so it stays literal, and reads back every match row */
function helpSearch(query: string): [string | undefined, string | undefined, string | undefined][] {
	openMenu('Help')
	for (const character of query) type(character === ' ' ? 'space' : character)
	settle()
	const rows: [string | undefined, string | undefined, string | undefined][] = []
	for (let index = 0; find_test_id(`help-result-${index}`); index++) {
		const colour = find_test_id(`help-result-${index}`)?.style?.color
		rows.push([
			textOf(`help-result-title-${index}`),
			textOf(`help-result-keys-${index}`),
			typeof colour === 'string' ? colour : undefined
		])
	}
	return rows
}

/**
 * macOS's menu search covers the whole bar (`searchMenuBar`), not the palette's entries: an item AppKit adds
 * (View's Enter Full Screen) is found under its menu, and Return does what clicking it in the bar does
 */
menuRuns.length = 0
const fullScreenRows = helpSearch('full')
press('enter')
settle()
check(
	'Help’s search finds View ▸ Enter Full Screen with ⌃⌘F, and Return toggles full screen as the menu item does',
	[fullScreenRows.map(([title, keys]) => [title, keys]), menuRuns, find_test_id('menu-panel')],
	[[['View ▸ Enter Full Screen', '⌃⌘F']], [['toggleFullScreen', []]], null]
)

/**
 * a submenu's items show their whole path (File ▸ Open Recent ▸ file), and clicking one opens that file through
 * the opener; a disabled item (Edit ▸ Copy, which only the focused field can do) is listed greyed and runs nothing
 */
menuRecent.clear()
menuRecent.add(recentA)
menuWindows.length = 0
const recentHelpRows = helpSearch('recent-a')
clickIfPresent('help-result-0')
settle()
// a new window starts once the other windows said none of them has the file (`focusWindowFor`)
await waitUntil(() => menuWindows.length > 0, 'the recent file’s window')
const recentHelpWindows = [...menuWindows]
const copyHelpRows = helpSearch('copy')
const textBeforeCopy = documentController.text
press('enter')
settle()
check(
	'Help’s search lists File ▸ Open Recent ▸ recent-a.md and opens it on a click; Edit ▸ Copy shows greyed and Return leaves the menu open',
	[
		recentHelpRows.map(([title]) => title),
		recentHelpWindows,
		copyHelpRows,
		documentController.text === textBeforeCopy,
		find_test_id('menu-panel') !== null
	],
	[
		['File ▸ Open Recent ▸ recent-a.md'],
		[recentA],
		[['Edit ▸ Copy', '⌘C', themeController.palette.faint]],
		true,
		true
	]
)
press('escape')
settle()

/**
 * Format > Link… (⌘K) is editmd's Add Link sheet (EditorWindowController.swift:115-150): an NSAlert titled Add Link
 * with "Enter the URL for the selected text.", a field with the https:// placeholder prefilled with the pasteboard's
 * URL, and Add (the default) then Cancel, which paint right to left
 */
documentController.load('See\n', menuOptions)
settle()
click_test_id('block-0')
type('s')
menuClipboardUrl = 'https://example.com/a'
press('cmd-k')
settle()
const addLinkShown = [
	textOf('add-link-title'),
	textOf('add-link-message'),
	propOf('add-link-url', 'placeholder'),
	propOf('add-link-url', 'value'),
	textOf('add-link-cancel-label'),
	textOf('add-link-add-label')
]
press('enter')
// the field's caret is read when Add is pressed, here at the end of the typed `s`
await fieldIdle()
const addedLinkText = documentController.text
const addedLinkField = propOf('block-editor', 'value')
press('escape')
press('cmd-z')
check(
	'Cmd-K shows Add Link prefilled from the pasteboard, and Return adds the URL as a link at the field’s caret, an Undo step of its own that one Undo takes back, the typing before it kept',
	[addLinkShown, addedLinkText, addedLinkField, find_test_id('add-link'), documentController.text],
	[
		[
			'Add Link',
			'Enter the URL for the selected text.',
			'https://',
			'https://example.com/a',
			'Cancel',
			'Add'
		],
		'Sees<https://example.com/a>\n',
		'Sees<https://example.com/a>',
		null,
		'Sees\n'
	]
)

// Escape is Cancel; an empty pasteboard leaves the field empty; Source mode disables Link… with the rest of Format
click_test_id('block-0')
menuClipboardUrl = null
press('cmd-k')
settle()
const emptyPrefill = propOf('add-link-url', 'value')
press('escape')
settle()
const afterCancel = [find_test_id('add-link'), documentController.text]
press('escape')
documentController.run('toggleSource')
settle()
press('cmd-k')
settle()
const sheetInSource = find_test_id('add-link')
documentController.run('toggleSource')
settle()
check(
	'Escape cancels Add Link and changes nothing, an empty pasteboard prefills nothing, and Cmd-K in Source mode opens no sheet',
	[emptyPrefill, afterCancel, sheetInSource],
	['', [null, 'Sees\n'], null]
)

/**
 * editmd's caret sits at the Document's start once it loads, so Link… with no Active block puts the link at the start
 * of the first Block's text (`firstTextOffset`), and the field opens on it
 */
documentController.load('First\n\nSecond\n', menuOptions)
settle()
menuClipboardUrl = 'https://example.com/b'
press('cmd-k')
settle()
press('enter')
settle()
check(
	'Link… with no Active block adds the link at the start of the first Block’s text, whose field opens on it',
	[documentController.text, documentController.activeIndex, propOf('block-editor', 'value')],
	['<https://example.com/b>First\n\nSecond\n', 0, '<https://example.com/b>First']
)
press('escape')

/**
 * a drag over painted text selects it and leaves the Block closed, as editmd keeps a selection; Edit > Copy is
 * enabled while text is selected, and it and ⌘C outside a field put the selection on the pasteboard (`writeClipboard`,
 * a recorder here, never the real pasteboard)
 */
const copied: string[] = []
documentController.load('Copy these words from the page.\n\nSecond\n', {
	...menuOptions,
	writeClipboard: (text: string) => {
		copied.push(text)
		return true
	}
})
settle()
const copyItemEnabled = () =>
	documentController.menus
		.find(({ title }) => title === 'Edit')
		?.items.find((item) => item.kind === 'item' && item.title === 'Copy')
const copyEnabledBefore = copyItemEnabled()
const copyText = bounds(find_test_id('block-0')?.children?.[0] ?? 0)
const dragged = copyText
	? drag_select(
			{ x: copyText.x + 2, y: copyText.y + copyText.height / 2 },
			{ x: copyText.x + 120, y: copyText.y + copyText.height / 2 }
		)
	: null
settle()
const afterDrag = [documentController.activeIndex, find_test_id('block-editor')]
const copyEnabledAfter = copyItemEnabled()
press('cmd-c')
settle()
check(
	`a drag over a Block’s text selects it and opens no field; Copy is enabled then, and ⌘C copies the selection (${dragged})`,
	[
		copyEnabledBefore?.kind === 'item' && copyEnabledBefore.enabled,
		typeof dragged === 'string' && dragged.length > 0,
		afterDrag,
		copyEnabledAfter?.kind === 'item' && copyEnabledAfter.enabled,
		copied
	],
	[false, true, [null, null], true, [dragged]]
)
click_test_id('block-1')
check('a click on a Block after a selection still opens it', documentController.activeIndex, 1)
press('escape')

/** whether File's Revert to Saved paints greyed in the menu bar's File menu */
function revertGreyed(): boolean {
	openMenu('File')
	const colour = find_test_id(`menu-row-${rowIndexOf('Revert to Saved')}`)?.style?.color
	press('escape')
	settle()
	return colour === themeController.palette.faint
}
const revertHostPath = join(menuDirectory, 'revert-host.md')
writeFileSync(revertHostPath, 'Revert host.\n')
documentController.open(revertHostPath, menuOptions)
settle()
const cleanFileRevert = revertGreyed()
click_test_id('block-0')
type('r')
press('escape')
settle()
const editedFileRevert = revertGreyed()
documentController.load('Draft.\n', menuOptions)
settle()
click_test_id('block-0')
type('u')
press('escape')
settle()
const editedUntitledRevert = revertGreyed()
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
 * the title says Edited while the Document has unsaved edits, as NSDocument's does: "<name> — Edited" (AppKit's
 * AutosaveButton.loctable "Edited" after Document.loctable's " — "), and the plain name once an autosave clears it
 */
const titledPath = join(menuDirectory, 'titled.md')
writeFileSync(titledPath, 'Titled\n')
documentController.open(titledPath, menuOptions)
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
 * a failed save, as editmd's SaveStatusView (EditorWindowController.swift:331-367): Not Saved in the palette's danger
 * colour (editmd's systemRed) with its reason as the tooltip, in the small system font; an autosave failure shows no
 * alert, as in editmd
 */
const statusPath = join(menuDirectory, 'status.md')
writeFileSync(statusPath, 'Status\n')
documentController.open(statusPath, menuOptions)
settle()
chmodSync(statusPath, 0o444)
/**
 * Foundation's sentence for a file it may not write (FoundationErrors.loctable, Err513), when the file is read-only
 * indeed: editmd's tooltip is the save error's `localizedDescription`
 */
function writeRefusal(path: string): string {
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
const statusTip = await tipAfterHover('save-status', 'save-status-tooltip-tip')
check(
	'an autosave that fails paints Not Saved in the danger colour at the small system size, its reason as the tooltip, and no alert',
	[
		textOf('save-status'),
		find_test_id('save-status')?.style?.color,
		find_test_id('save-status')?.style?.fontSize,
		statusTip,
		find_test_id('save-failed')
	],
	[
		'Not Saved',
		themeController.palette.danger,
		11,
		labelDetail({ kind: 'failed', message: writeRefusal(statusPath) }),
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
	statusBox ? nearly([800 - statusBox.x - statusBox.width], [10]) : null,
	[10]
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
	[textOf('save-locked-title'), textOf('save-locked-message')],
	[
		'The document “status.md” could not be saved. The file is locked.',
		'Do you want to save your changes to it anyway?'
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
/**
 * polled every 10ms from the moment the label empties, not sampled once: one sample can land past the 0.4s fade
 * under load (it failed 1 run in 7). the first poll that sees the label empty records what still paints
 */
let fadingText: string | null = null
let fadingMotion: unknown = undefined
for (const deadline = Date.now() + 5000; Date.now() < deadline; await wait(10)) {
	settle()
	if (documentController.label !== '') continue
	fadingText = textOf('save-status') ?? null
	fadingMotion = find_test_id('save-status')?.customProps?.motion
	break
}
await wait(600)
settle()
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
writeFileSync(remotePath, '![tracker](https://example.com/p.png)\n')
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
	[documentController.folder, propOf('image-0-0', 'src'), find_test_id('image-blocked-0-0')],
	[menuDirectory, 'https://example.com/p.png', null]
)

rmSync(menuDirectory, { recursive: true, force: true })

// rendering parity: each row's fixture (test/fixtures/parity) painted as editmd paints it
const parityDirectory = mkdtempSync(join(tmpdir(), 'eg-parity-'))
const parityOptions = { recentFiles: new RecentFiles(join(parityDirectory, 'recent.json')) }

/** a parity row's fixture text */
function fixture(id: string): string {
	return readFileSync(join(import.meta.dirname, 'test', 'fixtures', 'parity', `${id}.md`), 'utf8')
}

// row r-definitions: a link with no text shows its source, as editmd's `a.empty-link::before`
documentController.load(fixture('r-definitions'), parityOptions)
settle()
check(
	'an empty link `[](url)` paints its own source after the text before it',
	painted()
		.split('\n')
		.filter((line) => line.startsWith('A reference')),
	['A reference link and an empty link [](https://example.com/empty).']
)

/**
 * row r-page: editmd's `#editor { max-width: 46rem; margin: 0 auto; padding: 3rem 2.5rem 40vh }`, a column at
 * most 736px wide, centred, its Blocks 48px from its top and 40px from its sides, and 40% of the window's height
 * empty below the last Block. per window width: the first Block's x and width, its y below the page's top, and,
 * scrolled to the end, the space between the last Block and the window's bottom edge
 */
function pageLayout(width: number) {
	const first = bounds(find_test_id('block-0') ?? 0)
	const page = bounds(find_test_id('page-scroller') ?? 0)
	wheel({ x: width / 2, y: 300 }, 0, -100_000)
	settle()
	const last = bounds(find_test_id(`block-${documentController.blocks.length - 1}`) ?? 0)
	if (!first || !last || !page) return null
	return {
		width,
		x: first.x,
		blockWidth: first.width,
		top: first.y - page.y,
		below: Math.round((page.y + page.height - last.y - last.height) * 10) / 10
	}
}
const pageLayouts: ReturnType<typeof pageLayout>[] = []
for (const width of [1000, 600]) {
	await app.unmount()
	app = mount_headless(App, { width, height: 538 })
	documentController.load(fixture('render'), parityOptions)
	settle()
	pageLayouts.push(pageLayout(width))
}
check(
	'the page is a centred column at most 736px wide with 48px above and 40px beside its Blocks, and 40% of the window height below them',
	pageLayouts,
	[
		// 40% of the 538px window is 215.2px, which GPUI's half-pixel grid paints at 215
		{
			width: 1000,
			x: (1000 - 736) / 2 + 40,
			blockWidth: 736 - 80,
			top: 48,
			below: toHalfPixels(538 * 0.4)
		},
		{ width: 600, x: 40, blockWidth: 600 - 80, top: 48, below: toHalfPixels(538 * 0.4) }
	]
)
await app.unmount()
app = mount_headless(App, { width: 800, height: 538 })

/** the space painted between each Block and the one after it, from their bounds */
function blockGaps(): number[] {
	const boxes = documentController.blocks.map((_block, index) =>
		bounds(find_test_id(`block-${index}`) ?? 0)
	)
	return boxes.slice(1).map((box, index) => {
		const above = boxes[index]
		return box && above ? box.y - above.y - above.height : Number.NaN
	})
}

/** each measured gap, shown as the wanted one where GPUI's half-pixel grid keeps it within half a pixel of it */
function nearly(measured: number[], wanted: number[]): number[] {
	return measured.map((gap, index) => {
		const want = wanted[index] ?? Number.NaN
		return Math.abs(gap - want) <= 0.5 ? want : gap
	})
}

/**
 * rows r-headings and r-hr: editmd's block margins collapse as CSS margins do, the larger of a Block's bottom and
 * the next one's top. body Blocks `margin: 0 0 1em`, headings `1.6em 0 0.6em` in their own em (h1 33.6px, h2
 * 24.8, h3 20, h4 16.8, h5 15.2, h6 14.4), a rule `2em 0`
 */
documentController.load(fixture('r-headings'), parityOptions)
settle()
const headingGaps = blockGaps()
const headingWanted = [20.16, 39.68, 14.88, 32, 26.88, 24.32, 23.04, 8.64]
documentController.load(fixture('r-hr'), parityOptions)
settle()
const ruleGaps = blockGaps()
check(
	'the space between Blocks is editmd’s collapsed margins: under h1 20.16, above h2 39.68, under h2 14.88, above h3-h6 32/26.88/24.32/23.04, under h6 8.64, 32 either side of a rule',
	[nearly(headingGaps, headingWanted), nearly(ruleGaps, [32, 32])],
	[headingWanted, [32, 32]]
)

/**
 * row r-headings: editmd rules off h1 and h2 (`padding-bottom: 0.25em` and `0.2em` in their own em, then
 * `border-bottom: 1px solid var(--border)`), and no other heading. per heading: its rule's colour, width and the
 * padding above it, and the Block's height, the 42px and 31px heading lines plus padding and rule
 */
documentController.load(fixture('r-headings'), parityOptions)
settle()
const headingRules = [0, 2, 4].map((index) => {
	const style = find_test_id(`heading-rule-${index}`)?.style
	return style
		? [style.borderColor, style.borderBottomWidth, style.paddingBottom]
		: bounds(find_test_id(`block-${index}`) ?? 0)?.height
})
const ruledHeights = [0, 2].map((index) => bounds(find_test_id(`block-${index}`) ?? 0)?.height ?? 0)
check(
	'h1 and h2 paint editmd’s bottom rule in the border colour under 0.25em and 0.2em of padding; h3 paints none',
	[headingRules, nearly(ruledHeights, [42 + 8.4 + 1, 31 + 4.96 + 1])],
	[
		[[themeController.palette.border, 1, 8.4], [themeController.palette.border, 1, 4.96], 25],
		[42 + 8.4 + 1, 31 + 4.96 + 1]
	]
)

/**
 * row r-headings: native <markdown> sizes h4, h5 and h6 as one tier, so h5 (0.95em) and h6 (0.9em, muted) get a
 * theme of their own whose fourth tier is their size, line-height 1.25, and h6's text the muted colour
 */
const tierOf = (index: number) => {
	const blockTheme = find_test_id(`block-${index}`)?.children?.[0]?.customProps?.theme
	const metrics = fieldOf(blockTheme, 'metrics')
	const sizes = fieldOf(metrics, 'mdHeadingSizes')
	const lineHeights = fieldOf(metrics, 'mdHeadingLineHeights')
	return [
		Array.isArray(sizes) ? sizes[3] : null,
		Array.isArray(lineHeights) ? lineHeights[3] : null,
		fieldOf(blockTheme, 'text')
	]
}
check(
	'h4 paints at 16.8px, h5 at 15.2px and h6 at 14.4px in the muted colour, each with line-height 1.25',
	[5, 6, 7].map(tierOf),
	[
		[16.8, 21, themeController.palette.text],
		[15.2, 19, themeController.palette.text],
		[14.4, 18, themeController.palette.muted]
	]
)

/**
 * row r-tasks: a ticked item's text is muted and struck through (editmd `li[data-checked="true"] > p`); the
 * painted source wraps it in `~~` and its theme's text is the muted colour, the Document keeping its text
 */
documentController.load(fixture('r-tasks'), parityOptions)
settle()
const taskTexts = find_all((node) => node.type === 'markdown').map((node) => [
	node.customProps?.source,
	fieldOf(node.customProps?.theme, 'text')
])
check(
	'a ticked task paints `~~done~~` in the muted colour, the open ones as written in the text colour, and the Document is unchanged',
	[taskTexts, documentController.text],
	[
		[
			['todo', themeController.palette.text],
			['~~done~~', themeController.palette.muted],
			['another todo', themeController.palette.text]
		],
		fixture('r-tasks')
	]
)

/**
 * row r-quote: editmd's `blockquote { padding: 0 1em; color: var(--muted); border-left: 0.25em solid
 * var(--border) }`, no fill: a 4px rail in the border colour, 16px either side of the text, the quote's markdown
 * without its `>` markers in a muted theme
 */
documentController.load(fixture('r-quote'), parityOptions)
settle()
const quoteStyle = find_test_id('quote-0')?.style
const quoteText = find_test_id('quote-text-0')?.customProps
check(
	'a quote paints a 4px rail in the border colour, 16px padding and no fill, its text unquoted in the muted colour',
	[
		quoteStyle?.borderColor,
		quoteStyle?.borderLeftWidth,
		quoteStyle?.paddingLeft,
		quoteStyle?.paddingRight,
		quoteStyle?.backgroundColor ?? null,
		quoteText?.source,
		fieldOf(quoteText?.theme, 'text')
	],
	[
		themeController.palette.border,
		4,
		16,
		16,
		null,
		'A quote\nover two lines',
		themeController.palette.muted
	]
)

/**
 * row r-code: editmd's `pre` has no border and no header bar, its language a lowercase 11px label in the faint
 * colour (style.css:193-220): the card paints the code between the fences through a native <code>, which has no
 * header bar, and the label beside it (its place and the card are measured further down)
 */
documentController.load(fixture('r-code'), parityOptions)
settle()
check(
	'a code block paints the code between its fences, and `js` in faint 11px',
	[
		propOf('code-0', 'code'),
		textOf('code-label-0'),
		find_test_id('code-label-0')?.style?.color,
		find_test_id('code-label-0')?.style?.fontSize
	],
	[
		'const x = 1 < 2;\nfunction add(a, b) {\n  return a + b;\n}',
		'js',
		themeController.palette.faint,
		11
	]
)

// row r-image: editmd rounds an image's corners, `img { border-radius: 4px }`; the row's picture is 300 × 200
writeFileSync(join(parityDirectory, 'pic.png'), png(300, 200))
writeFileSync(join(parityDirectory, 'r-image.md'), fixture('r-image'))
documentController.open(join(parityDirectory, 'r-image.md'), {
	...parityOptions,
	socketsDirectory: join(parityDirectory, 's')
})
settle()
check(
	'an image paints with editmd’s 4px corner radius',
	[find_test_id('image-0-0')?.type, find_test_id('image-0-0')?.style?.borderRadius],
	['img', 4]
)
// narrower than the 656px column, editmd's `img { max-width: 100% }` leaves it at its natural size
const parityImageBox = bounds(find_test_id('image-0-0') ?? 0)
check(
	'r-image paints its 300 × 200 picture at its natural size',
	parityImageBox ? [parityImageBox.width, parityImageBox.height] : null,
	[300, 200]
)

/**
 * row r-image-remote: editmd's blocked image (`.remote-image`, style.css:295-314) is a small box: a picture icon
 * and the alt text at 0.9em in the muted colour, a 1px border (dashed, which an svg over the box draws, so the box's
 * own border keeps only its room), radius 4px, padding 0.05em 0.45em and a 0.35em gap, in its 0.9em
 */
documentController.load(fixture('r-image-remote'), parityOptions)
settle()
const remoteBox = find_test_id('remote-image-0-0')
const remoteIcon = remoteBox?.children?.[0]
const remoteAlt = find_test_id('image-blocked-0-0')
check(
	'a blocked image paints editmd’s box: icon, muted 14.4px alt text, 1px border, radius 4, padding 0.72/6.48, gap 5.04',
	[
		remoteBox?.style?.borderColor,
		remoteBox?.style?.borderWidth ?? remoteBox?.style?.borderTopWidth,
		remoteBox?.style?.borderRadius ?? remoteBox?.style?.borderTopLeftRadius,
		remoteBox?.style?.paddingTop,
		remoteBox?.style?.paddingLeft,
		remoteBox?.style?.gap ?? remoteBox?.style?.columnGap,
		remoteIcon?.type,
		typeof remoteIcon?.customProps?.source === 'string' &&
			remoteIcon.customProps.source.includes('M2.5 12.5 6.5 8.5 9 11 11 9 13.5 12.5Z') &&
			remoteIcon.customProps.source.includes(themeController.palette.muted ?? '-'),
		remoteAlt?.children?.[0]?.text,
		remoteAlt?.style?.color,
		remoteAlt?.style?.fontSize
	],
	[
		'#00000000',
		1,
		4,
		0.72,
		6.48,
		5.04,
		'svg',
		true,
		'remote pixel',
		themeController.palette.muted,
		14.4
	]
)

/**
 * rows r-image-linked and r-image-remote: editmd paints a paragraph's images inline, in its text line. per row:
 * whether the text after the image starts right of it, whether the two share a line (their row ranges overlap),
 * and the text's left edge less the image's right edge (a gap, no wrap). then a run too long for one line: it
 * still wraps inside the column, two lines and no wider than the column
 */
writeFileSync(join(parityDirectory, 'badge.png'), png(90, 20))
writeFileSync(join(parityDirectory, 'r-image-linked.md'), fixture('r-image-linked'))
documentController.open(join(parityDirectory, 'r-image-linked.md'), {
	...parityOptions,
	socketsDirectory: join(parityDirectory, 's')
})
settle()
await wait(300)
settle()

/**
 * how the image `imageId` and the text run after it sit: [right of it, on its line, the gap between them], the
 * gap within half a pixel of `gap` shown as `gap`
 */
function inlineLayout(imageId: string, textId: string, gap: number) {
	const image = bounds(find_test_id(imageId) ?? 0)
	const run = bounds(find_test_id(textId) ?? 0)
	if (!image || !run) return null
	return [
		run.x >= image.x + image.width,
		run.y < image.y + image.height && image.y < run.y + run.height,
		...nearly([run.x - image.x - image.width], [gap])
	]
}
// the inline gap, editmd's one space
const linkedLayout = inlineLayout('image-0-0', 'text-run-0-1', 4.4)
documentController.load(fixture('r-image-remote'), parityOptions)
settle()
// measured from the alt text, since a padded box reports its origin shifted by its padding: then the box's
// 6.48px padding, its 1px border and the inline gap
const remoteLayout = inlineLayout('image-blocked-0-0', 'text-run-0-1', 6.48 + 1 + 4.4)
const longRun = Array.from({ length: 24 }, () => 'words that run on').join(' ')
documentController.load(`![remote](https://example.com/p.png) ${longRun}.\n`, parityOptions)
settle()
const longBox = bounds(find_test_id('text-run-0-1') ?? 0)
// a run measured taller than one line (on a 250ms poll) turns the paragraph into a column: the text under the image
await wait(300)
settle()
const longStacked = bounds(find_test_id('text-run-0-1') ?? 0)
const longImage = bounds(find_test_id('image-blocked-0-0') ?? 0)
check(
	'a paragraph’s image and the text after it share one line, the text just right of the image; a long run wraps inside the 656px column, then goes under the image at full width',
	[
		linkedLayout,
		remoteLayout,
		longBox !== null && longBox.width <= 656,
		longBox !== null && longBox.height >= 2 * 26.4,
		longStacked && longImage
			? [longStacked.x, longStacked.width, longStacked.y > longImage.y + longImage.height]
			: null
	],
	[[true, true, 4.4], [true, true, 6.48 + 1 + 4.4], true, true, [72, 656, true]]
)

/**
 * row r-table: editmd's table (style.css:316-342) is sized to its content and scrolls when wider than the column,
 * 0.94em text, cells `padding: 0.4em 0.85em` with 1px borders, the header bold on the surface fill; alignment from
 * the delimiter row. measured in editmd's screenshot: columns 63.5 and 90.5px, rows 38px
 */
documentController.load(fixture('r-table'), parityOptions)
settle()
const cellOf = (row: number, column: number) => find_test_id(`table-cell-${row}-${column}`)
// a cell holds a box sized to its text, which holds the <markdown> first
const cellMarkdown = (row: number, column: number) =>
	cellOf(row, column)?.children?.[0]?.children?.[0]
const cellSource = (row: number, column: number) => cellMarkdown(row, column)?.customProps?.source
// the grid inside the scroll box, which a scroll box's own bounds do not show
const tableBox = bounds(find_test_id('table-0')?.children?.[0] ?? 0)
const headerCell = cellOf(0, 0)?.style
const bodyCell = cellOf(1, 1)?.style
check(
	'a table paints a grid of native cells sized to their content: bordered, padded 0.4em 0.85em at 0.94em, the header bold on the surface, the right column right-aligned',
	[
		[cellSource(0, 0), cellSource(0, 1), cellSource(1, 0), cellSource(2, 1)],
		[headerCell?.backgroundColor, bodyCell?.backgroundColor ?? null],
		[bodyCell?.borderColor, bodyCell?.borderRightWidth, bodyCell?.borderBottomWidth],
		[bodyCell?.paddingTop, bodyCell?.paddingLeft],
		fieldOf(fieldOf(cellMarkdown(1, 0)?.customProps?.theme, 'metrics'), 'mdTextSize'),
		[cellOf(1, 0)?.style?.alignItems, bodyCell?.alignItems],
		tableBox !== null && tableBox.width < 200
	],
	[
		['**Plant**', '**Moisture**', 'Basil', '63%'],
		[themeController.palette.surface, null],
		[themeController.palette.border, 1, 1],
		[6.016, 12.784],
		15.04,
		['flex-start', 'flex-end'],
		true
	]
)

// row r-html: editmd shows raw HTML as its source, mono and muted (`span[data-type="html"]`, style.css:344-349)
documentController.load(fixture('r-html'), parityOptions)
settle()
const htmlLine = find_test_id('source-line-1')
check(
	'a block of HTML paints its source line in mono (native <markdown> inline code in its `fontMono`, SF Mono) and the muted colour',
	[
		documentController.blocks[1]?.kind,
		htmlLine?.customProps?.source,
		fieldOf(htmlLine?.customProps?.theme, 'fontMono'),
		monoLook('source-line-1')[0]
	],
	[
		'html',
		monoLinesSource('<div align="center">block html</div>'),
		'.AppleSystemUIFontMonospaced',
		themeController.palette.muted
	]
)
const htmlLineSize = monoLook('source-line-1')[1]
documentController.load(fixture('r-definitions'), parityOptions)
settle()
const definitionLineSize = monoLook('source-line-1')[1]
/**
 * `a.empty-link::before { content: "[](" attr(href) ")"; font: 0.86em var(--font-mono) }` (style.css:363-366): mono in
 * the link's accent with no fill; native paints it as inline code, so its Block's theme drops the code wash and
 * colours code in the accent, unless the Block holds inline code of its own, which keeps editmd's pill
 */
const emptyLinkTheme = find_test_id('block-0')?.children?.[0]?.customProps?.theme
documentController.load('An empty link [](https://example.com/e) and `real code`.\n', parityOptions)
settle()
const mixedTheme = find_test_id('block-0')?.children?.[0]?.customProps?.theme
check(
	'a Block with an empty link paints its source in the accent with no fill; one with inline code too keeps the code pill',
	[
		fieldOf(emptyLinkTheme, 'codeWash'),
		fieldOf(emptyLinkTheme, 'codeText'),
		fieldOf(mixedTheme, 'codeWash')
	],
	['#00000000', themeController.palette.accent, themeController.palette.surface]
)
documentController.load(fixture('r-definitions'), parityOptions)
settle()
press('cmd-=')
settle()
const zoomedDefinitionSize = monoLook('source-line-1')[1]
press('cmd-0')
settle()
check(
	'HTML and definition lines paint at editmd’s `font: 0.86em var(--font-mono)` of the 16px body, 13.76px, zoomed with the page',
	[htmlLineSize, definitionLineSize, zoomedDefinitionSize],
	[13.76, 13.76, 15.136]
)

/**
 * rows r-mermaid, r-mermaid-error and r-mermaid-empty: editmd's `.diagram` (style.css:411-455) is a box with no
 * fill, `padding: 1rem; border-radius: 8px`, its diagram centred, bordered by `inset 0 0 0 1px var(--border)` as
 * editmd shows it under its source; an error left-aligned in the danger colour, mono 12.5px; "Empty diagram"
 * centred in the faint colour. per row: the painted part's centre less the Block's (0 is centred), or its left
 * edge less the Block's (1px border and 16px padding)
 */
const centreOffset = (testId: string, index: number) => {
	const part = bounds(find_test_id(testId) ?? 0)
	const blockBox = bounds(find_test_id(`block-${index}`) ?? 0)
	return part && blockBox ? part.x + part.width / 2 - (blockBox.x + blockBox.width / 2) : Number.NaN
}
documentController.load(fixture('r-mermaid'), parityOptions)
settle()
const diagramBox = find_test_id('mermaid-box-0')?.style
const diagramLook = [
	// editmd borders a diagram only under the pointer or while its Block is open (style.css:433-439)
	diagramBox?.borderColor,
	diagramBox?.hover?.borderColor,
	diagramBox?.borderWidth ?? diagramBox?.borderTopWidth,
	diagramBox?.borderRadius ?? diagramBox?.borderTopLeftRadius,
	// a `padding` shorthand arrives as itself, longhands as `paddingTop` and the rest
	diagramBox?.paddingTop ?? diagramBox?.padding,
	diagramBox?.backgroundColor ?? null,
	...nearly([centreOffset('mermaid-0', 0)], [0])
]
documentController.load(fixture('r-mermaid-error'), parityOptions)
settle()
const errorText = find_test_id('mermaid-error-0')
const [errorColour, errorSize, errorLineHeight] = monoLook('mermaid-error-0')
const errorLook = [
	errorColour,
	// native <markdown> paints inline code in its theme's `fontMono`, SF Mono
	fieldOf(errorText?.customProps?.theme, 'fontMono'),
	errorSize,
	// `font: 12.5px/1.5 var(--font-mono)`
	errorLineHeight,
	// `.diagram` centres its child (style.css:421-431)
	...nearly([centreOffset('mermaid-error-0', 0)], [0])
]
documentController.load(fixture('r-mermaid-empty'), parityOptions)
settle()
// sized to its words, so a centre at the Block's centre is the text's own and not a full-width box's
const emptyWidth = bounds(find_test_id('mermaid-empty-0') ?? 0)?.width ?? 656
const emptyLook = [
	propOf('mermaid-empty-0', 'source'),
	monoLook('mermaid-empty-0')[0],
	monoLook('mermaid-empty-0')[2],
	...nearly([centreOffset('mermaid-empty-0', 0)], [0]),
	emptyWidth < 656 / 2
]
check(
	'a diagram paints centred in an 8px rounded box with 16px padding and no fill, its 1px border shown on hover; an error centred in danger SF Mono 12.5px/1.5; “Empty diagram” centred, faint, 1.5 high',
	[diagramLook, errorLook, emptyLook],
	[
		['#00000000', themeController.palette.border, 1, 8, 16, null, 0],
		[themeController.palette.danger, '.AppleSystemUIFontMonospaced', 12.5, 18.75, 0],
		['`Empty diagram`', themeController.palette.faint, 18.75, 0, true]
	]
)

/**
 * editmd's open diagram keeps its border (`.code-block.mermaid.editing > .diagram`); mermaid sizes its SVG to its
 * natural width, and `.diagram svg { max-width: 100%; height: auto }` shrinks a wider one into the box, keeping its
 * shape. pele writes its 16px label size only inside the root's `style`, which GPUI's SVG decoder does not read, so
 * the labels painted at its 12px default: the root carries it as an attribute too
 */
documentController.load(fixture('r-mermaid'), parityOptions)
settle()
click_test_id('block-0')
settle()
const openDiagramBorder = find_test_id('mermaid-box-0')?.style?.borderColor
press('escape')
const diagramSvg = Buffer.from(
	String(propOf('mermaid-0', 'src')).replace('data:image/svg+xml;base64,', ''),
	'base64'
).toString('utf8')
const wideSource = `flowchart LR\n  ${Array.from({ length: 12 }, (_value, n) => `node${n}`).join(' --> ')}`
const wideDiagram = diagramOf(wideSource, themeController.mermaidPalette)
documentController.load(`\`\`\`mermaid\n${wideSource}\n\`\`\`\n`, parityOptions)
settle()
await wait(300)
settle()
const wideImage = find_test_id('mermaid-0')?.style
const wideRatio =
	wideDiagram.kind === 'diagram' && typeof wideImage?.width === 'number'
		? Math.round((wideImage.width / Number(wideImage.height)) * 100) / 100
		: null
check(
	'an open diagram keeps its border, its labels paint at pele’s 16px, and one wider than the box shrinks to fit it, keeping its shape',
	[
		openDiagramBorder,
		/<svg\b[^>]*\sfont-size="16"/.test(diagramSvg),
		wideDiagram.kind === 'diagram' && wideDiagram.width > 622,
		wideImage?.width,
		wideRatio
	],
	[
		themeController.palette.border,
		true,
		true,
		622,
		wideDiagram.kind === 'diagram'
			? Math.round((wideDiagram.width / wideDiagram.height) * 100) / 100
			: null
	]
)

/**
 * row r-footnotes: editmd's footnote definition (style.css:376-390) is a `dl` under a rule, `padding-top: 0.5em`
 * of its 0.9em (7.2px), the bold `dt` label above the `dd` content: the label's left edge is the content's, and
 * the content starts below the label
 */
documentController.load(fixture('r-footnotes'), parityOptions)
settle()
const noteLabel = bounds(find_test_id('footnote-label-1') ?? 0)
const noteContent = bounds(find_test_id('footnote-1') ?? 0)
const noteBox = find_test_id('footnote-box-1')?.style
check(
	'a footnote definition paints its label above its content, both from the left edge, under a rule with 7.2px of padding',
	[
		noteLabel && noteContent ? noteLabel.x === noteContent.x : null,
		noteLabel && noteContent ? noteContent.y >= noteLabel.y + noteLabel.height : null,
		noteBox?.borderColor,
		noteBox?.borderTopWidth,
		noteBox?.paddingTop
	],
	[true, true, themeController.palette.border, 1, 7.2]
)

/** a node's font as its own style sets it: family, size and line height, null where it sets none */
function fontOf(node: TreeNode | null) {
	const style = node?.style
	return [style?.fontFamily ?? null, style?.fontSize ?? null, style?.lineHeight ?? null]
}

// Source mode's field: editmd's `.source { font: 14px/1.6 var(--font-mono) }` (style.css:88-103)
documentController.load(fixture('r-headings'), parityOptions)
settle()
press('cmd-/')
const sourceFont = fontOf(find_test_id('source-editor'))
press('cmd-/')
check(
	'Source mode’s field paints in editmd’s `.source` font: mono at 14px, line height 1.6 (22.4px)',
	sourceFont,
	['Menlo', 14, 22.4]
)

/**
 * an open code or mermaid Block: editmd edits it inside its `pre` card (style.css:193-220), the surface fill,
 * radius 8px, padding 0.9rem 1.1rem, 13.5px/1.55 mono; a paragraph's field keeps its own look, no card and no font
 */
function openField(testId: string) {
	click_test_id(testId)
	const card = find_test_id('block-editor-card')?.style
	const look = card
		? [
				card.backgroundColor,
				card.borderRadius ?? card.borderTopLeftRadius,
				card.paddingTop,
				card.paddingBottom,
				card.paddingLeft,
				card.paddingRight
			]
		: null
	const field = [look, ...fontOf(find_test_id('block-editor'))]
	press('escape')
	return field
}
documentController.load(fixture('r-code'), parityOptions)
settle()
const openCodeField = openField('block-0')
documentController.load(fixture('r-mermaid'), parityOptions)
settle()
const openMermaidField = openField('block-0')
documentController.load('A paragraph.\n', parityOptions)
settle()
const openParagraphField = openField('block-0')
const preCard = [themeController.palette.surface, 8, 14.4, 14.4, 17.6, 17.6]
check(
	'an open code or mermaid Block’s field paints in editmd’s `pre` card, mono 13.5px/20.925px; a paragraph’s field stays as it was',
	[openCodeField, openMermaidField, openParagraphField],
	[
		[preCard, 'Menlo', 13.5, 20.925],
		[preCard, 'Menlo', 13.5, 20.925],
		[null, null, null, null]
	]
)

/** a style's length in px, 0 where it sets none */
function lengthOf(value: NonNullable<TreeNode['style']>[string]): number {
	return typeof value === 'number' ? value : 0
}

/**
 * editmd edits front matter inside its box (frontmatter.ts:20-23, a contenteditable `pre.frontmatter`), so the open
 * field keeps the box's look, its text muted, with `.frontmatter:focus`'s 2px ring in the selection colour; an open
 * code or mermaid Block keeps its `pre[data-language]::before` label, which editmd's open `pre` still shows
 */
function openLook(testId: string) {
	click_test_id(testId)
	const card = find_test_id('block-editor-card')?.style
	const look = [
		/**
		 * @gpuix/native 0.10's style has no outline, so the ring is a border inside the box, its width taken off the
		 * padding: the text sits where editmd's does, 12px and 16px in
		 */
		card
			? [
					card.backgroundColor,
					card.borderRadius ?? card.borderTopLeftRadius,
					lengthOf(card.paddingTop) + lengthOf(card.borderTopWidth ?? card.borderWidth),
					lengthOf(card.paddingLeft) + lengthOf(card.borderLeftWidth ?? card.borderWidth),
					card.borderTopWidth ?? card.borderWidth ?? null,
					card.borderColor ?? null
				]
			: null,
		...fontOf(find_test_id('block-editor')),
		fieldOf(propOf('block-editor', 'theme'), 'text'),
		textOf('block-editor-label') ?? null
	]
	press('escape')
	return look
}
documentController.load(fixture('r-frontmatter'), parityOptions)
settle()
const openFrontmatter = openLook('block-0')
documentController.load(fixture('r-code'), parityOptions)
settle()
const openCodeLabel = openLook('block-0').at(-1)
documentController.load(fixture('r-mermaid'), parityOptions)
settle()
const openMermaidLabel = openLook('block-0').at(-1)
check(
	'open front matter keeps its box (surface, 12px 16px, radius 8, a 2px selection ring) and 12.5px/1.55 muted mono; open code and mermaid keep their language label',
	[openFrontmatter, openCodeLabel, openMermaidLabel],
	[
		[
			[themeController.palette.surface, 8, 12, 16, 2, themeController.palette.selection],
			'Menlo',
			12.5,
			19.375,
			themeController.palette.muted,
			null
		],
		'js',
		'mermaid'
	]
)

/**
 * row r-frontmatter: editmd's `.frontmatter { padding: 0.75rem 1rem; font: 12.5px/1.55 var(--font-mono);
 * color: var(--muted); background: var(--surface); border-radius: 8px }` (style.css:71-82)
 */
documentController.load(fixture('r-frontmatter'), parityOptions)
settle()
const frontmatterBox = find_test_id('frontmatter-box-0')?.style
check(
	'front matter paints in editmd’s box: surface fill, 8px radius, padding 12/16px, muted mono 12.5px/19.375px',
	[
		frontmatterBox?.backgroundColor,
		frontmatterBox?.borderRadius ?? frontmatterBox?.borderTopLeftRadius,
		frontmatterBox?.paddingTop,
		frontmatterBox?.paddingBottom,
		frontmatterBox?.paddingLeft,
		frontmatterBox?.paddingRight,
		monoLook('frontmatter-0')[0],
		// native <markdown> paints inline code in its theme's `fontMono`, SF Mono as editmd's `ui-monospace`
		fieldOf(find_test_id('frontmatter-0')?.customProps?.theme, 'fontMono'),
		monoLook('frontmatter-0')[1],
		monoLook('frontmatter-0')[2]
	],
	[
		themeController.palette.surface,
		8,
		12,
		12,
		16,
		16,
		themeController.palette.muted,
		'.AppleSystemUIFontMonospaced',
		12.5,
		19.375
	]
)

// row r-tasks: editmd's `li + li { margin-top: 0.2em }` (style.css:230-238), 3.2px between a task list's rows
documentController.load(fixture('r-tasks'), parityOptions)
settle()
const taskRows = find_all((node) => node.testId?.startsWith('task-row-') === true).map((node) =>
	bounds(node)
)
const taskGaps = taskRows.slice(1).map((row, index) => {
	const above = taskRows[index]
	return row && above ? row.y - above.y - above.height : Number.NaN
})
check(
	'a task list’s rows sit editmd’s 0.2em (3.2px) apart',
	[find_test_id('task-list-0')?.style?.gap, nearly(taskGaps, [3.2, 3.2])],
	[3.2, [3.2, 3.2]]
)

/**
 * editmd's links show the text cursor, and the pointer only while ⌘ is held (main.ts:48-54, style.css:170-181):
 * here the Block holding a link takes the pointer while ⌘ is held, as the pointer's modifiers or the window's
 * ⌘ key say; a Block with no link keeps the text cursor
 */
documentController.load('A [link](https://x.y) here.\n\nPlain text.\n', parityOptions)
settle()
const cursorOf = (testId: string) => find_test_id(testId)?.style?.cursor
const cursors = [cursorOf('block-0')]
mouse_move(find_test_id('block-0') ?? { x: 0, y: 0 }, { modifiers: 'cmd' })
settle()
cursors.push(cursorOf('block-0'), cursorOf('block-1'))
mouse_move(find_test_id('block-0') ?? { x: 0, y: 0 })
settle()
cursors.push(cursorOf('block-0'))
press('cmd', { held: true })
settle()
cursors.push(cursorOf('block-0'))
key_up('cmd')
settle()
cursors.push(cursorOf('block-0'))
check(
	'a Block with a link shows the text cursor, and the pointer while ⌘ is held, from a ⌘ move or the ⌘ key; a Block without a link keeps the text cursor',
	cursors,
	['text', 'pointer', 'text', 'text', 'pointer', 'text']
)

/** the window's paint as decoded pixels, with its device pixels per logical pixel over the 800px window */
function snapshot(): { shot: Pixels; scale: number } {
	const shotPath = join(tmpdir(), `eg-look-${process.pid}.png`)
	screenshot(shotPath)
	const shot = decodePng(readFileSync(shotPath))
	rmSync(shotPath, { force: true })
	return { shot, scale: shot.width / 800 }
}

/** `#rrggbb` of device pixel (`x`, `y`) */
function devicePixel({ shot }: { shot: Pixels }, x: number, y: number): string {
	if (x < 0 || y < 0 || x >= shot.width || y >= shot.height) return '#000000'
	const at = (y * shot.width + x) * 4
	return `#${[shot.data[at]!, shot.data[at + 1]!, shot.data[at + 2]!].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/** `foreground` laid over `background` at `alpha`, as a translucent fill paints */
function mixColour(foreground: string, background: string, alpha: number): string {
	const channels = (hex: string) =>
		[1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
	const [front, back] = [channels(foreground), channels(background)]
	return `#${front
		.map((value, index) => Math.round(value * alpha + back[index]! * (1 - alpha)))
		.map((value) => value.toString(16).padStart(2, '0'))
		.join('')}`
}

type Box = { x: number; y: number; width: number; height: number }

/**
 * the colour that fills the most pixels of any one device row inside `box` (logical px), leaving out the colours within
 * 8 of `except`: a strike or underline line crosses the whole run, under or over its glyphs, so its row holds more of
 * its colour than any row of glyphs holds of theirs
 */
function longestRunColour(snap: { shot: Pixels; scale: number }, box: Box, except: string[]) {
	const { scale } = snap
	let best: [string, number] | null = null
	for (let y = Math.ceil(box.y * scale); y < Math.floor((box.y + box.height) * scale); y++) {
		const counts = new Map<string, number>()
		for (let x = Math.ceil(box.x * scale); x < Math.floor((box.x + box.width) * scale); x++) {
			const colour = devicePixel(snap, x, y)
			if (except.some((left) => near(colour, left, 8))) continue
			const count = (counts.get(colour) ?? 0) + 1
			counts.set(colour, count)
			if (!best || count > best[1]) best = [colour, count]
		}
	}
	return best?.[0] ?? null
}

/** the most frequent colour inside `box` (logical px), leaving out the colours within 8 of `except` */
function inkColour(snap: { shot: Pixels; scale: number }, box: Box, except: string[]) {
	const { scale } = snap
	const counts = new Map<string, number>()
	for (let y = Math.ceil(box.y * scale); y < Math.floor((box.y + box.height) * scale); y++)
		for (let x = Math.ceil(box.x * scale); x < Math.floor((box.x + box.width) * scale); x++) {
			const colour = devicePixel(snap, x, y)
			if (!except.some((left) => near(colour, left, 8)))
				counts.set(colour, (counts.get(colour) ?? 0) + 1)
		}
	return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/**
 * how many separate runs of colours within 24 of `colour` lie along device row `y` from device x `x0` to `x1`: one
 * for a solid line, one per dash for a dashed one
 */
function runsAlong(
	snap: { shot: Pixels; scale: number },
	y: number,
	x0: number,
	x1: number,
	colour: string
): number {
	let runs = 0
	let inRun = false
	for (let x = x0; x <= x1; x++) {
		const on = near(devicePixel(snap, x, y), colour, 24)
		if (on && !inRun) runs++
		inRun = on
	}
	return runs
}

/** the first device row from `y0` down column `x` whose pixel is within `tolerance` of `colour`, -1 for none by `y1` */
function firstRowNear(
	snap: { shot: Pixels; scale: number },
	x: number,
	y0: number,
	y1: number,
	colour: string,
	tolerance = 24
): number {
	for (let y = y0; y <= y1; y++) if (near(devicePixel(snap, x, y), colour, tolerance)) return y
	return -1
}

const palette = () => themeController.palette

/**
 * editmd's `.agent-block { background: var(--tint); box-shadow: -6px 0 0 var(--tint), -8px 0 0 var(--agent) }`
 * (style.css:474-479): left of the Block the agent shadow shows from -8px, the tint shadow over it from -6px, and the
 * tint of an agent's colour over that colour is the colour itself, so an 8px solid bar; the Block itself is tinted
 */
const lookDirectory = mkdtempSync(join(tmpdir(), 'eg-look-'))
const lookPath = join(lookDirectory, 'look.md')
writeFileSync(lookPath, fixture('a-highlight-deleted'))
documentController.open(lookPath, {
	...parityOptions,
	socketsDirectory: join(lookDirectory, 's'),
	listAgentProcesses: () => [],
	legendPreference: new LegendPreference(join(lookDirectory, 'legend.json'))
})
settle()
// a new Block, which is marked whole (a paragraph that kept its kind would be marked by its changed text)
writeFileSync(
	lookPath,
	'# Deletions\n\nThe paragraph before.\n\nThe paragraph after.\n\nA new paragraph, added outside.\n'
)
await waitUntil(
	() => documentController.highlights.length > 0 && documentController.deletions.length > 0,
	'the outside change and deletion'
)
settle()
await wait(100)
settle()
const highlightSnap = snapshot()
const highlightedText = bounds(find_test_id('block-3')?.children?.[0] ?? 0)
// left of the text, on the bar; and inside the Block right of its short line, on the tint and clear of the glyphs
const barColours = highlightedText
	? [-7, -3, highlightedText.width - 6].map((dx) =>
			devicePixel(
				highlightSnap,
				Math.round((highlightedText.x + dx) * highlightSnap.scale),
				Math.round((highlightedText.y + highlightedText.height / 2) * highlightSnap.scale)
			)
		)
	: []
const agentColour = palette()['agent-unknown'] ?? ''
const tintColour = mixColour(agentColour, palette().background ?? '', 0.13)
check(
	`an Agent’s Block paints an 8px bar in the agent colour left of its text and the tint on the Block itself (at -7, -3 and its right end: ${barColours.join(', ')})`,
	[
		near(barColours[0] ?? '', agentColour, 6),
		near(barColours[1] ?? '', agentColour, 6),
		near(barColours[2] ?? '', tintColour, 6)
	],
	[true, true, true]
)

/**
 * `.agent-deleted.between { border-top: 2px dashed }` (style.css:494-498): WebKit dashes a border three times its
 * width, so a 2px line is 6px dashes 6px apart; gpuix has no border style, so an svg draws them. along the line's
 * middle row the agent colour comes and goes once per dash
 */
const lookDeletedLine = bounds(find_test_id('deleted-0') ?? 0)
const deletedColour = palette()['agent-unknown-deleted'] ?? ''
const deletedRuns = lookDeletedLine
	? runsAlong(
			highlightSnap,
			Math.round((lookDeletedLine.y + lookDeletedLine.height / 2) * highlightSnap.scale),
			Math.round(lookDeletedLine.x * highlightSnap.scale),
			Math.round((lookDeletedLine.x + 118) * highlightSnap.scale),
			mixColour((deletedColour || '#000000').slice(0, 7), palette().background ?? '', 0.7)
		)
	: 0

/**
 * editmd's legend floats on `box-shadow: 0 4px 16px rgb(0 0 0 / 0.12)` (style.css:515), which gpuix-svelte drops
 * from CSS text; under it the page is darker than further down
 */
const legendBox = bounds(find_test_id('legend') ?? 0)
const legendShade = legendBox
	? [legendBox.x + legendBox.width / 2, legendBox.x - 40].map((x) =>
			devicePixel(
				highlightSnap,
				Math.round(x * highlightSnap.scale),
				Math.round((legendBox.y + legendBox.height + 4) * highlightSnap.scale)
			)
		)
	: []
const shade = (hex: string) =>
	[1, 3, 5].reduce((sum, at) => sum + Number.parseInt(hex.slice(at, at + 2), 16), 0)
check(
	`a Deletion line paints dashed, 6px dashes 6px apart, and the legend casts editmd’s shadow below it (Deletion dashes in its first 118px: ${deletedRuns}; 4px under the legend, then 40px left of it: ${legendShade.join(', ')})`,
	[
		deletedRuns,
		find_test_id('legend')?.style?.boxShadow,
		legendShade.length === 2 && shade(legendShade[0]!) < shade(legendShade[1]!)
	],
	[
		10,
		{ offsetX: 0, offsetY: 4, blurRadius: 16, spreadRadius: 0, color: '#0000001f', inset: false },
		true
	]
)
documentController.load('')
rmSync(lookDirectory, { recursive: true, force: true })

/**
 * a ticked task's strike line in editmd's faint colour over its muted text (`text-decoration-color: var(--faint)`,
 * style.css:268-272): native <markdown> paints the line in its theme's `textMuted`
 */
documentController.load(fixture('r-tasks'), parityOptions)
settle()
const doneText = bounds(find_test_id('task-text-17')?.children?.[0] ?? 0)
/** the most pixels within 4 of `colour` along any one device row inside `box` (logical px) */
function mostInARow(snap: { shot: Pixels; scale: number }, box: Box, colour: string): number {
	const { scale } = snap
	let most = 0
	for (let y = Math.ceil(box.y * scale); y < Math.floor((box.y + box.height) * scale); y++) {
		let count = 0
		for (let x = Math.ceil(box.x * scale); x < Math.floor((box.x + box.width) * scale); x++)
			if (near(devicePixel(snap, x, y), colour, 4)) count++
		most = Math.max(most, count)
	}
	return most
}
// the strike line runs under the glyphs, so it shows between them: its row holds the most faint pixels
const strikeFaint = doneText ? mostInARow(snapshot(), doneText, palette().faint ?? '') : 0

/**
 * a link's underline turns to its own colour while ⌘ is held, as editmd's `body.cmd-down a { text-decoration-color:
 * currentColor }` (style.css:178-181); native <markdown> paints a link in the text colour and its underline in the
 * theme's `textMuted`
 */
documentController.load('[a linked phrase](https://example.com/x)\n', parityOptions)
settle()
const linkText = bounds(find_test_id('block-0')?.children?.[0] ?? 0)
const underlineBefore = linkText
	? longestRunColour(snapshot(), linkText, [palette().background ?? ''])
	: null
press('cmd', { held: true })
settle()
const underlineHeld = linkText
	? longestRunColour(snapshot(), linkText, [palette().background ?? ''])
	: null
key_up('cmd')
settle()
const underlineAfter = linkText
	? longestRunColour(snapshot(), linkText, [palette().background ?? ''])
	: null
check(
	`a ticked task’s strike line paints faint, and a link’s underline turns from muted to the link’s colour while ⌘ is held (faint pixels in the strike’s row ${strikeFaint}; underline ${underlineBefore}, ${underlineHeld}, ${underlineAfter})`,
	[
		strikeFaint >= 20,
		near(underlineBefore ?? '', palette().muted ?? '', 6),
		near(underlineHeld ?? '', palette().text ?? '', 6),
		near(underlineAfter ?? '', palette().muted ?? '', 6)
	],
	[true, true, true, true]
)

/**
 * row r-image-remote: editmd's blocked image box has a 1px dashed border (style.css:295-314), dashes 3px long and 3px
 * apart, and its picture icon is a mask in the box's muted colour (`background: currentColor`)
 */
documentController.load(fixture('r-image-remote'), parityOptions)
settle()
await wait(300)
settle()
const remoteSnap = snapshot()
const remoteIconBox = bounds(find_test_id('remote-image-0-0')?.children?.[0] ?? 0)
const remoteAltBox = bounds(find_test_id('image-blocked-0-0') ?? 0)
const remoteIconInk = remoteIconBox
	? inkColour(remoteSnap, remoteIconBox, [palette().background ?? ''])
	: null
/** the box's top edge: the device row above the alt text holding the most pixels of the border colour */
let remoteTop = -1
if (remoteAltBox && remoteIconBox) {
	let most = 0
	for (
		let y = Math.round((remoteAltBox.y - 8) * remoteSnap.scale);
		y <= Math.round(remoteAltBox.y * remoteSnap.scale);
		y++
	) {
		let count = 0
		for (
			let x = Math.round(remoteIconBox.x * remoteSnap.scale);
			x <= Math.round((remoteAltBox.x + remoteAltBox.width) * remoteSnap.scale);
			x++
		)
			if (near(devicePixel(remoteSnap, x, y), palette().border ?? '', 24)) count++
		if (count > most) [most, remoteTop] = [count, y]
	}
}
const remoteRuns =
	remoteTop >= 0 && remoteIconBox && remoteAltBox
		? runsAlong(
				remoteSnap,
				remoteTop,
				Math.round((remoteIconBox.x + 4) * remoteSnap.scale),
				Math.round((remoteAltBox.x + remoteAltBox.width - 4) * remoteSnap.scale),
				palette().border ?? ''
			)
		: 0
check(
	`a blocked image’s box paints a dashed border, 3px dashes 3px apart, and its icon in the muted colour (icon ${remoteIconInk}; runs along the top ${remoteRuns})`,
	[
		near(remoteIconInk ?? '', palette().muted ?? '', 12),
		remoteAltBox ? remoteRuns >= Math.floor((remoteAltBox.width + 14.4 - 8) / 6) - 1 : null
	],
	[true, true]
)

/**
 * row r-code: editmd's `pre` (style.css:193-201) is a card filled in the surface colour with no ring, `padding: 0.9rem
 * 1.1rem`, its lines 13.5px/1.55: four lines make it 2 × 14.4 + 4 × 20.925 = 112.5px tall, the first line 14.4px
 * and 17.6px in, the `js` label 5.6px from its top and 9.6px from its right
 */
documentController.load(fixture('r-code'), parityOptions)
settle()
const codeSnap = snapshot()
/**
 * GPUI reports a padded box's origin moved in by its padding, so the card's top-left corner is its Block's, which it
 * starts, and its size its own
 */
const codeBlockBox = bounds(find_test_id('block-0') ?? 0)
const codeCardSize = bounds(find_test_id('code-card-0') ?? 0)
const codeCard =
	codeBlockBox && codeCardSize
		? { ...codeBlockBox, width: codeCardSize.width, height: codeCardSize.height }
		: null
const codeLines = bounds(find_test_id('code-0') ?? 0)
const codeLabel = bounds(find_test_id('code-label-0') ?? 0)
const codeEdge = codeCard
	? [0.25, 3].map((dy) =>
			devicePixel(
				codeSnap,
				Math.round((codeCard.x + codeCard.width / 2) * codeSnap.scale),
				Math.floor((codeCard.y + dy) * codeSnap.scale)
			)
		)
	: []
check(
	`a code block paints editmd’s card: the surface fill to its edge with no ring, 112.5px tall for four lines, its text 14.4/17.6px in and its label 5.6/9.6px from the corner (edge, inside: ${codeEdge.join(', ')})`,
	[
		codeEdge.map((colour) => near(colour, palette().surface ?? '', 3)),
		codeCard ? nearly([codeCard.height], [112.5]) : null,
		codeCard && codeLines
			? nearly([codeLines.y - codeCard.y, codeLines.x - codeCard.x], [14.4, 17.6])
			: null,
		codeCard && codeLabel
			? nearly([codeCard.x + codeCard.width - codeLabel.x - codeLabel.width], [9.6])
			: null
	],
	[[true, true], [112.5], [14.4, 17.6], [9.6]]
)

/**
 * where the `js` label's ink starts below the card's top: 8px in editmd (editmd's screenshot, device rows 96 and 112
 * at 2x), the 0.35rem of `top` plus where WebKit sets 11px text in its line
 */
const labelInkTop = (() => {
	if (!codeCard || !codeLabel) return null
	const { scale } = codeSnap
	const surface = palette().surface ?? ''
	for (let y = Math.round(codeCard.y * scale); y < Math.round((codeCard.y + 30) * scale); y++)
		for (
			let x = Math.round(codeLabel.x * scale);
			x < Math.round((codeLabel.x + codeLabel.width) * scale);
			x++
		)
			if (!near(devicePixel(codeSnap, x, y), surface, 12)) return y / scale - codeCard.y
	return null
})()
check(
	`a code block’s language label paints its ink 8px below the card’s top, as editmd’s (${labelInkTop})`,
	labelInkTop === null ? null : nearly([labelInkTop], [8]),
	[8]
)

/**
 * a paragraph that also holds an image paints a link with no text as editmd does, in the accent with no fill, as a
 * Block without an image does
 */
documentController.load(
	'![remote](https://example.com/p.png) and an empty link [](https://example.com/e).\n',
	parityOptions
)
settle()
const mixedEmptyTheme = find_test_id('text-run-0-1')?.customProps?.theme
check(
	'a paragraph holding an image paints its empty link’s source in the accent with no fill',
	[fieldOf(mixedEmptyTheme, 'codeWash'), fieldOf(mixedEmptyTheme, 'codeText')],
	['#00000000', palette().accent]
)

/**
 * open front matter's text paints muted, as editmd's `.frontmatter { color: var(--muted) }` keeps it while it is
 * edited (frontmatter.ts:20-23)
 */
documentController.load(fixture('r-frontmatter'), parityOptions)
settle()
click_test_id('block-0')
settle()
const frontmatterField = bounds(find_test_id('block-editor') ?? 0)
const frontmatterInk = frontmatterField
	? inkColour(snapshot(), frontmatterField, [palette().surface ?? '', palette().accent ?? ''])
	: null
press('escape')
check(
	`open front matter paints its text in the muted colour (${frontmatterInk})`,
	near(frontmatterInk ?? '', palette().muted ?? '', 12),
	true
)

/**
 * editmd's find bar is an AppKit view on the window's own background (EditorWindowController.swift:246-290), and
 * its chevrons and Done are buttons, which keep the arrow cursor; the Help menu's search field shows the same
 * magnifier as the find field
 */
documentController.load('Find me.\n', parityOptions)
settle()
press('cmd-f')
settle()
const findBar = bounds(find_test_id('find-bar') ?? 0)
const findSnap = snapshot()
const findFill = findBar
	? devicePixel(
			findSnap,
			// GPUI reports a padded box's origin moved in by its padding, so the bar's right end is the window's
			Math.round(798 * findSnap.scale),
			Math.round((findBar.y + 3) * findSnap.scale)
		)
	: null
const findMagnifierSource = propOf('find-magnifier', 'source')
const findCursors = ['find-previous', 'find-next', 'find-done'].map(
	(id) => find_test_id(id)?.style?.cursor ?? null
)
press('escape')
openMenu('Help')
const helpField = bounds(find_test_id('help-search-box') ?? 0)
const helpMagnifier = bounds(find_test_id('help-search-magnifier') ?? 0)
const helpText = bounds(find_test_id('help-search') ?? 0)
const helpMagnifierSource = propOf('help-search-magnifier', 'source')
press('escape')
check(
	`the find bar has no fill of its own and its chevrons and Done keep the arrow cursor; Help’s search shows the find field’s magnifier inside its left edge (bar ${findFill})`,
	[
		near(findFill ?? '', palette().background ?? '', 3),
		findCursors,
		helpField && helpMagnifier && helpText
			? helpMagnifier.x >= helpField.x && helpMagnifier.x + helpMagnifier.width <= helpText.x
			: null,
		helpMagnifierSource
	],
	[true, ['default', 'default', 'default'], true, findMagnifierSource]
)

/**
 * the runs of device rows from `top` to `bottom` (logical px) that hold ink between `left` and `right`, each as its
 * first row's distance below `top` in logical px: what differs from the page's background
 */
function inkRowsBelow(top: number, bottom: number, left: number, right: number): number[] {
	const snap = snapshot()
	const { scale } = snap
	const background = palette().background ?? ''
	const starts: number[] = []
	let inked = false
	for (let y = Math.round(top * scale); y <= Math.round(bottom * scale); y++) {
		let row = false
		for (let x = Math.round(left * scale); x <= Math.round(right * scale) && !row; x++)
			row = !near(devicePixel(snap, x, y), background, 6)
		if (row && !inked) starts.push(Math.round((y / scale - top) * 10) / 10)
		inked = row
	}
	return starts
}

/** ink rows below the first Block's top, across the column's left 600px, down 200px */
function inkBelowFirstBlock(): number[] {
	const first = bounds(find_test_id('block-0') ?? 0)
	return first ? inkRowsBelow(first.y, first.y + 200, first.x, first.x + 600) : []
}

/**
 * rows r-html, r-definitions and r-footnotes, measured in editmd's screenshots (device px / 2) below the first
 * Block's top: editmd sets a block of HTML inline in a 16px/1.65 line, so its mono text sits on the body's baseline,
 * 50.5px down; a definition is a block of its own 0.86em mono at line-height 1.65, 44.5px down; a footnote reference
 * is a `sup`, which makes its line 2px taller, so the definition's rule, label and note come 44, 59 and 82px down
 */
documentController.load(fixture('r-html'), parityOptions)
settle()
const htmlInk = inkBelowFirstBlock()
documentController.load(fixture('r-definitions'), parityOptions)
settle()
const definitionInk = inkBelowFirstBlock()
documentController.load(fixture('r-footnotes'), parityOptions)
settle()
const footnoteInk = inkBelowFirstBlock()
check(
	`HTML and definition lines and a footnote under a reference sit where editmd’s do (ink rows: ${htmlInk.join(' ')} | ${definitionInk.join(' ')} | ${footnoteInk.join(' ')})`,
	[
		nearly(htmlInk.slice(1, 2), [50.5]),
		nearly(definitionInk.slice(1, 2), [44.5]),
		nearly(footnoteInk.slice(1, 4), [44, 59, 82])
	],
	[[50.5], [44.5], [44, 59, 82]]
)

/**
 * row cli-snapshot: editmd's code block is a `div.code-block` holding its `pre` and a diagram box (diagrams.ts:78-87)
 * that `hidden` cannot hide, since `.diagram { display: flex }` outranks it: after the card come the pre's own `margin:
 * 0 0 1em` of its 13.5px, 13.5px, the empty box's `padding: 1rem`, 32px, and its 1em margin, 16px, so a table after a
 * code block starts 61.5px below the card (measured in editmd's --snapshot: 123 device px)
 */
documentController.load(
	'```js\nconst x = 1\n```\n\n| a | b |\n| - | - |\n| c | d |\n',
	parityOptions
)
settle()
const codeThenTable = bounds(find_test_id('block-0') ?? 0)
const codeTableSnap = snapshot()
const cardColumn = codeThenTable ? Math.round((codeThenTable.x + 12) * codeTableSnap.scale) : 0
const cardBottom = codeThenTable
	? firstRowNear(
			codeTableSnap,
			cardColumn,
			Math.round((codeThenTable.y + 20) * codeTableSnap.scale),
			Math.round((codeThenTable.y + 300) * codeTableSnap.scale),
			palette().background ?? '',
			3
		)
	: -1
const tableTop =
	cardBottom >= 0
		? firstRowNear(
				codeTableSnap,
				cardColumn,
				cardBottom,
				cardBottom + Math.round(200 * codeTableSnap.scale),
				palette().border ?? '',
				3
			)
		: -1
check(
	`a table after a code block starts 61.5px below the code card, as editmd’s hidden diagram box keeps its room (card ends at device row ${cardBottom}, table starts at ${tableTop})`,
	nearly([(tableTop - cardBottom) / codeTableSnap.scale], [61.5]),
	[61.5]
)

/**
 * editmd marks a Block a Disk merge changed but kept as the same kind by its changed text only (changes.ts:48-74,
 * highlights.ts:185-188, `.agent-change { background: color-mix(var(--agent) 18%, transparent) }`): the core names
 * that text as runs, each the nth occurrence of its text in the Block's painted text, and the Block takes no tint or
 * bar; a new Block is marked whole, tint and bar as before. `brown` to `green` is the run `gree`: editmd's diff keeps
 * the `n` both end in
 */
const runDirectory = mkdtempSync(join(tmpdir(), 'eg-runs-'))
const runPath = join(runDirectory, 'runs.md')
writeFileSync(runPath, '# Runs\n\nThe quick brown fox.\n\nOther fox here.\n')
documentController.open(runPath, {
	...parityOptions,
	socketsDirectory: join(runDirectory, 's'),
	listAgentProcesses: () => [],
	legendPreference: new LegendPreference(join(runDirectory, 'legend.json'))
})
settle()
writeFileSync(runPath, '# Runs\n\nThe quick green fox.\n\nOther fox here.\n\nA new paragraph.\n')
await waitUntil(
	() => documentController.highlights.length >= 2,
	'the changed word and the new Block'
)
settle()
await wait(100)
settle()
const activeWashes = () =>
	painted_highlights()
		.filter(({ active }) => active)
		.map(({ text, start, end }) => `${text.slice(start, end)}@${start}@${text}`)
const runWashes = activeWashes()
const changedBlockStyle = find_test_id('block-1')?.style
const newBlockStyle = find_test_id('block-3')?.style
check(
	'a Disk merge that changes one word of a paragraph washes only that word, with no Block tint or bar; a new Block keeps the tint and bar',
	[
		runWashes,
		changedBlockStyle?.borderLeftWidth ?? 0,
		changedBlockStyle?.backgroundColor ?? null,
		newBlockStyle?.borderLeftWidth,
		newBlockStyle?.backgroundColor
	],
	[['gree@10@The quick green fox.'], 0, null, 8, palette()['agent-unknown-tint']]
)

// Find keeps working over a Block marked by its runs: its matches there count and take their turn as the active one
press('cmd-f')
for (const key of ['f', 'o', 'x']) type(key)
const findOverRuns = [(await findState()).slice(0, 2), activeWashes().sort()]
press('cmd-g')
const findOverRunsNext = [(await findState()).slice(0, 2), activeWashes().sort()]
press('escape')
check(
	'Find over a Block marked by its runs counts its matches and steps through them, the run’s wash kept',
	[findOverRuns, findOverRunsNext],
	[
		[
			[2, 0],
			['fox@16@The quick green fox.', 'gree@10@The quick green fox.']
		],
		[
			[2, 1],
			['fox@6@Other fox here.', 'gree@10@The quick green fox.']
		]
	]
)
documentController.load('')
rmSync(runDirectory, { recursive: true, force: true })

/**
 * a field's selection and caret, which gpuix does not report (gap G1), learnt and changed through the keys the
 * field takes; every effect outside the window is this folder's or a recorder's, the pasteboard never touched
 */
const r9Directory = mkdtempSync(join(tmpdir(), 'eg-r9-'))
const r9Options = {
	...menuOptions,
	socketsDirectory: join(r9Directory, 's'),
	recentFiles: new RecentFiles(join(r9Directory, 'recent.json')),
	legendPreference: new LegendPreference(join(r9Directory, 'legend.json'))
}

/** waits out the field work a command started (a probe and the keys it sends), then delivers what the field reported */
async function fieldIdle(): Promise<void> {
	await waitUntil(() => !documentController.fieldBusy, 'the field work')
	for (let round = 0; round < 3; round++) {
		await wait(20)
		pump()
	}
}

/** what `readSelection` learns of the open field, once its probe is done */
async function probedRange(): Promise<Range | null | undefined> {
	let range: Range | null | undefined
	void documentController.readSelection().then((found) => (range = found))
	await waitUntil(() => range !== undefined, 'the selection probe')
	pump()
	return range
}

// "two" selected, then the caret at the start: the probe's sentinel and cmd-z never reach the Document
documentController.load('one two three\n', r9Options)
settle()
click_test_id('block-0')
type('cmd-left right right right right shift-right shift-right shift-right')
// the window's title recorder hears an Edited mark the moment the Document changes, even back and forth
menuRuns.length = 0
const probedTwo = await probedRange()
const afterProbe = [
	documentController.text,
	documentController.edited,
	painted().includes('one two three'),
	painted().includes('one a three')
]
type('cmd-left')
const probedStart = await probedRange()
const titlesWhileProbing = menuRuns.filter(([command]) => command === 'setWindowTitle')
press('escape')
check(
	'a probe reads the open field’s selection and its caret by a typed sentinel and cmd-z, and neither reaches the Document: no change, no Edited mark at any moment, the field’s text as it was',
	[probedTwo, probedStart, afterProbe, titlesWhileProbing],
	[{ start: 4, end: 7 }, { start: 0, end: 0 }, ['one two three\n', false, true, false], []]
)

/** whether Format's first four items (Bold, Italic, Strikethrough, Inline Code) are enabled */
const inlineEnabled = () =>
	(documentController.menus[2]?.items ?? [])
		.slice(0, 4)
		.map((item) => item.kind === 'item' && item.enabled)
const inlineClosed = inlineEnabled()
click_test_id('block-0')
const inlineOpen = inlineEnabled()
type('cmd-left right right right right shift-right shift-right shift-right')
press('cmd-b')
await fieldIdle()
press('escape')
check(
	'⌘B on “two” selected in a Block’s field writes `one **two** three` once the field closes; Bold, Italic, Strikethrough and Inline Code are enabled with a field open, greyed without',
	[documentController.text, inlineOpen, inlineClosed],
	['one **two** three\n', [true, true, true, true], [false, false, false, false]]
)
click_test_id('block-0')
type('cmd-left shift-right shift-right shift-right')
openMenu('Format')
clickRow('Italic')
await fieldIdle()
press('escape')
check(
	'Format > Italic from the menu bar wraps the field’s selection, the field keeping the keys',
	documentController.text,
	'_one_ **two** three\n'
)

/**
 * a selection that is the probe's own sentinel: typed over itself it leaves the value as it was, which the field still
 * reports, and cmd-z puts the selection back, so the probe reads it with no remount
 */
documentController.load('x a y\n', r9Options)
settle()
click_test_id('block-0')
type('cmd-left right right shift-right')
const sentinelRevision = documentController.fieldRevision
press('cmd-b')
await fieldIdle()
const sentinelRemounts = documentController.fieldRevision - sentinelRevision
press('escape')
check(
	'⌘B on a selected “a” in `x a y`, the probe’s own sentinel, writes `x **a** y` with no remount of the field',
	[documentController.text, sentinelRemounts],
	['x **a** y\n', 0]
)

/**
 * a selection of spaces only gets no marks (toggleInlineKeys gives no keys): nothing is sent, and the probe is settled,
 * so ⇧⌘Z after it brings no sentinel back
 */
documentController.load('x  y\n', r9Options)
settle()
click_test_id('block-0')
type('cmd-left right shift-right shift-right')
press('cmd-b')
await fieldIdle()
type('cmd-shift-z')
await fieldIdle()
press('escape')
check(
	'⌘B on a selection of two spaces changes nothing, and ⇧⌘Z after it brings no sentinel back',
	documentController.text,
	'x  y\n'
)

// a list's Indent acts on the item the caret is in, read from the field (editmd 17 of 17: e-block-format-caret)
documentController.load('- a\n- b\n- c\n', r9Options)
settle()
click_test_id('block-0')
type('cmd-up down cmd-right')
press('cmd-]')
await fieldIdle()
press('escape')
const indentAtCaret = documentController.text
/**
 * Indent at the first item, which editmd refuses: after its probe the field is set to its own text again, so ⇧⌘Z in it
 * brings no sentinel back, and its caret is where the probe found it
 */
documentController.load('- a\n- b\n', r9Options)
settle()
click_test_id('block-0')
type('cmd-up')
press('cmd-]')
await fieldIdle()
type('cmd-shift-z')
type('x')
press('escape')
check(
	'Indent with the caret after “b” indents that item; refused at the first item it changes nothing after its probe, ⇧⌘Z then bringing nothing back and the caret staying put',
	[indentAtCaret, documentController.text],
	['- a\n  - b\n- c\n', 'x- a\n- b\n']
)

// editmd's commands are Undo steps of their own: the typing before Heading 2 stays when ⌘Z takes the heading back
documentController.load('Intro\n', r9Options)
settle()
click_test_id('block-0')
type('x')
press('cmd-alt-2')
await fieldIdle()
press('escape')
press('cmd-z')
settle()
check(
	'a Format command on an open field is an Undo step of its own: after Heading 2 and Escape, one ⌘Z takes the heading back and keeps the typed x',
	documentController.text,
	'Introx\n'
)

// Add Link at the selection, read when Add is pressed; Cancel reads nothing
documentController.load('one two three\n', r9Options)
settle()
click_test_id('block-0')
type('cmd-left right right right right shift-right shift-right shift-right')
menuClipboardUrl = 'https://example.com/x'
press('cmd-k')
settle()
const busyOnSheet = documentController.fieldBusy
press('enter')
await fieldIdle()
type('!')
press('escape')
const linkedText = documentController.text
click_test_id('block-0')
press('cmd-k')
settle()
press('escape')
settle()
const busyAfterCancel = documentController.fieldBusy
press('escape')
menuClipboardUrl = null
check(
	'Add Link with “two” selected makes it the link’s text and puts the caret just after the link; the sheet reads nothing until Add, and Cancel reads nothing',
	[linkedText, busyOnSheet, busyAfterCancel, documentController.text],
	['one [two](https://example.com/x)! three\n', false, false, linkedText]
)

/** Edit's Cut, Copy, Paste, Paste and Match Style, Delete and Select All: whether each is enabled */
const editEnabled = () =>
	(documentController.menus[1]?.items ?? [])
		.slice(3, 9)
		.map((item) => item.kind === 'item' && item.enabled)
documentController.load('Alpha beta\n', r9Options)
settle()
const editClosed = editEnabled()
click_test_id('block-0')
const editOpen = editEnabled()
const editorId = () => find_test_id('block-editor')?.id
openMenu('Edit')
const focusedWithMenu = get_native()?.getFocusedElementId() === editorId()
clickRow('Select All')
await wait(50)
pump()
const focusedAfterMenu = get_native()?.getFocusedElementId() === editorId()
type('q')
press('escape')
check(
	'Edit’s field items are enabled with a field open and greyed without, Delete greyed always; Select All from the menu, which leaves the field its keys, selects the field’s text, so typing replaces it',
	[editClosed, editOpen, focusedWithMenu, focusedAfterMenu, documentController.text],
	[
		[false, false, false, false, false, false],
		[true, true, true, true, false, true],
		true,
		true,
		'q\n'
	]
)

// editmd's Source mode puts its caret at the start (editor.ts:318-322), so its field shows the Document's first line
documentController.load(
	`${Array.from({ length: 80 }, (_line, index) => `line ${index + 1}`).join('\n\n')}\n`,
	r9Options
)
settle()
press('cmd-/')
await wait(150)
pump()
const sourceShowsTop = painted()
	.split('\n')
	.some((line) => line === 'line 1')
type('Z')
const sourceTyped = documentController.text.slice(0, 7)
press('cmd-/')
check(
	'Source mode opens with its caret at the top: the field shows the first line, and typing goes in before it',
	[sourceShowsTop, sourceTyped],
	[true, 'Zline 1']
)

// ⌘F with a query already in the field selects it all, as NSSearchField does
documentController.load('Find me here.\n', r9Options)
settle()
press('cmd-f')
type('m')
type('e')
press('escape')
press('cmd-f')
await wait(100)
pump()
type('h')
const queryAfterRefind = findController.query
press('escape')
check('⌘F with a query in the find field selects it, so typing replaces it', queryAfterRefind, 'h')

// ⌃⌘F is AppKit's View > Enter Full Screen
menuRuns.length = 0
press('ctrl-cmd-f')
check(
	'⌃⌘F toggles full screen',
	menuRuns.filter(([command]) => command === 'toggleFullScreen'),
	[['toggleFullScreen', []]]
)

/**
 * editmd focuses the editor once a Document loads (main.ts:80-84): an empty one takes typing at once, the field showing
 * "Start writing…" in the faint colour until its first character (style.css:392-399)
 */
documentController.load('', r9Options)
settle()
const emptyFieldBox = bounds(find_test_id('block-editor') ?? 0)
const emptyHintInk = emptyFieldBox
	? inkColour(snapshot(), emptyFieldBox, [palette().background ?? ''])
	: null
const emptyField = [find_test_id('block-editor')?.type, propOf('empty-hint-text', 'source')]
type('x')
const typedIntoEmpty = [documentController.text, find_test_id('empty-hint')]
press('escape')
check(
	`an empty Document opens its field on load showing “Start writing…” in the faint colour (${emptyHintInk}) until its first character, so a key typed without a click writes it`,
	[emptyField, near(emptyHintInk ?? '', palette().faint ?? '', 16), typedIntoEmpty],
	[['textarea', 'Start writing…'], true, ['x', null]]
)

/**
 * a linked or dropped file is described as macOS describes it (UTType, src/host/fileKinds.ts), here by recorders: a
 * `.custom` file the recorder calls text opens as a Document, a `.picture` it calls an image goes in as one
 */
const kindsPath = join(r9Directory, 'kinds.md')
writeFileSync(kindsPath, '[notes](notes.custom)\n')
const kindAsks: string[] = []
menuRuns.length = 0
documentController.open(kindsPath, {
	...r9Options,
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
drop_files(find_test_id('block-0') ?? 0, [join(r9Directory, 'shot.picture')])
check(
	'a followed link and a dropped file are told apart by the type the window is handed, macOS’s by default',
	[
		menuRuns.filter(([command]) => command === 'openInEditor' || command === 'open'),
		kindAsks,
		documentController.text.includes('shot.picture')
	],
	[
		[['openInEditor', [join(r9Directory, 'notes.custom')]]],
		['describe notes.custom', 'image shot.picture'],
		true
	]
)

/**
 * row e-drop: a dropped file that is neither an image nor text is shown in Finder, not opened. (placed before the
 * Source mode and front matter checks below: after a front matter field had been open and closed, a headless drop
 * reached no handler at all, measured with a probe, a harness quirk this check does not cover)
 */
const droppedOther = join(r9Directory, 'archive.zip')
writeFileSync(droppedOther, 'PK')
menuRuns.length = 0
menuWindows.length = 0
documentController.load('Drop here.\n', {
	...r9Options,
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
const droppedNote = join(r9Directory, 'dropped-note.md')
writeFileSync(droppedNote, '# Note\n')
menuRuns.length = 0
menuWindows.length = 0
const dropSource = 'One.\n\nTwo.\n\n- [ ] task\n\n| a |\n| - |\n| b |\n'
documentController.load(dropSource, {
	...r9Options,
	describeFile: (filePath: string) => ({ isDirectory: false, isText: filePath.endsWith('.md') }),
	isTextName: (filePath: string) => filePath.endsWith('.md'),
	isImageName: () => false
})
settle()
click_test_id('block-0')
type('cmd-right x')
await fieldIdle()
const dropRevision = documentController.fieldRevision
dropOn('block-1', [droppedNote])
dropOn('block-1', [droppedOther])
// a task's text and a table take their own clicks, so a drop on them is theirs too
dropOn(`task-text-${documentController.blocks[2]?.items?.[0]?.contentStart ?? -1}`, [droppedNote])
dropOn('table-3', [droppedOther])
const afterDrops = [documentController.activeIndex, documentController.fieldRevision - dropRevision]
type('y')
await fieldIdle()
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
const openedPath = join(r9Directory, 'opened.md')
writeFileSync(openedPath, 'Opened.\n')
menuWindows.length = 0
documentController.load('', { ...r9Options, startedByNew: true })
settle()
menuPicks.push([openedPath])
press('cmd-o')
await wait(50)
const fromNewWindow = [[...menuWindows], documentController.hasFile]
menuWindows.length = 0
documentController.load('', r9Options)
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

// editmd's accent caret is drawn only in the page (style.css:105-120): Source mode and front matter keep the system's
documentController.load(fixture('r-frontmatter'), r9Options)
settle()
press('cmd-/')
settle()
const sourceCaret = fieldOf(propOf('source-editor', 'theme'), 'caret')
press('cmd-/')
settle()
click_test_id('block-0')
const frontmatterCaret = fieldOf(propOf('block-editor', 'theme'), 'caret')
press('escape')
click_test_id('block-1')
const blockCaret = fieldOf(propOf('block-editor', 'theme'), 'caret')
press('escape')
check(
	'Source mode’s field keeps the system caret in the text colour and open front matter in the muted colour; a Block’s field keeps the accent caret',
	[sourceCaret, frontmatterCaret, blockCaret],
	[palette().text, palette().muted, palette().accent]
)

// row r-frontmatter: no box without front matter; with it, 2rem below the box
const frontmatterGap = blockGaps()[0]
documentController.load('# No front matter\n', r9Options)
settle()
check(
	'a Document without front matter paints no front matter box; with it, the box keeps 2rem (32px) below it',
	[find_test_id('frontmatter-0'), nearly([frontmatterGap ?? Number.NaN], [32])],
	[null, [32]]
)

/** an Agent hook's Report, through the sockets under `r9Directory`, that it is about to edit `filePath` */
async function reportR9Edit(
	filePath: string,
	session: string,
	environment: Record<string, string>
) {
	await reportEdit(
		JSON.stringify({
			session_id: session,
			cwd: r9Directory,
			hook_event_name: 'PreToolUse',
			tool_input: { file_path: filePath }
		}),
		environment,
		join(r9Directory, 's')
	)
}

/**
 * two Agents on one Block: Alpha changes a word of the paragraph and adds a paragraph, then Beta changes another word
 * of the same paragraph and turns Alpha's paragraph into a heading, a Block marked whole by both
 */
const twoPath = join(r9Directory, 'two.md')
writeFileSync(twoPath, '# Two\n\nThe quick brown fox jumps.\n\nEnd.\n')
documentController.open(twoPath, r9Options)
await wait(100)
await reportR9Edit(twoPath, 'alpha', { EDITMD_AGENT_NAME: 'Alpha' })
writeFileSync(twoPath, '# Two\n\nThe quick green fox jumps.\n\nEnd.\n\nNew one.\n')
await waitUntil(() => documentController.highlights.length === 2, 'Alpha’s changes')
await reportR9Edit(twoPath, 'beta', { EDITMD_AGENT_NAME: 'Beta' })
writeFileSync(twoPath, '# Two\n\nThe quick green fox leaps.\n\nEnd.\n\n## New one.\n')
await waitUntil(() => documentController.highlights.length === 4, 'Beta’s changes')
settle()
await wait(150)
settle()
const twoPalette = palette()
const twoBlock = documentController.blocks[1]
const twoTooltip = documentController.highlights
	.filter(
		({ start, end }) => twoBlock !== undefined && start < twoBlock.end && end > twoBlock.start
	)
	.map(({ author, at }) => highlightTooltip(author.name, at, menuOptions.timeFormat))
	.join('\n')
const twoWashes = (() => {
	const specs = propOf('block-1', 'highlight')
	return (Array.isArray(specs) ? specs : [])
		.map((spec) => [fieldOf(spec, 'query'), fieldOf(spec, 'activeColor')])
		.filter(([query]) => query === 'gree' || query === 'lea')
})()
const twoTip = await tipAfterHover('block-1', 'block-tooltip-1-tip')
check(
	'every Agent highlight on a Block paints: each changed run washed in its own Agent’s colour, a Block marked whole by two Agents tinted by the latest, the tooltip listing every change',
	[
		twoWashes,
		find_test_id('block-3')?.style?.backgroundColor,
		find_test_id('block-3')?.style?.borderColor,
		twoTip
	],
	[
		[
			['gree', twoPalette['agent-0-change']],
			['lea', twoPalette['agent-1-change']]
		],
		twoPalette['agent-1-tint'],
		twoPalette['agent-1'],
		twoTooltip
	]
)

/**
 * editmd underlines a changed run, `.agent-change { box-shadow: inset 0 -2px 0 color-mix(var(--agent) 70%,
 * transparent) }` (style.css:468-472): a 2px bar along the bottom of each painted run, its Agent's colour at 70%
 */
mouse_move({ x: 5, y: 300 })
settle()
const half = (value: number) => Math.round(value * 2) / 2
const runColours: Record<string, string | undefined> = {
	gree: twoPalette['agent-0-deleted'],
	lea: twoPalette['agent-1-deleted']
}
const wantedUnderlines = painted_highlights()
	.filter(({ active, text, start, end }) => active && text.slice(start, end) in runColours)
	.flatMap(({ text, start, end, rects }) =>
		rects.map((rect) => [
			half(rect.x),
			half(rect.y + rect.height),
			half(rect.width),
			2,
			runColours[text.slice(start, end)]
		])
	)
	.sort((a, b) => Number(a[0]) - Number(b[0]))
const paintedUnderlines = find_all((node) => node.testId?.startsWith('run-underline-') === true)
	.map((node) => {
		const box = bounds(node)
		return box
			? [
					half(box.x),
					half(box.y + box.height),
					half(box.width),
					half(box.height),
					node.style?.backgroundColor
				]
			: null
	})
	.sort((a, b) => Number(a?.[0]) - Number(b?.[0]))
// GPUI snaps a box to the 2x display's half-pixel grid, so each length is held to its run's within half a pixel
const underlinesMatch = wantedUnderlines.map((wanted, index) => {
	const line = paintedUnderlines[index]
	return (
		line !== null &&
		line !== undefined &&
		wanted.every((value, at) =>
			typeof value === 'number' ? Math.abs(Number(line[at]) - value) <= 0.5 : line[at] === value
		)
	)
})
check(
	`each washed run is underlined by a 2px bar along its bottom in its Agent’s colour at 70% (${JSON.stringify(paintedUnderlines)})`,
	[wantedUnderlines.length, paintedUnderlines.length, underlinesMatch],
	[2, 2, [true, true]]
)

// editmd's legend name is one line, ellipsized past the legend's `max-width: min(18rem, …)` (style.css:581-592)
const alphaId = documentController.agents[0]?.id ?? ''
documentController.renameAgent(
	alphaId,
	'An agent with a very long name that runs past the legend edge'
)
settle()
const longNameBox = bounds(find_test_id('legend-name-text-0') ?? 0)
const longLegendBox = bounds(find_test_id('legend') ?? 0)
/**
 * the ellipsis itself cannot be read: the frame's painted text holds the whole name, though the window paints it cut
 * with "…" (seen in a screenshot)
 */
check(
	`a 60-character Agent name stays on one line inside the legend’s 288px (name ${longNameBox?.height}px high, legend ${longLegendBox?.width}px wide)`,
	[
		longNameBox ? longNameBox.height <= 12 * 1.4 + 0.5 : null,
		longLegendBox ? longLegendBox.width <= 288.5 : null,
		longNameBox && longLegendBox
			? longNameBox.x + longNameBox.width <= longLegendBox.x + longLegendBox.width
			: null
	],
	[true, true, true]
)

/** a code Block taller than the window, a change by Gamma and a Find match deep inside it */
const tallPath = join(r9Directory, 'tall.md')
const tallRows = (changed: boolean) =>
	Array.from({ length: 90 }, (_row, index) =>
		index === 69 && changed ? 'row seventy' : index === 74 ? 'needle here' : `row ${index + 1}`
	).join('\n')
writeFileSync(tallPath, `# Tall\n\nFirst.\n\n\`\`\`\n${tallRows(false)}\n\`\`\`\n\nAfter.\n`)
documentController.open(tallPath, r9Options)
await wait(100)
await reportR9Edit(tallPath, 'gamma', { EDITMD_AGENT_NAME: 'Gamma' })
writeFileSync(tallPath, `# Tall\n\nFirst.\n\n\`\`\`\n${tallRows(true)}\n\`\`\`\n\nAfter.\n`)
await waitUntil(() => documentController.highlights.length === 1, 'Gamma’s change')
settle()
const gammaRun = documentController.highlights[0]?.runs?.[0]?.text ?? 'no run'
clickIfPresent('legend-name-0')
await wait(200)
pump()
const gammaRect = painted_highlights().find(
	({ active, text, start, end }) => active && text.slice(start, end) === gammaRun
)?.rects[0]
const pageMiddle = (() => {
	const bar = bounds(find_test_id('menu-bar') ?? 0)
	return bar ? (bar.y + bar.height + 538) / 2 : Number.NaN
})()
check(
	`the legend reveals a run deep in a Block taller than the window by putting the run’s own top at the middle of the page, as editmd's coordsAtPos (run ${gammaRun} at ${gammaRect?.y}, middle ${pageMiddle})`,
	gammaRect ? Math.abs(gammaRect.y - pageMiddle) <= 1 : null,
	true
)

// Find steps to a match deep in that Block and scrolls the match itself into view, not the Block's top
press('cmd-f')
// the field selects the query left from before (⌘F above) once it has the keys, so typing replaces it
await wait(100)
pump()
for (const key of 'needle') type(key)
await findState()
await wait(200)
pump()
const needleRect = painted_highlights().find(
	({ active, text, start, end }) => active && text.slice(start, end).toLowerCase() === 'needle'
)?.rects[0]
press('escape')
check(
	`Find scrolls the active match in a Block taller than the window into view (match at ${needleRect?.y})`,
	needleRect ? needleRect.y >= 0 && needleRect.y + needleRect.height <= 538 : null,
	true
)
documentController.load('')

/**
 * row r-tasks: editmd's ticked box draws its check as an SVG path, `M2.5 6.2 5 8.6 9.6 3.6` in a 12-unit box, stroked
 * white 1.8 wide with round caps and joins, at 75% of the box (style.css:262-266), in light and in dark
 */
const TICK_PATH = 'M2.5 6.2 5 8.6 9.6 3.6'
async function tickLook(appearance: Appearance) {
	await app.unmount()
	app = mount_headless(App, {
		width: 800,
		height: 538,
		props: {
			theme: new ThemeController({
				initialAppearance: () => appearance,
				readAppearance: () => appearance
			})
		}
	})
	documentController.load('- [x] done\n', r9Options)
	settle()
	const tick = find((node) => node.testId?.startsWith('task-tick-') === true)
	const box = bounds(find((node) => /^task-\d+$/.test(node.testId ?? '')) ?? 0)
	const snap = snapshot()
	let white = 0
	if (box)
		for (
			let y = Math.round(box.y * snap.scale);
			y < Math.round((box.y + box.height) * snap.scale);
			y++
		)
			for (
				let x = Math.round(box.x * snap.scale);
				x < Math.round((box.x + box.width) * snap.scale);
				x++
			)
				if (near(devicePixel(snap, x, y), '#ffffff', 24)) white++
	return [tick?.type, String(tick?.customProps?.source ?? '').includes(TICK_PATH), white > 10]
}
const tickLooks = [await tickLook('light'), await tickLook('dark')]
await app.unmount()
app = mount_headless(App, { width: 800, height: 538 })
check('a ticked task’s box draws editmd’s check path in white, in light and in dark', tickLooks, [
	['svg', true, true],
	['svg', true, true]
])

/**
 * row mermaid editing: the source card keeps editmd's `.code-block.mermaid.editing > pre { margin-bottom: 0.5em }`
 * of its 13.5px, 6.75px, above the live diagram (style.css:417-419)
 */
documentController.load('```mermaid\nflowchart LR\n  A --> B\n```\n', r9Options)
settle()
click_test_id('block-0')
settle()
const mermaidCard = bounds(find_test_id('block-editor-card') ?? 0)
/**
 * measured in the paint, since GPUI reports a padded box's origin moved in by its padding: down a column inside the
 * card, from its last row in the surface colour to the live diagram's 1px border
 */
const mermaidGap = (() => {
	if (!mermaidCard) return Number.NaN
	const snap = snapshot()
	// near the card's right edge, clear of the source text and the language label
	const column = Math.round((mermaidCard.x + mermaidCard.width - 60) * snap.scale)
	let cardEnd = Math.round((mermaidCard.y + 20) * snap.scale)
	while (near(devicePixel(snap, column, cardEnd), palette().surface ?? '', 3)) cardEnd++
	const border = firstRowNear(
		snap,
		column,
		cardEnd,
		cardEnd + Math.round(60 * snap.scale),
		palette().border ?? '',
		6
	)
	return border < 0 ? Number.NaN : (border - cardEnd) / snap.scale
})()
press('escape')
check(
	`an open mermaid Block’s source card sits 6.75px above its live diagram (${mermaidGap})`,
	nearly([mermaidGap], [6.75]),
	[6.75]
)

/**
 * editmd's `.source { min-height: 70vh; field-sizing: content }` (style.css:88-103) grows to its whole text, and the
 * page scrolls it: on 80 lines its field is 80 of its 22.4px lines tall, and scrolled to the bottom the page shows the
 * 80th line
 */
documentController.load(
	`${Array.from({ length: 80 }, (_line, index) => `line ${index + 1}`).join('\n')}\n`,
	r9Options
)
settle()
press('cmd-/')
await wait(150)
pump()
const sourceFieldHeight = bounds(find_test_id('source-editor') ?? 0)?.height ?? 0
wheel({ x: 400, y: 300 }, 0, -100_000)
settle()
await wait(50)
pump()
// the field's last row in the window: its paint holds every line wherever it is, so its box says what shows
const scrolledField = bounds(find_test_id('source-editor') ?? 0)
const sourceShowsLast =
	painted()
		.split('\n')
		.some((line) => line === 'line 80') &&
	scrolledField !== null &&
	scrolledField.y + scrolledField.height <= 538
press('cmd-/')
settle()
// GPUI lays a field's rows out at whole pixels: 22px for the 22.4px line, 21px for code's 20.925px (measured)
check(
	`Source mode’s field grows to its whole text, which the page scrolls: 80 lines make it at least 80 of its 22px rows tall (${sourceFieldHeight}px), and the 80th paints at the bottom`,
	[sourceFieldHeight >= 80 * 22, sourceShowsLast],
	[true, true]
)

// editmd shows a Block whole while it is edited: a 60-line code block's field holds every line, 20.925px each
documentController.load(
	`\`\`\`\n${Array.from({ length: 60 }, (_line, index) => `code ${index + 1}`).join('\n')}\n\`\`\`\n`,
	r9Options
)
settle()
// the Block is taller than the window, so the click lands near its top rather than at its centre
const tallCodeBox = bounds(find_test_id('block-0') ?? 0)
if (tallCodeBox) click_at(tallCodeBox.x + 40, tallCodeBox.y + 30)
settle()
const codeFieldHeight = bounds(find_test_id('block-editor') ?? 0)?.height ?? 0
press('escape')
check(
	`a Block’s field holds its whole text: a 60-line code block’s field is at least its 62 lines (fences included) of 21px rows tall (${codeFieldHeight}px)`,
	codeFieldHeight >= 62 * 21,
	true
)

/**
 * with no field open, editmd's commands act at its load caret, the start of the text of the first Block that
 * holds text (`firstTextOffset`; front matter, rules and definitions have none): Outdent there takes the first item
 * out of its list, Add Link puts the URL before the first word, and Heading 2 passes over a rule to its paragraph
 */
documentController.load('- a\n- b\n- c\n', r9Options)
settle()
press('cmd-[')
press('escape')
const outdentAtLoad = documentController.text
documentController.load('see docs\n', r9Options)
settle()
menuClipboardUrl = 'https://a.example'
press('cmd-k')
settle()
press('enter')
await fieldIdle()
press('escape')
menuClipboardUrl = null
const linkAtLoad = documentController.text
documentController.load('---\n\npara\n', r9Options)
settle()
press('cmd-alt-2')
press('escape')
const headingAtLoad = documentController.text
check(
	'with no field open a command acts at editmd’s load caret, the start of the first Block holding text: Outdent, Add Link and Heading 2',
	[outdentAtLoad, linkAtLoad, headingAtLoad],
	['a\n\n- b\n- c\n', '<https://a.example>see docs\n', '---\n\n## para\n']
)

/**
 * editmd's reveal steps through every highlight, one stop each (`AgentLegend.nextStop`): two changes by one Agent in one
 * tall Block are two stops, each putting its own run's top at the middle of the page
 */
const stopsPath = join(r9Directory, 'stops.md')
// each change writes its own word before its row, so each run's text is its own
const stopRows = (changed: number[]) =>
	Array.from({ length: 90 }, (_row, index) =>
		changed.includes(index)
			? `${index === 29 ? 'alpha' : 'omega'} row ${index + 1}`
			: `row ${index + 1}`
	).join('\n')
writeFileSync(stopsPath, `# Stops\n\n\`\`\`\n${stopRows([])}\n\`\`\`\n`)
documentController.open(stopsPath, r9Options)
await wait(100)
await reportR9Edit(stopsPath, 'delta', { EDITMD_AGENT_NAME: 'Delta' })
writeFileSync(stopsPath, `# Stops\n\n\`\`\`\n${stopRows([29])}\n\`\`\`\n`)
await waitUntil(() => documentController.highlights.length === 1, 'Delta’s first change')
await reportR9Edit(stopsPath, 'delta', { EDITMD_AGENT_NAME: 'Delta' })
writeFileSync(stopsPath, `# Stops\n\n\`\`\`\n${stopRows([29, 69])}\n\`\`\`\n`)
await waitUntil(() => documentController.highlights.length === 2, 'Delta’s second change')
settle()
/** where the run `text` paints its top, against the middle of the page */
function runFromMiddle(text: string): number {
	const rect = painted_highlights().find(
		({ active, text: run, start, end }) => active && run.slice(start, end) === text
	)?.rects[0]
	return rect ? Math.round(rect.y - pageMiddle) : Number.NaN
}
const stopRuns = documentController.highlights.map(({ runs }) => runs?.[0]?.text ?? '')
clickIfPresent('legend-name-0')
await wait(200)
pump()
const firstStop = stopRuns.map(runFromMiddle)
clickIfPresent('legend-name-0')
await wait(200)
pump()
const secondStop = stopRuns.map(runFromMiddle)
check(
	`two changes by one Agent in one Block are two stops of the legend’s reveal, each run’s top at the page’s middle in turn (runs ${JSON.stringify(stopRuns)}: ${JSON.stringify(firstStop)}, then ${JSON.stringify(secondStop)})`,
	[Math.abs(firstStop[0] ?? Number.NaN) <= 1, Math.abs(secondStop[1] ?? Number.NaN) <= 1],
	[true, true]
)

/**
 * editmd's read-only mono text is SF Mono (`--font-mono: ui-monospace`): the closed front matter, a definition line, a
 * block of HTML and a diagram's messages. SF Mono's advance is 98.90625/160 of the size (ten `i`s 98.9px at 16px),
 * Menlo's 96.328/160. each element's advance, from the width Find washes over a run of one letter
 */
documentController.load(
	'---\ntitle: iiiiiiiiii\n---\n\n[iiiiiiiiii]: https://example.com\n\n<div>iiiiiiiiii</div>\n\n```mermaid\nnonsense\n```\n\n```mermaid\n```\n',
	r9Options
)
settle()
/** each painted wash of the query, by the test id of the element it is in, as its width per character */
async function advancesOf(query: string, testIds: string[]): Promise<number[]> {
	press('cmd-f')
	await wait(100)
	pump()
	for (const key of query) type(key === ' ' ? 'space' : key)
	await findState()
	// a wash names the element that painted its run: the test id's own, or a text node inside it
	const idsWithin = (node: TreeNode | null): number[] =>
		node ? [node.id, ...(node.children ?? []).flatMap((child) => idsWithin(child))] : []
	const advances = testIds.map((testId) => {
		const ids = idsWithin(find_test_id(testId))
		const wash = painted_highlights().find(
			({ elementId, text, start, end }) =>
				ids.includes(elementId) && text.slice(start, end).toLowerCase() === query.toLowerCase()
		)
		const width = wash?.rects.reduce((sum, rect) => sum + rect.width, 0) ?? Number.NaN
		return Math.round((width / query.length) * 1000) / 1000
	})
	press('escape')
	return advances
}
const letterAdvances = await advancesOf('iiiiiiiiii', [
	'frontmatter-0',
	'source-line-1',
	'source-line-2'
])
const messageAdvances = await advancesOf('diagram', ['mermaid-error-3', 'mermaid-empty-4'])
const sfMono = (size: number) => Math.round(((size * 98.90625) / 160) * 1000) / 1000
const nearAdvance = (measured: number[], wanted: number[]) =>
	measured.map((advance, index) =>
		Math.abs(advance - (wanted[index] ?? 0)) <= 0.02 ? wanted[index] : advance
	)
check(
	`closed front matter, definition and HTML lines and diagram messages paint in SF Mono (advances ${JSON.stringify([...letterAdvances, ...messageAdvances])})`,
	nearAdvance(
		[...letterAdvances, ...messageAdvances],
		[sfMono(12.5), sfMono(13.76), sfMono(13.76), sfMono(12.5), sfMono(12.5)]
	),
	[sfMono(12.5), sfMono(13.76), sfMono(13.76), sfMono(12.5), sfMono(12.5)]
)

/**
 * a diagram's message is centred in its box as editmd's `.diagram` centres its child (style.css:421-431): the error
 * here is narrower than the box, so the space left of it equals the space right of it
 */
const messageBox = bounds(find_test_id('mermaid-error-3') ?? 0)
const messageFrame = bounds(find((_node, parent) => parent?.testId === 'mermaid-box-3') ?? 0)
const errorMargins =
	messageBox && messageFrame
		? [
				Math.round(messageBox.x - messageFrame.x),
				Math.round(messageFrame.x + messageFrame.width - messageBox.x - messageBox.width)
			]
		: null
check(
	`a diagram’s error narrower than its box is centred in it (left, right ${JSON.stringify(errorMargins)})`,
	errorMargins ? [errorMargins[0]! > 0, Math.abs(errorMargins[0]! - errorMargins[1]!) <= 1] : null,
	[true, true]
)

/**
 * editmd wraps its read-only mono text: `.frontmatter { white-space: pre-wrap }` (style.css:80), a definition's
 * `overflow-wrap: anywhere` (style.css:356). a 200-character front matter value and a definition's 200-character URL
 * wrap inside the column (more than their one line each), and a YAML item keeps its two leading spaces, two SF Mono
 * advances at 12.5px before its `-`, read from where Find's wash over `- item` starts
 */
documentController.load(
	`---\ntitle: ${'v'.repeat(200)}\nlist:\n  - item\n---\n\n[ref]: https://example.com/${'a'.repeat(200)}\n`,
	r9Options
)
settle()
const longFrontmatter = bounds(find_test_id('frontmatter-0') ?? 0)
const longDefinition = bounds(find_test_id('source-line-1') ?? 0)
press('cmd-f')
await wait(100)
pump()
for (const key of '- item') type(key === ' ' ? 'space' : key)
await findState()
const frontmatterIds = (function idsWithin(node: TreeNode | null): number[] {
	return node ? [node.id, ...(node.children ?? []).flatMap((child) => idsWithin(child))] : []
})(find_test_id('frontmatter-0'))
const itemWash = painted_highlights().find(({ elementId }) => frontmatterIds.includes(elementId))
const itemOffset =
	itemWash?.rects[0] && longFrontmatter
		? Math.round((itemWash.rects[0].x - longFrontmatter.x) * 100) / 100
		: null
press('escape')
check(
	`a 200-character front matter value and definition URL wrap inside the column, and a YAML item keeps its two spaces (front matter ${longFrontmatter?.width}×${longFrontmatter?.height}, definition ${longDefinition?.width}×${longDefinition?.height}, item at ${itemOffset})`,
	[
		longFrontmatter
			? longFrontmatter.width <= 656 - 32 && longFrontmatter.height > 5 * 19.375 + 1
			: null,
		longDefinition ? longDefinition.width <= 656 && longDefinition.height > 22.704 + 1 : null,
		itemOffset === null ? null : Math.abs(itemOffset - 2 * sfMono(12.5)) <= 0.5
	],
	[true, true, true]
)

/**
 * editmd's `#editor` keeps `padding-bottom: 40vh` below Source mode's field too (style.css:64-69): scrolled to the end,
 * 40% of the window shows below the field's last line
 */
documentController.load(
	`${Array.from({ length: 80 }, (_line, index) => `line ${index + 1}`).join('\n')}\n`,
	r9Options
)
settle()
press('cmd-/')
await wait(150)
pump()
wheel({ x: 400, y: 300 }, 0, -100_000)
settle()
// the scrolling column's own box moves with its offset, so the page's end is the 538px window's bottom edge
const sourceEnd = bounds(find_test_id('source-editor') ?? 0)
const belowSource = sourceEnd ? Math.round((538 - sourceEnd.y - sourceEnd.height) * 10) / 10 : null
press('cmd-/')
settle()
check(
	`scrolled to the end, Source mode’s page leaves 40% of the window below its field (${belowSource}px)`,
	belowSource === null ? null : nearly([belowSource], [toHalfPixels(538 * 0.4)]),
	[toHalfPixels(538 * 0.4)]
)

/**
 * where ⌘F finds text, stated as it is (no change): inside Source mode's field, inside an open Block's field, inside
 * the closed front matter box. editmd's WKWebView find searches the page's text, its textarea's included
 */
async function findCount(query: string): Promise<number> {
	press('cmd-f')
	await wait(100)
	pump()
	for (const key of query) type(key)
	await findState()
	const total = findController.total
	press('escape')
	return total
}
documentController.load('---\ntitle: zebra\n---\n\nquokka here\n', r9Options)
settle()
const findInFrontmatter = await findCount('zebra')
click_test_id('block-1')
settle()
const findInOpenField = await findCount('quokka')
press('escape')
press('cmd-/')
settle()
const findInSource = await findCount('quokka')
press('cmd-/')
settle()
check(
	`⌘F’s matches inside the closed front matter box, an open Block’s field and Source mode’s field (${findInFrontmatter}, ${findInOpenField}, ${findInSource})`,
	[findInFrontmatter, findInOpenField, findInSource],
	[1, 0, 0]
)

/**
 * what follows an item's nested list is a continuation row of that item (ListItem.continuation): no marker,
 * its text at its item's content column, after the nested items
 */
documentController.load('- a\n  - b\n\n  more text\n- c\n', r9Options)
settle()
const continuationLines = painted().split('\n')
const listItems = documentController.blocks[0]?.items ?? []
const continuationRow = listItems.find((item) => item.continuation)
const firstItemText = bounds(find_test_id(`list-text-${listItems[0]?.contentStart}`) ?? 0)
const continuationText = bounds(
	find_test_id(`list-text-${continuationRow?.contentStart ?? -1}`) ?? 0
)
check(
	`a list item’s text after its nested list paints after the nested item, with no marker, at the item’s text column (lines ${JSON.stringify(continuationLines)}, x ${firstItemText?.x} and ${continuationText?.x})`,
	[
		['b', 'more text', 'c']
			.map((line) => continuationLines.indexOf(line))
			.every((at, index, all) => at >= 0 && (index === 0 || at > all[index - 1]!)),
		firstItemText !== null && continuationText !== null && firstItemText.x === continuationText.x,
		find_test_id(`list-marker-${continuationRow?.contentStart ?? -1}`)
	],
	[true, true, null]
)

/**
 * SAFETY: a probe whose reply comes only after it gave up (its wait cut to 0ms through `fieldReplyMs`) leaves the
 * Document as it was: the late reply carries the sentinel, and never reaches the Edit session
 */
documentController.load('one two three\n', { ...r9Options, fieldReplyMs: 0 })
settle()
click_test_id('block-0')
type('cmd-left right right right right shift-right shift-right shift-right')
menuRuns.length = 0
const lateProbe = await probedRange()
for (let round = 0; round < 5; round++) {
	await wait(30)
	pump()
}
const afterLateProbe = [
	documentController.text,
	documentController.edited,
	menuRuns.filter(([command]) => command === 'setWindowTitle')
]
press('escape')
check(
	`a probe that gives up before the field replies never lets the late reply, sentinel and all, into the Document (${JSON.stringify(afterLateProbe)})`,
	[lateProbe, afterLateProbe, documentController.text],
	[null, ['one two three\n', false, []], 'one two three\n']
)

/**
 * NSDocument follows a file another program renames (`presentedItemDidMove`, DocumentFile.onMoved): the window takes
 * the new name, a later write at the new path merges in, and Open Recent holds the new path
 */
const movingPath = join(r9Directory, 'moving.md')
const movedPath = join(r9Directory, 'moved.md')
writeFileSync(movingPath, 'Moving.\n')
documentController.open(movingPath, r9Options)
await wait(100)
menuRuns.length = 0
renameSync(movingPath, movedPath)
await waitUntil(
	() => menuRuns.some(([command, args]) => command === 'setWindowTitle' && args[0] === 'moved.md'),
	'the new title'
)
writeFileSync(movedPath, 'Moving.\n\nLater.\n')
await waitUntil(() => documentController.text.includes('Later.'), 'the write at the new path')
check(
	'a file renamed by another program is followed: the window takes its new name, a write there merges in, Open Recent holds the new path',
	[
		menuRuns.filter(([command]) => command === 'setWindowTitle'),
		documentController.text,
		r9Options.recentFiles.list()[0]
	],
	// the open descriptor names the file by its real path (`/private/var/…` for the temp folder's `/var/…`)
	[[['setWindowTitle', ['moved.md']]], 'Moving.\n\nLater.\n', realpathSync(movedPath)]
)

/**
 * editmd's "Start writing…" shows for a body with no text (style.css:394-399): a Document of blank lines, and one of
 * front matter only, where it paints below the box (frontmatter.ts:104)
 */
documentController.load('\n\n\n', r9Options)
settle()
const blankHint = painted().includes('Start writing…')
press('escape')
documentController.load('---\ntitle: A\n---\n', r9Options)
settle()
const frontmatterOnlyHint = painted().includes('Start writing…')
const bodyHintBox = bounds(find_test_id('empty-hint') ?? 0)
const frontmatterOnlyBox = bounds(find_test_id('frontmatter-box-0') ?? 0)
check(
	'a Document of blank lines shows “Start writing…”, and one of front matter only shows it below its box',
	[
		blankHint,
		frontmatterOnlyHint,
		bodyHintBox !== null &&
			frontmatterOnlyBox !== null &&
			bodyHintBox.y >= frontmatterOnlyBox.y + frontmatterOnlyBox.height
	],
	[true, true, true]
)

// with no field open a command acts where editmd's caret was last: the Block of the last closed Edit session
documentController.load('one\n\ntwo\n\nthree\n', r9Options)
settle()
click_test_id('block-2')
type('x')
press('escape')
press('cmd-alt-2')
press('escape')
check(
	'with no field open, Heading 2 acts on the Block edited last, where editmd’s caret stayed',
	documentController.text,
	'one\n\ntwo\n\n## threex\n'
)

/**
 * a Block that only lost text in a Disk merge (`Highlight.removed`): its tooltip is editmd's "Deleted by <name>,
 * <time>:" and the text taken away (highlights.ts:189-219)
 */
const losingPath = join(r9Directory, 'losing.md')
writeFileSync(losingPath, 'one two three\n')
documentController.open(losingPath, r9Options)
await wait(100)
await reportR9Edit(losingPath, 'zeta', { EDITMD_AGENT_NAME: 'Zeta' })
writeFileSync(losingPath, 'one three\n')
await waitUntil(() => documentController.highlights.length === 1, 'Zeta’s removal')
settle()
const removal = documentController.highlights[0]
const removalTip = await tipAfterHover('block-0', 'block-tooltip-0-tip')
check(
	`text taken away inside a Block is titled as editmd titles a deletion (${JSON.stringify(removalTip)})`,
	[removal?.removed, removalTip],
	[
		'wo t',
		removal
			? deletionTooltip('Zeta', removal.at, removal.removed ?? '', menuOptions.timeFormat)
			: null
	]
)

// NSDocument keeps a document's type through Save As: a .txt document saved as "copy" becomes copy.txt (saveAsPath)
const textPath = join(r9Directory, 'notes.txt')
writeFileSync(textPath, 'plain text\n')
documentController.open(textPath, r9Options)
settle()
press('cmd-shift-s')
settle()
retype('notes.txt', 'copy')
press('enter')
settle()
check(
	'Save As of a .txt document named “copy” writes copy.txt, not copy.md',
	[
		existsSync(join(r9Directory, 'copy.txt')),
		existsSync(join(r9Directory, 'copy.md')),
		existsSync(join(r9Directory, 'copy.txt.md'))
	],
	[true, false, false]
)

/**
 * ⌘Q (a Command of its own, shortcuts.ts): a file's unsaved edit is written before the process ends (`closeWindow`, a
 * recorder here), and an untitled Document with edits asks first, as Close does. headless only: in a real window
 * GPUI's own Quit binding takes ⌘Q before any listener (measured in a real window)
 */
const quitPath = join(r9Directory, 'quit.md')
writeFileSync(quitPath, 'Quit.\n')
documentController.open(quitPath, r9Options)
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
documentController.load('', r9Options)
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
const goneRevertPath = join(r9Directory, 'revert.md')
writeFileSync(goneRevertPath, 'Kept.\n')
documentController.open(goneRevertPath, r9Options)
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

/**
 * editmd refuses Bold in code and its front matter box never takes Format (`takesMarks`): the field keeps its text,
 * no probe is typed, nothing is remounted. Add Link in front matter, which `linkAtSelection` refuses, the same
 */
const marklessText = '---\ntitle: x\n---\n\n```js\nlet a\n```\n'
documentController.load(marklessText, r9Options)
settle()
/** a format or Add Link in Block `index`'s field: whether the Document and the field stayed as they were */
async function leavesField(index: number, act: () => void): Promise<[string, boolean]> {
	click_test_id(`block-${index}`)
	settle()
	type('cmd-up shift-right shift-right shift-right')
	const fieldId = find_test_id('block-editor')?.id
	act()
	await fieldIdle()
	const result: [string, boolean] = [
		documentController.text,
		find_test_id('block-editor')?.id === fieldId
	]
	press('escape')
	return result
}
const boldInCode = await leavesField(1, () => press('cmd-b'))
const boldInFrontmatter = await leavesField(0, () => press('cmd-b'))
menuClipboardUrl = 'https://x.example'
const linkInFrontmatter = await leavesField(0, () => {
	press('cmd-k')
	settle()
	press('enter')
})
menuClipboardUrl = null
check(
	'Bold in an open code field and in the front matter field, and Add Link in the front matter field, change nothing and remount nothing',
	[boldInCode, boldInFrontmatter, linkInFrontmatter],
	[
		[marklessText, true],
		[marklessText, true],
		[marklessText, true]
	]
)

/** the colour `a` over `b` at `alpha`, as `#rrggbb` */
function blend(b: string, a: string, alpha: number): string {
	const channels = (hex: string) =>
		[1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
	const [cb, ca] = [channels(b), channels(a)]
	return `#${cb
		.map((value, index) =>
			Math.round(value + ((ca[index] ?? 0) - value) * alpha)
				.toString(16)
				.padStart(2, '0')
		)
		.join('')}`
}
/**
 * editmd's selection is `--selection`, the accent at 22% (style.css:12, 60-62), where gpuix washes at its accent's 35%:
 * the window sets `selection-color` for its whole subtree, the page's painted text and its fields
 */
documentController.load('Select every word of this line.\n', r9Options)
settle()
const selectionStyle = find_test_id('window')?.style?.selectionColor
const selectBox = bounds(find_test_id('block-0') ?? 0)
if (selectBox)
	drag_select(
		{ x: selectBox.x + 1, y: selectBox.y + selectBox.height / 2 },
		{ x: selectBox.x + selectBox.width - 1, y: selectBox.y + selectBox.height / 2 }
	)
const paintedWash = selectBox
	? inkColour(snapshot(), selectBox, [palette().background ?? '', palette().text ?? ''])
	: null
click_test_id('block-0')
type('cmd-a')
settle()
const fieldBox = bounds(find_test_id('block-editor') ?? 0)
const fieldWash = fieldBox
	? inkColour(snapshot(), fieldBox, [palette().background ?? '', palette().text ?? ''])
	: null
press('escape')
const wantedWash = blend(palette().background ?? '', palette().accent ?? '', 0.22)
// a <textarea> refuses `selection-color`, inherited or its own (measured): its wash stays what it was, stated here
check(
	`the painted text’s selection washes in editmd’s accent at 22%; a field’s keeps gpuix’s own wash, which refuses selection-color (style ${selectionStyle}; painted ${paintedWash}, want ${wantedWash}; field ${fieldWash})`,
	[selectionStyle, near(paintedWash ?? '', wantedWash, 6), near(fieldWash ?? '', wantedWash, 6)],
	[palette().selection, true, false]
)

/**
 * editmd's inline code inherits its text's colour (style.css:185-191): in a quote, a ticked task, a footnote and an
 * h6, all muted, the code is muted too
 */
documentController.load(
	'> a `code`\n\n- [x] done `code`\n\n###### small `code`\n\nNote[^1].\n\n[^1]: see `code`\n',
	r9Options
)
settle()
const codeColours = [
	fieldOf(propOf('quote-text-0', 'theme'), 'codeText'),
	fieldOf(
		find(
			(node) =>
				node.type === 'markdown' && node.customProps?.source?.toString().includes('done') === true
		)?.customProps?.theme,
		'codeText'
	),
	fieldOf(find_test_id('block-2')?.children?.[0]?.customProps?.theme, 'codeText'),
	fieldOf(propOf('footnote-4', 'theme'), 'codeText')
]
check(
	`inline code in a quote, a ticked task, an h6 and a footnote paints in their muted colour (${JSON.stringify(codeColours)})`,
	codeColours,
	[palette().muted, palette().muted, palette().muted, palette().muted]
)

// editmd's `li > p { margin: 0 }` (style.css:235): an item's two paragraphs stack with no gap between them
documentController.load('- one\n\n  two\n', r9Options)
settle()
const twoParagraphItem = bounds(
	find_test_id(`list-text-${documentController.blocks[0]?.items?.[0]?.contentStart ?? -1}`) ?? 0
)
check(
	`a list item’s two paragraphs stack with no gap, two 26.4px lines (${twoParagraphItem?.height}px)`,
	twoParagraphItem ? nearly([twoParagraphItem.height], [52.8]) : null,
	[52.8]
)

/**
 * a paragraph of only images lays them out as WebKit lays out inline images: side by side, wrapping at the column, a
 * space apart (the badge row of a README)
 */
for (const name of ['a', 'b', 'c']) writeFileSync(join(r9Directory, `${name}.png`), png(100, 50))
const badgesPath = join(r9Directory, 'badges.md')
writeFileSync(badgesPath, '![a](a.png) ![b](b.png) ![c](c.png)\n')
documentController.open(badgesPath, r9Options)
settle()
await wait(300)
settle()
const badgeBoxes = [0, 1, 2].map((n) => bounds(find_test_id(`image-0-${n}`) ?? 0))
check(
	`a paragraph of three images paints them side by side on one line (${JSON.stringify(badgeBoxes.map((box) => box && [box.x, box.y]))})`,
	[
		badgeBoxes.every((box) => box !== null && box.y === badgeBoxes[0]?.y),
		badgeBoxes.every(
			(box, n) => n === 0 || (box !== null && box.x >= (badgeBoxes[n - 1]?.x ?? 0) + 100)
		)
	],
	[true, true]
)

// Format > Table's empty cells: every row's cells share one top and one height across the columns
documentController.load(`${TABLE}\n`, r9Options)
settle()
const tableRowLooks = [0, 1, 2].map((row) =>
	[0, 1, 2].map((column) => {
		const box = bounds(find_test_id(`table-cell-${row}-${column}`) ?? 0)
		return box ? [box.y, box.height] : null
	})
)
check(
	`Format > Table’s empty rows line up: each row’s cells share their top and height (${JSON.stringify(tableRowLooks)})`,
	tableRowLooks.map((cells) =>
		cells.every((cell) => JSON.stringify(cell) === JSON.stringify(cells[0]))
	),
	[true, true, true]
)

/**
 * a tooltip in the palette's colours rather than gpuix Tooltip's own `#313244` and `#cdd6f4` (its `--tooltip-surface`
 * and `--tooltip-ink`): editmd's is the system's, here the surface with the text colour
 */
documentController.load('![tracker](https://example.com/p.png)\n', r9Options)
settle()
await tipAfterHover('remote-image-0-0', 'remote-image-tooltip-0-0-tip')
const tipStyle = find_test_id('remote-image-tooltip-0-0-tip')?.style
check(
	`a tooltip paints in the palette’s surface and text colours (${tipStyle?.backgroundColor}, ${tipStyle?.color})`,
	[tipStyle?.backgroundColor, tipStyle?.color],
	[palette().surface, palette().text]
)
mouse_move({ x: 5, y: 500 })

// a loaded remote image paints at its natural size, read from its bytes as a local image's are
documentController.load('![remote](https://example.com/natural.png)\n', {
	...r9Options,
	fetchImage: () => Promise.resolve(png(300, 200))
})
settle()
documentController.allowRemoteImages()
await waitUntil(
	() => bounds(find_test_id('image-0-0') ?? 0)?.height === 200,
	'the remote image’s natural size'
)
settle()
const loadedRemoteBox = bounds(find_test_id('image-0-0') ?? 0)
check(
	`a remote image, once loaded, paints at its natural 300 × 200 (${loadedRemoteBox?.width}×${loadedRemoteBox?.height})`,
	loadedRemoteBox ? [loadedRemoteBox.width, loadedRemoteBox.height] : null,
	[300, 200]
)

/**
 * reference-style images, which the engine resolves through their definitions: `![pic][p]` paints its picture, not
 * link text, and an image inside a reference link follows that link on ⌘-click
 */
writeFileSync(join(r9Directory, 'ref.png'), png(300, 200))
const referencePath = join(r9Directory, 'reference.md')
writeFileSync(referencePath, '![pic][p]\n\n[p]: ref.png\n')
documentController.open(referencePath, r9Options)
settle()
await wait(300)
settle()
const referenceBox = bounds(find_test_id('image-0-0') ?? 0)
const linkedReferencePath = join(r9Directory, 'linked-reference.md')
writeFileSync(
	linkedReferencePath,
	'[![pic][p]][l] after it.\n\n[p]: ref.png\n[l]: https://example.com/ref\n'
)
documentController.open(linkedReferencePath, r9Options)
settle()
await wait(300)
settle()
menuRuns.length = 0
const linkedReferenceBox = bounds(find_test_id('image-0-0') ?? 0)
if (linkedReferenceBox)
	click_at(
		linkedReferenceBox.x + linkedReferenceBox.width / 2,
		linkedReferenceBox.y + linkedReferenceBox.height / 2,
		{ modifiers: 'cmd' }
	)
check(
	`a reference-style image paints its 300 × 200 picture, and one in a reference link follows the link on ⌘-click (${referenceBox?.width}×${referenceBox?.height})`,
	[
		referenceBox ? [referenceBox.width, referenceBox.height] : null,
		menuRuns.filter(([command]) => command === 'open'),
		find_test_id('block-editor')
	],
	[[300, 200], [['open', ['https://example.com/ref']]], null]
)
press('escape')

// a blocked image's tip is its src as written, as editmd titles it with the attribute (remote.ts:68)
documentController.load('![tracker](//x.example/p.png)\n', r9Options)
settle()
const writtenSrcTip = await tipAfterHover('remote-image-0-0', 'remote-image-tooltip-0-0-tip')
mouse_move({ x: 5, y: 500 })
check(
	'a blocked image’s tooltip shows its src as written in the markdown, not the URL it resolves to',
	writtenSrcTip,
	'//x.example/p.png'
)

/**
 * a ticked task's strikes: one of its own is taken off and the whole text struck once ("gone kept", no `~~` painted and
 * no code block), and a lone `~` stays a tilde in the struck text
 */
function struckTask(source: string): [boolean, number, number] {
	documentController.load(source, r9Options)
	settle()
	const start = documentController.blocks[0]?.items?.[0]?.contentStart ?? -1
	const text = bounds(find_test_id(`task-text-${start}`)?.children?.[0] ?? 0)
	const faint = text ? mostInARow(snapshot(), text, palette().faint ?? '') : 0
	return [
		painted().includes(
			source
				.slice(source.indexOf(']') + 2)
				.trim()
				.replaceAll('~~', '')
		),
		faint >= 20 ? 1 : 0,
		find_all((node) => node.type === 'code').length
	]
}
const struckOwn = struckTask('- [x] ~~gone~~ kept\n')
const struckTilde = struckTask('- [x] pay 5~\n')
check(
	`a ticked task with a strike of its own paints “gone kept” struck once with no code block, and “pay 5~” struck with its tilde (${JSON.stringify([struckOwn, struckTilde])})`,
	[struckOwn, struckTilde],
	[
		[true, 1, 0],
		[true, 1, 0]
	]
)

// a tab after `>` is the quote marker's space and then text, not an indented code block
documentController.load('>\tfoo\n', r9Options)
settle()
const tabQuoteSource = propOf('quote-text-0', 'source')
const tabQuoteBox = bounds(find_test_id('quote-text-0') ?? 0)
const tabQuoteWash = tabQuoteBox ? mostInARow(snapshot(), tabQuoteBox, palette().surface ?? '') : -1
check(
	`a quote of “>\\tfoo” paints foo as quote text, with no code block’s fill (${JSON.stringify(tabQuoteSource)}, ${tabQuoteWash} surface pixels in a row)`,
	[typeof tabQuoteSource === 'string' && tabQuoteSource.trim() === 'foo', tabQuoteWash < 20],
	[true, true]
)

// a row mixing empty and filled cells keeps them in line, an empty cell one line tall as editmd's empty paragraph
documentController.load('| a |  |\n| - | - |\n|  | b |\n', r9Options)
settle()
const mixedRowLooks = [0, 1].map((row) =>
	[0, 1].map((column) => {
		const box = bounds(find_test_id(`table-cell-${row}-${column}`) ?? 0)
		return box ? [box.y, box.height] : null
	})
)
/**
 * GFM splits a row on every pipe that is not escaped, inside a code span too (measured headless: satteri
 * gives "`x" and "y`"), and `\|` is a pipe in the cell's text, a code span's too
 */
documentController.load('| h | i |\n| - | - |\n| `x|y` |\n\n| j |\n| - |\n| `x\\|y` |\n', r9Options)
settle()
const pipeCells = [cellSource(1, 0), cellSource(1, 1)]
/** the sources every <markdown> inside `node` paints, in order */
const sourcesIn = (node: TreeNode | null | undefined): unknown[] =>
	node
		? [
				...(node.type === 'markdown' ? [node.customProps?.source] : []),
				...(node.children ?? []).flatMap(sourcesIn)
			]
		: []
const escapedPipe = sourcesIn(find_test_id('table-1'))[1]
check(
	`a table row mixing empty and filled cells keeps each row’s cells in line, and a pipe in a code span splits its cell unless escaped (${JSON.stringify([mixedRowLooks, pipeCells, escapedPipe])})`,
	[
		mixedRowLooks.map((cells) =>
			cells.every((cell) => JSON.stringify(cell) === JSON.stringify(cells[0]))
		),
		pipeCells,
		escapedPipe
	],
	[[true, true], ['`x', 'y`'], '`x|y`']
)

/** each row's cells of table `index` as [top, height], rounded to the half pixel GPUI snaps to */
function cellLooks(rows: number, columns: number): (number[] | null)[][] {
	return Array.from({ length: rows }, (_row, row) =>
		Array.from({ length: columns }, (_column, column) => {
			const box = bounds(find_test_id(`table-cell-${row}-${column}`) ?? 0)
			return box ? [Math.round(box.y * 2) / 2, Math.round(box.height * 2) / 2] : null
		})
	)
}
const rowsInLine = (looks: (number[] | null)[][]) =>
	looks.map((cells) => cells.every((cell) => JSON.stringify(cell) === JSON.stringify(cells[0])))

// r-table: a cell holding long inline code keeps every row's cells in line, as one table row does in WebKit
documentController.load(
	'| name | value |\n| - | - |\n| `averyveryverylongidentifier_with_code` | plain |\n| two | `x` |\n',
	r9Options
)
settle()
await wait(400)
settle()
const codeTableLooks = cellLooks(3, 2)
check(
	`a table whose cell holds long inline code keeps each row’s cells in line (${JSON.stringify(codeTableLooks)})`,
	rowsInLine(codeTableLooks),
	[true, true, true]
)

// Edit > Undo from the menu with a Block's field open takes back the field's last typing, as editmd's one step
documentController.load('One.\n', r9Options)
settle()
click_test_id('block-0')
type('cmd-right')
// one word, one typing step: the field groups a space before it as a step of its own
typeQuery('more')
await fieldIdle()
openMenu('Edit')
clickRow('Undo')
await fieldIdle()
const undoneOpen = documentController.activeIndex
press('escape')
check(
	`Edit > Undo with a field open takes back the last typing and leaves the field open (open Block ${undoneOpen})`,
	[undoneOpen, documentController.text],
	[0, 'One.\n']
)

/**
 * ⌘-click on a link to a text file that cannot be opened alerts here and starts no window, as editmd's
 * LinkOpener only alerts (LinkOpener.swift:11-14)
 */
const missingLinkPath = join(r9Directory, 'missing-link.md')
writeFileSync(missingLinkPath, '[gone](gone.md) is not there.\n')
menuRuns.length = 0
menuWindows.length = 0
// the default opener, editmd's LinkOpener, which reads the file first; a window it starts would reach `menuWindows`
documentController.open(missingLinkPath, { ...r9Options, openInEditor: undefined })
settle()
clickLinkIn('block-0', 'cmd')
settle()
const missingLinkOverlay = documentController.overlay?.kind ?? null
press('escape')
settle()
check(
	'⌘-click on a link to a missing .md shows the open-failure alert and starts no window',
	[missingLinkOverlay, menuWindows],
	['openFailed', []]
)

/**
 * a remote image's size by default reads only the image's first bytes (`fetchImageHead`): a server that
 * sends the picture and then stalls still sizes it, where reading the whole answer would wait for ever
 */
const stallServer = createServer((_request, response) => {
	response.writeHead(200, { 'content-type': 'image/png' })
	response.write(png(300, 200))
	// past the 1 MiB the head reads, then nothing more and no end
	response.write(Buffer.alloc(1024 * 1024 + 4096))
})
await new Promise<void>((resolve) => stallServer.listen(0, '127.0.0.1', resolve))
const stallAddress = stallServer.address()
const stallUrl = `http://127.0.0.1:${typeof stallAddress === 'object' && stallAddress ? stallAddress.port : 0}/stall.png`
// r9Options name no `fetchImage`, so the default reads the image
documentController.load(`![stalled](${stallUrl})\n`, r9Options)
settle()
documentController.allowRemoteImages()
await waitUntil(
	() => bounds(find_test_id('image-0-0') ?? 0)?.height === 200,
	'the stalled image’s size'
)
settle()
const stalledBox = bounds(find_test_id('image-0-0') ?? 0)
documentController.load('', r9Options)
settle()
stallServer.closeAllConnections()
stallServer.close()
check(
	`a remote image whose server stalls after its first bytes still paints at its natural 300 × 200 (${stalledBox?.width}×${stalledBox?.height})`,
	stalledBox ? [stalledBox.width, stalledBox.height] : null,
	[300, 200]
)

/** a real one-colour GIF of `width` × `height`: LZW codes of 3 bits, a clear code before every pixel so they stay 3 */
function gif(width: number, height: number): Buffer {
	const codes: number[] = []
	for (let pixel = 0; pixel < width * height; pixel++) codes.push(4, 0)
	codes.push(5)
	const packed: number[] = []
	let bits = 0
	let count = 0
	for (const code of codes) {
		bits |= code << count
		count += 3
		while (count >= 8) {
			packed.push(bits & 0xff)
			bits >>= 8
			count -= 8
		}
	}
	if (count > 0) packed.push(bits & 0xff)
	const blocks: number[] = []
	for (let at = 0; at < packed.length; at += 255) {
		const block = packed.slice(at, at + 255)
		blocks.push(block.length, ...block)
	}
	const size = (value: number) => [value & 0xff, value >> 8]
	return Buffer.from([
		...Buffer.from('GIF89a'),
		...size(width),
		...size(height),
		// a global colour table of two entries, black and white
		0x80,
		0,
		0,
		0,
		0,
		0,
		255,
		255,
		255,
		0x2c,
		...size(0),
		...size(0),
		...size(width),
		...size(height),
		0,
		2,
		...blocks,
		0,
		0x3b
	])
}

// a `data:` image is sized from its own bytes and paints, as WebKit paints it
documentController.load(
	`![d](data:image/gif;base64,${gif(12, 34).toString('base64')})\n`,
	r9Options
)
settle()
await wait(300)
settle()
const dataImageBox = bounds(find_test_id('image-0-0') ?? 0)
check(
	`a data: GIF of 12 × 34 paints as an image at 12 × 34, not its alt text (${find_test_id('image-0-0')?.type}, ${dataImageBox?.width}×${dataImageBox?.height})`,
	[
		find_test_id('image-0-0')?.type,
		dataImageBox ? [dataImageBox.width, dataImageBox.height] : null
	],
	['img', [12, 34]]
)

// two images joined by a hard break stack, with no `\` painted between them
writeFileSync(join(r9Directory, 'break-a.png'), png(100, 50))
writeFileSync(join(r9Directory, 'break-b.png'), png(100, 50))
const hardBreakPath = join(r9Directory, 'hard-break.md')
writeFileSync(hardBreakPath, '![a](break-a.png)\\\n![b](break-b.png)\n')
documentController.open(hardBreakPath, r9Options)
settle()
await wait(300)
settle()
const brokenFirst = bounds(find_test_id('image-0-0') ?? 0)
const brokenSecond = bounds(find_test_id('image-0-1') ?? 0)
check(
	`two images joined by a hard break stack, with no \\ painted (${JSON.stringify([brokenFirst?.y, brokenSecond?.y])})`,
	[
		painted().split('\n').includes('\\'),
		brokenFirst !== null && brokenSecond !== null && brokenSecond.y >= brokenFirst.y + 50
	],
	[false, true]
)

/**
 * r-link-cursor: ⌘ turns a link's underline in a quote to the quote's text colour, as everywhere else; a
 * muted place's underline is the faint colour until then
 */
documentController.load('> [a linked phrase](https://example.com/x)\n', r9Options)
settle()
const quoteLinkBox = bounds(find_test_id('quote-text-0') ?? 0)
const quoteUnderline = () =>
	quoteLinkBox ? longestRunColour(snapshot(), quoteLinkBox, [palette().background ?? '']) : null
const quoteUnderlineBefore = quoteUnderline()
press('cmd', { held: true })
settle()
const quoteUnderlineHeld = quoteUnderline()
key_up('cmd')
settle()
check(
	`a link’s underline in a quote turns from faint to the quote’s muted text colour while ⌘ is held (${quoteUnderlineBefore}, ${quoteUnderlineHeld})`,
	[
		near(quoteUnderlineBefore ?? '', palette().faint ?? '', 6),
		near(quoteUnderlineHeld ?? '', palette().muted ?? '', 6)
	],
	[true, true]
)

/**
 * a-highlight-text: two Agents who each write the same word into one Block underline it in their own
 * colours, the lookup keyed by Agent and run rather than by the run's text alone
 */
const sameWordPath = join(r9Directory, 'same-word.md')
writeFileSync(sameWordPath, 'The brown fox and the brown dog.\n')
documentController.open(sameWordPath, r9Options)
await wait(100)
await reportR9Edit(sameWordPath, 'alpha', { EDITMD_AGENT_NAME: 'Alpha' })
writeFileSync(sameWordPath, 'The red fox and the brown dog.\n')
await waitUntil(() => documentController.highlights.length === 1, 'Alpha’s change')
await reportR9Edit(sameWordPath, 'beta', { EDITMD_AGENT_NAME: 'Beta' })
writeFileSync(sameWordPath, 'The red fox and the red dog.\n')
await waitUntil(() => documentController.highlights.length === 2, 'Beta’s change')
settle()
await wait(300)
settle()
const sameWordPalette = palette()
const sameWordUnderlines = find_all((node) => node.testId?.startsWith('run-underline-') === true)
	.map((node) => [bounds(node)?.x ?? 0, node.style?.backgroundColor] as const)
	.sort((a, b) => a[0] - b[0])
	.map(([, colour]) => colour)
check(
	`two Agents’ same word in one Block underlines in each Agent’s own colour (${JSON.stringify(sameWordUnderlines)})`,
	sameWordUnderlines,
	[sameWordPalette['agent-0-deleted'], sameWordPalette['agent-1-deleted']]
)

/**
 * e-mermaid-edit: the open mermaid Block's preview keeps the pointer, and a click on it puts the caret at the
 * end of the diagram's source, as editmd's `editSource` (diagrams.ts:86,169-177)
 */
documentController.load('```mermaid\nflowchart LR\n  A --> B\n```\n', r9Options)
settle()
click_test_id('block-0')
settle()
type('cmd-up')
const previewCursor = find_test_id('mermaid-box-0')?.style?.cursor
click_test_id('mermaid-box-0')
settle()
type('x')
await fieldIdle()
press('escape')
check(
	`a click on the open mermaid Block’s preview, under the pointer cursor, puts the caret at the end of the source (${previewCursor})`,
	[previewCursor, documentController.text],
	['pointer', '```mermaid\nflowchart LR\n  A --> Bx\n```\n']
)

/**
 * the field's arrows step one character, an emoji too, so the keys that toggle marks and put a selection back
 * count characters, not UTF-16 units
 */
async function boldOn(source: string, keys: string): Promise<string> {
	documentController.load(source, r9Options)
	settle()
	click_test_id('block-0')
	type(keys)
	press('cmd-b')
	await fieldIdle()
	press('escape')
	return documentController.text
}
const unboldedEmoji = await boldOn('**😀** next\n', 'cmd-left right right shift-right')
const boldedEmoji = await boldOn('a 😀b c\n', 'cmd-left right right shift-right shift-right')
// Bold on the two spaces after an emoji gets no marks; the probe's settle selects them again, which `z` then replaces
documentController.load('😀  x\n', r9Options)
settle()
click_test_id('block-0')
type('cmd-left right shift-right shift-right')
press('cmd-b')
await fieldIdle()
type('z')
await fieldIdle()
press('escape')
check(
	'with an emoji in the field, ⌘B unbolds `**😀**` to `😀 next`, bolds `😀b` to `a **😀b** c`, and a settled probe puts the selection after the emoji back',
	[unboldedEmoji, boldedEmoji, documentController.text],
	['😀 next\n', 'a **😀b** c\n', '😀zx\n']
)

// with no field open, Table goes in after the Block last edited, while it is as its Edit session left it
documentController.load('One.\n\nTwo.\n\nThree.\n', r9Options)
settle()
click_test_id('block-1')
type('cmd-right x')
await fieldIdle()
press('escape')
documentController.run('table')
settle()
check(
	'Format > Table with no field open goes in after the Block last edited',
	documentController.text,
	`One.\n\nTwo.x\n\n${TABLE}\n\nThree.\n`
)

// Edit > Paste and Match Style shows editmd's ⌥⇧⌘V, greyed like Paste with no field open
documentController.load('One.\n', r9Options)
settle()
openMenu('Edit')
const matchStyleRow = rowIndexOf('Paste and Match Style')
const matchStyleKeys = textOf(`menu-item-keys-${matchStyleRow}`)
const editItems = documentController.menus[1]?.items ?? []
const enabledOf = (title: string) =>
	editItems.find((item) => item.kind === 'item' && item.title === title)
const matchStyleItem = enabledOf('Paste and Match Style')
const pasteItem = enabledOf('Paste')
press('escape')
settle()
press('cmd-alt-shift-v')
settle()
check(
	'Paste and Match Style shows ⌥⇧⌘V and is greyed like Paste with no field open, and ⌥⇧⌘V there changes nothing',
	[
		matchStyleKeys,
		matchStyleItem?.kind === 'item' && matchStyleItem.enabled,
		pasteItem?.kind === 'item' && pasteItem.enabled,
		documentController.text,
		documentController.activeIndex
	],
	['⌥⇧⌘V', false, false, 'One.\n', null]
)

/**
 * a Block's field is open with typing in it, and another program writes the same Block.
 * editmd shows the outside change in the field at once, merged with the typing, the caret kept; a format or more
 * typing after it then shows at once, in the field and, after Escape, in the painted Block
 */
const coEditPath = join(r9Directory, 'co-edit.md')
/** the open field after the outside write, then after `act`, and the Document and painted Block after Escape */
async function afterOutsideWrite(act: () => Promise<void>): Promise<{
	merged: unknown
	field: string[]
	fieldValue: unknown
	text: string
	kind: string | undefined
	block: unknown
}> {
	writeFileSync(coEditPath, '# Doc\n\none two three\n')
	documentController.open(coEditPath, r9Options)
	settle()
	await wait(100)
	click_test_id('block-1')
	type('cmd-right z')
	await fieldIdle()
	writeFileSync(coEditPath, '# Doc\n\none two three\nagent\n')
	await waitUntil(
		() => String(propOf('block-editor', 'value')).includes('agent'),
		'the outside write in the field'
	)
	await fieldIdle()
	const merged = propOf('block-editor', 'value')
	await act()
	await fieldIdle()
	const field = painted()
		.split('\n')
		.filter((line) => line.includes('one'))
	const fieldValue = propOf('block-editor', 'value')
	const text = documentController.text
	press('escape')
	settle()
	return {
		merged,
		field,
		fieldValue,
		text,
		kind: documentController.blocks[1]?.kind,
		block: find_test_id('block-1')?.children?.[0]?.customProps?.source
	}
}
const typedAfterWrite = await afterOutsideWrite(async () => {
	type('q')
})
check(
	`an outside write to the open Block shows in its field at once, merged with the typing, and typing after it lands at the caret (${JSON.stringify(typedAfterWrite)})`,
	[
		typedAfterWrite.merged,
		typedAfterWrite.field.some((line) => line.includes('threezq')),
		typedAfterWrite.text,
		String(typedAfterWrite.block).includes('threezq')
	],
	['one two threez\nagent', true, '# Doc\n\none two threezq\nagent\n', true]
)
const boldAfterWrite = await afterOutsideWrite(async () => {
	type('cmd-up right right right right shift-right shift-right shift-right')
	press('cmd-b')
})
const headingAfterWrite = await afterOutsideWrite(async () => {
	type('cmd-up')
	press('cmd-alt-2')
})
check(
	`after an outside write to the open Block, ⌘B and ⌥⌘2 show at once in the field and, after Escape, in the painted Block (${JSON.stringify([boldAfterWrite, headingAfterWrite])})`,
	[
		[
			boldAfterWrite.field.some((line) => line.includes('**two**')),
			boldAfterWrite.text,
			String(boldAfterWrite.block).includes('**two**')
		],
		// the paragraph holds two lines now, so Heading 2 makes it a setext heading (formatBlock)
		[headingAfterWrite.fieldValue, headingAfterWrite.text, headingAfterWrite.kind]
	],
	[
		[true, '# Doc\n\none **two** threez\nagent\n', true],
		['one two threez\nagent\n-----', '# Doc\n\none two threez\nagent\n-----\n', 'heading']
	]
)
/**
 * the open field shows an agent's change marked, as editmd marks the agent's run live: a <textarea>
 * paints no `highlight` of its own (measured headless), so the field takes the Block's agent tint and bar
 */
// a file of its own: the co-editing checks above leave an autosave of theirs on the way to co-edit.md
const markPath = join(r9Directory, 'co-edit-mark.md')
writeFileSync(markPath, '# Doc\n\none two three\n')
documentController.open(markPath, r9Options)
settle()
await wait(100)
click_test_id('block-1')
type('cmd-right z')
await fieldIdle()
const fieldLookBefore = find_test_id('block-editor')?.style?.backgroundColor ?? null
writeFileSync(markPath, '# Doc\n\none two three\nagent\n')
await waitUntil(
	() => String(propOf('block-editor', 'value')).includes('agent'),
	'the outside write in the field'
)
await fieldIdle()
const markedField = find_test_id('block-editor')?.style
press('escape')
check(
	`an outside change to the open Block marks its field with the agent’s tint and bar (${markedField?.backgroundColor}, ${markedField?.borderColor})`,
	[fieldLookBefore, markedField?.backgroundColor, markedField?.borderColor],
	[null, palette()['agent-unknown-tint'], palette()['agent-unknown']]
)

/**
 * a remote image that fails once Load Remote Images allows it (a 404) paints its alt text, as a
 * missing local file does, where GPUI's own "img: load failed" box pushed the text aside
 */
documentController.load('![gone picture](https://example.com/404.png) after it.\n', {
	...r9Options,
	fetchImage: () => Promise.reject(new Error('404 for https://example.com/404.png'))
})
settle()
documentController.allowRemoteImages()
settle()
await waitUntil(() => find_test_id('image-missing-0-0') !== null, 'the failed image’s alt text')
settle()
check(
	'a remote image that fails to load paints its alt text, not GPUI’s load-failed box',
	[textOf('image-missing-0-0'), find_test_id('image-0-0')],
	['gone picture', null]
)

/**
 * a `#heading` link to one of the last headings scrolls it to the window's top, as editmd's
 * scrollIntoView puts it (editmd's screenshot), past where the page's own end would stop the scroll
 */
documentController.load(
	`[Jump to the end](#the-end)\n\n${Array.from({ length: 30 }, (_paragraph, n) => `Paragraph ${n + 1} of filler text.`).join('\n\n')}\n\n# The end\n\nLast words.\n`,
	r9Options
)
settle()
await wait(100)
clickLinkIn('block-0', 'cmd')
// the scroll, the room it lacked and the scroll again each paint in a frame of their own
for (let frame = 0; frame < 10; frame++) {
	await wait(40)
	settle()
}
const endHeading = bounds(find_test_id('block-31') ?? 0)
const barBottom = (() => {
	const bar = bounds(find_test_id('menu-bar') ?? 0)
	return bar ? bar.y + bar.height : 0
})()
check(
	`a link to the last heading scrolls it to the window’s top (heading at ${endHeading?.y}, page top ${barBottom})`,
	endHeading ? Math.abs(endHeading.y - barBottom) <= 1 : null,
	true
)
documentController.load('', r9Options)
settle()

// Find marks only the current match, in the strong mark colour, the others unwashed
documentController.load('be one be two be\n', r9Options)
settle()
press('cmd-f')
type('cmd-a')
type('b')
type('e')
await findState()
const findSpec = find((node) => fieldOf(node.customProps?.highlight, 'query') === 'be')?.customProps
	?.highlight
press('escape')
settle()
check(
	'Find washes only the current match, in the strong mark colour, and leaves the other matches unwashed',
	[fieldOf(findSpec, 'color'), fieldOf(findSpec, 'activeColor')],
	['transparent', palette().mark]
)

// Save As selects the name's base, so typing replaces it and keeps the extension, as NSSavePanel
const saveAsNamePath = join(r9Directory, 'render.md')
writeFileSync(saveAsNamePath, 'Render.\n')
documentController.open(saveAsNamePath, r9Options)
settle()
documentController.run('saveAs')
settle()
await wait(150)
type('x')
settle()
const typedSaveAsName = propOf('save-as-name', 'value')
press('escape')
settle()
check('Save As opens with the name’s base selected: typing x gives x.md', typedSaveAsName, 'x.md')

// Add Link selects its prefilled URL, so typing replaces it, as NSAlert's first field
menuClipboardUrl = 'https://example.com/prefilled'
documentController.load('Link here.\n', r9Options)
settle()
click_test_id('block-0')
press('cmd-k')
settle()
await wait(150)
type('h')
settle()
const typedLinkUrl = propOf('add-link-url', 'value')
press('escape')
settle()
press('escape')
menuClipboardUrl = null
check('Add Link opens with its prefilled URL selected: typing h replaces it', typedLinkUrl, 'h')

/**
 * a heading's open field paints at the heading's size, so the page does
 * not jump: the open h1 field is as tall as the closed h1's painted text, within a few px
 */
documentController.load('# Big heading\n\nText.\n', r9Options)
settle()
const closedHeading = bounds(find_test_id('block-0')?.children?.[0] ?? 0)
click_test_id('block-0')
settle()
await wait(100)
settle()
// an h1's field sits in the box that draws its rule, as the closed h1's text does
const openHeading = bounds(find_test_id('block-editor-rule') ?? find_test_id('block-editor') ?? 0)
press('escape')
check(
	`an h1’s open field is as tall as the closed h1 (${openHeading?.height} open, ${closedHeading?.height} closed)`,
	closedHeading && openHeading ? Math.abs(openHeading.height - closedHeading.height) <= 4 : null,
	true
)

/**
 * ⌘S on a locked file asks to save anyway, in editmd's words, Cancel the default; Save Anyway writes
 * the edit and keeps the file's mode
 */
const lockedSavePath = join(r9Directory, 'locked.md')
writeFileSync(lockedSavePath, 'Locked\n')
documentController.open(lockedSavePath, r9Options)
settle()
chmodSync(lockedSavePath, 0o444)
click_test_id('block-0')
type('cmd-down k')
await fieldIdle()
press('escape')
press('cmd-s')
settle()
const lockedDialog = [
	textOf('save-locked-title'),
	textOf('save-locked-message'),
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
const ownedPath = join(r9Directory, 'owned.md')
writeFileSync(ownedPath, 'Owned elsewhere.\n')
let otherFocused = 0
const ownerWindow = await listenForReports(
	r9Options.socketsDirectory,
	() => {},
	() => {},
	() => [],
	{
		owns: (path: string) => path === realpathSync(ownedPath),
		focus: () => void otherFocused++
	}
)
const openerPath = join(r9Directory, 'opener.md')
writeFileSync(openerPath, 'Opener.\n')
documentController.open(openerPath, r9Options)
settle()
await wait(150)
menuWindows.length = 0
menuPicks.push([ownedPath])
documentController.run('open')
await waitUntil(() => otherFocused > 0, 'the other window coming forward')
await wait(150)
await ownerWindow()
check(
	'File > Open… on a file another window has brings that window forward and starts no new one',
	[otherFocused, menuWindows],
	[1, []]
)

// Print hands the page the document's folder, so relative images print
let printedFolder: string | null | undefined
documentController.open(openerPath, {
	...r9Options,
	writePrintable: (_text: string, title: string, folder: string | null) => {
		printedFolder = folder
		return join(r9Directory, `${title}.html`)
	}
})
settle()
press('cmd-p')
settle()
check(
	`Print hands the printable page the document’s folder (${printedFolder})`,
	[r9Directory, realpathSync(r9Directory)].includes(printedFolder ?? ''),
	true
)

// r-definitions: a definition paints rebuilt from what it defines, as editmd's links.ts:133-136
documentController.load("[Docs]:   <https://example.com/a b>   'Single'\n", r9Options)
settle()
check(
	'a link definition paints as `[Docs]: https://example.com/a b "Single"`, rebuilt from what it defines',
	painted().includes('[Docs]: https://example.com/a b "Single"'),
	true
)

/**
 * Find leaves out a code block's language label, which editmd paints as `pre[data-language]::before` and its find never
 * matches: the label declares a highlight of its own that matches nothing (measured headless)
 */
documentController.load('```js\nlet js = 1\n```\n', r9Options)
settle()
press('cmd-f')
// the field keeps an earlier query, which the typing replaces
type('cmd-a')
type('j')
type('s')
const labelFind = await findState()
const labelQuery = findController.query
const labelWashes = painted_highlights().map((wash) => wash.text.slice(wash.start, wash.end))
press('escape')
settle()
check(
	`Find of “js” over a js code block counts the code’s one match, not its language label (${JSON.stringify(labelFind)}, query ${JSON.stringify(labelQuery)}, washes ${JSON.stringify(labelWashes)})`,
	labelFind,
	[1, 0, 0]
)

rmSync(r9Directory, { recursive: true, force: true })

rmSync(parityDirectory, { recursive: true, force: true })

finish('document', 411)
