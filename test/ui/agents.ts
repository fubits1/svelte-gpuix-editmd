/**
 * the headless UI suite's Agent sections: attribution and naming, the legend and its IPC between windows, highlight
 * paint, changed runs, reveal stops, deletion tooltips and the marks a merge leaves in a list
 */
import './harness.ts'
import {
	captureWindow,
	clickIfPresent,
	countRunsAlong,
	findQuery,
	getCentre,
	getDevicePixel,
	getField,
	getGapLines,
	getPalette,
	getProp,
	getRows,
	getText,
	getTipOffset,
	getWashPoint,
	initLookDirectory,
	initNamingDirectory,
	initRunDirectory,
	isNear,
	isolated,
	loadFindState,
	loadTipAfterHover,
	loadTipAt,
	lookDirectory,
	menuDirectory,
	menuOptions,
	mergeByEta,
	mixColour,
	namingDirectory,
	openFixture,
	parityOptions,
	readFixture,
	reportAgentEdit,
	retype,
	runDirectory,
	sandboxDirectory,
	sandboxOptions,
	settleAfter,
	snapToWanted,
	toChannels,
	toHalfPixels,
	untitledFolder,
	waitUntil
} from './harness.ts'
import { check } from './check.ts'
import {
	all_text,
	bounds,
	click_test_id,
	find,
	find_all,
	find_test_id,
	mouse_down,
	mouse_move,
	mouse_up,
	painted_highlights,
	press,
	pump,
	settle,
	type,
	type TreeNode,
	wait,
	wait_for
} from 'gpuix-svelte/test'
import { dispatch } from 'gpuix-svelte'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { themeController } from '../../src/app/theme.svelte.ts'
import { LegendPreference } from '../../src/host/legendPreference.ts'
import {
	type AgentRename,
	bringAllToFront,
	focusWindowFor,
	greetPeers,
	listenForReports,
	sendRename
} from '../../src/host/agentIpc.ts'
import {
	DocumentController,
	documentController
} from '../../src/ui/DocumentView/controller.svelte.ts'
import { deletionTooltip, highlightTooltip } from '../../src/app/highlightTooltip.ts'

/** how long a reveal's smooth scroll takes to land, its 300ms and a frame or two */
const REVEAL_MS = 400

let pageMiddle: number

/** where the run `text` paints its top, against the middle of the page */
function getRunFromMiddle(text: string): number {
	const rect = painted_highlights().find(
		({ active, text: run, start, end }) => active && run.slice(start, end) === text
	)?.rects[0]
	return rect ? Math.round(rect.y - pageMiddle) : Number.NaN
}

export async function testAttributionAndNaming(): Promise<void> {
	// agent attribution end to end: hook Report -> Claim -> outside write -> Disk merge -> Agent highlight + legend
	const agentDirectory = mkdtempSync(join(tmpdir(), 'eg-agent-'))
	const sockets = join(agentDirectory, 's')
	// the legend reads whether it was minimized from this test's store, never the real one
	const agentPath = openFixture(agentDirectory, 'plan.md', '# Plan\n\nfirst\n\nsecond\n', {
		...isolated,
		socketsDirectory: sockets,
		legendPreference: new LegendPreference(join(agentDirectory, 'legend.json'))
	})
	await wait(100)

	await reportAgentEdit(agentPath, 'abc', {}, agentDirectory)
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
	await reportAgentEdit(agentPath, 'def', { EDITMD_AGENT_NAME: 'Codex' }, agentDirectory)
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
	 * (GPUI's `bounds` reports a box with padding and a border moved in by them, so the box is read from its style; its
	 * tint spans x 64 to 728, the column's 72 less 8, to its right edge)
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
	const stopOlderWindow = await listenForReports(
		greetSockets,
		() => {},
		() => {},
		() => [{ id: 'greet-session', name: 'Named elsewhere' }]
	)
	documentController.open(greetPath, {
		...isolated,
		socketsDirectory: greetSockets,
		legendPreference: new LegendPreference(join(greetDirectory, 'legend.json'))
	})
	await wait(300)
	await reportAgentEdit(greetPath, 'greet-session', {}, greetDirectory)
	writeFileSync(greetPath, '# Greet\n\nfirst, by the agent\n')
	await waitUntil(() => documentController.agents.length > 0, 'the greeted agent’s highlight')
	await stopOlderWindow()
	check(
		'a window opened after a rename in another asks the others for the names they know, and the Agent’s first change here shows that name',
		documentController.agents.map(({ name }) => name),
		['Named elsewhere']
	)
	documentController.load('', isolated)
	rmSync(greetDirectory, { recursive: true, force: true })

	/**
	 * editmd names an Agent at its merge, before it looks for changes (editor.ts:226), so an Agent whose write changes
	 * nothing visible still takes a colour slot: Agent A writes what the Document already holds unsaved, then Agent B's
	 * change shows in slot 1
	 */
	initNamingDirectory()
	const namingSockets = join(namingDirectory, 's')
	const namingPath = openFixture(namingDirectory, 'naming.md', 'one\n', {
		...isolated,
		socketsDirectory: namingSockets,
		legendPreference: new LegendPreference(join(namingDirectory, 'legend.json'))
	})
	await wait(150)
	click_test_id('block-0')
	type('x')
	press('escape')
	await reportAgentEdit(namingPath, 'naming-a', { EDITMD_AGENT_NAME: 'Agent A' }, namingDirectory)
	writeFileSync(namingPath, 'onex\n')
	await waitUntil(() => !documentController.edited, 'Agent A’s merge')
	await reportAgentEdit(namingPath, 'naming-b', { EDITMD_AGENT_NAME: 'Agent B' }, namingDirectory)
	writeFileSync(namingPath, 'onex\n\nby b\n')
	await waitUntil(() => documentController.agents.length > 0, 'Agent B’s change')
	check(
		'an Agent whose merge changes nothing visible still takes colour slot 0, so the next Agent’s change shows in slot 1',
		[documentController.text, documentController.agents.map(({ slot }) => slot)],
		['onex\n\nby b\n', [1]]
	)
}

export async function testLegendAndIpc(): Promise<void> {
	rmSync(untitledFolder, { recursive: true, force: true })

	/**
	 * the Agent legend, as editmd's (web/src/highlights.ts `Legend`, style.css `.agent-legend`): a write nobody
	 * reported is Outside edit, then Claude changes two Blocks below the fold and Codex one. the file has forty
	 * fillers, so revealing a Block has to scroll
	 */
	const legendPath = join(menuDirectory, 'legend.md')
	const legendFiller = Array.from(
		{ length: 40 },
		(_value, index) => `Filler paragraph ${index + 1}.`
	)
	/** the legend file, each filler numbered in `changes` replaced by its new text */
	function buildLegendText(changes: Record<number, string>): string {
		return `# Plan\n\n${legendFiller.map((line, index) => changes[index + 1] ?? line).join('\n\n')}\n`
	}
	const outsideChange = { 2: 'Changed outside.' }
	const claudeChanges = {
		...outsideChange,
		20: 'Twenty, by Claude.',
		34: 'Thirty-four, by Claude.'
	}
	openFixture(menuDirectory, 'legend.md', buildLegendText({}), menuOptions)
	await wait(100)
	writeFileSync(legendPath, buildLegendText(outsideChange))
	await waitUntil(() => documentController.highlights.length === 1, 'the outside edit')
	await reportAgentEdit(legendPath, 'abc', {}, menuDirectory)
	writeFileSync(legendPath, buildLegendText(claudeChanges))
	await waitUntil(() => documentController.highlights.length === 3, 'Claude’s two Blocks')
	await reportAgentEdit(legendPath, 'def', { EDITMD_AGENT_NAME: 'Codex' }, menuDirectory)
	writeFileSync(legendPath, buildLegendText({ ...claudeChanges, 8: 'Eight, by Codex.' }))
	await waitUntil(() => documentController.highlights.length === 4, 'Codex’s Block')
	settle()

	const claudeName = `Claude · ${basename(menuDirectory)}`
	/** what each legend row paints, top to bottom: its name and its count */
	const getLegendRows = () =>
		getRows('legend-row', (index) => [
			getText(`legend-name-text-${index}`),
			getText(`legend-count-${index}`)
		])
	check(
		'the legend lists each Agent with its count of changes, in order of arrival and Outside edit last',
		[getText('legend-header'), getLegendRows()],
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
			getText('legend-minimize'),
			[0, 1, 2].map((index) => getText(`legend-clear-${index}`)),
			getText('legend-clear-all')
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
				const washes = getProp('block-2', 'highlight')
				return Array.isArray(washes) ? getField(washes.at(-1), 'activeColor') : null
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
	const getClearWidth = () => bounds(find_test_id('legend-clear-0') ?? 0)?.width ?? 0
	/** the node holding `testId` as a direct child */
	const findParent = (testId: string) =>
		find((node) => node.children?.some((child) => child.testId === testId) ?? false)
	// a node that is not there reads `missing`, so "no size of its own" (`none`) needs the node present
	const getFontSize = (node: TreeNode | null | undefined) =>
		node ? (node.style?.fontSize ?? 'none') : 'missing'
	/**
	 * The legend's root holds the rows; GPUI text takes its parent's size, so the × takes the size of the first ancestor
	 * that sets one.
	 */
	const getLegendSizes = () => [
		getFontSize(findParent('legend-row-0')),
		getFontSize(find_test_id('legend-clear-0')),
		getFontSize(findParent('legend-clear-0'))
	]
	const legendSizesBefore = getLegendSizes()
	const clearWidthBefore = getClearWidth()
	press('cmd-=')
	settle()
	const legendSizesZoomed = getLegendSizes()
	const clearWidthZoomed = getClearWidth()
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
	/**
	 * The × follows the legend's own zoomed 12px, as editmd's `font: inherit`, so the zoomed × is 1.1 times as wide, give
	 * or take subpixel rounding.
	 */
	const clearWidthRatio = clearWidthBefore > 0 ? clearWidthZoomed / clearWidthBefore : 0
	check(
		'the legend’s × takes the legend’s text size, so Cmd-= scales its width by 1.1',
		[clearWidthBefore > 0, Math.abs(clearWidthRatio - 1.1) <= 0.03],
		[true, true]
	)

	/** whether Block `index` paints whole inside the 538px window */
	function isBlockInView(index: number): boolean {
		const box = bounds(find_test_id(`block-${index}`) ?? 0)
		return box !== null && box.y >= 0 && box.y + box.height <= 538
	}
	// the first Block's top with the page unscrolled, where a reveal near the top has to stop
	const unscrolledTop = bounds(find_test_id('block-0') ?? 0)?.y ?? Number.NaN
	const claudeBlocksBefore = [isBlockInView(20), isBlockInView(34)]
	clickIfPresent('legend-name-0')
	await wait(REVEAL_MS)
	const afterFirstReveal = [isBlockInView(20), isBlockInView(34)]
	clickIfPresent('legend-name-0')
	await wait(REVEAL_MS)
	const afterSecondReveal = isBlockInView(34)
	clickIfPresent('legend-name-0')
	await wait(REVEAL_MS)
	check(
		'clicking an Agent’s name scrolls to its next changed Block, cycling back to the first, and opens no editor',
		[
			claudeBlocksBefore,
			afterFirstReveal,
			afterSecondReveal,
			isBlockInView(20),
			find_test_id('block-editor')
		],
		[[false, false], [true, false], true, true, null]
	)

	/**
	 * Block `index`'s top less the middle of the page on screen, from the menu bar's bottom to the 538px window's
	 * bottom edge (the Scroller's own box is the whole column, which moves as it scrolls)
	 */
	function getTopFromMiddle(index: number): number {
		const box = bounds(find_test_id(`block-${index}`) ?? 0)
		const bar = bounds(find_test_id('menu-bar') ?? 0)
		return box && bar ? box.y - (bar.y + bar.height + 538) / 2 : Number.NaN
	}
	// the third click revealed Claude's first Block again; Outside edit's Block sits near the top
	const revealedOffset = getTopFromMiddle(20)
	clickIfPresent('legend-name-2')
	await wait(REVEAL_MS)
	// GPUI snaps both the Block's edges and the scroll offset to the 2x display's half-pixel grid, so within a pixel
	check(
		'a revealed Block’s top meets the middle of the page, as editmd scrolls a change’s top to the window’s middle (`coordsAtPos(at).top` to `innerHeight / 2`), and a Block near the top stops the page at its top',
		[Math.abs(revealedOffset) <= 1, bounds(find_test_id('block-0') ?? 0)?.y],
		[true, unscrolledTop]
	)

	// editmd titles a highlight "<name>, <time>" (web/src/highlights.ts:184, 214-216); this test's time is en-US in UTC
	const outsideBlock = documentController.blocks[2]
	const outsideHighlight = documentController.highlights.find(
		({ start, end }) =>
			outsideBlock !== undefined && start < outsideBlock.end && end > outsideBlock.start
	)
	// the time a tip gives a change, as the window formats it
	const highlightTime: Intl.DateTimeFormatOptions = {
		hour: 'numeric',
		minute: '2-digit',
		timeZone: 'UTC'
	}
	const outsideTime = outsideHighlight
		? new Date(outsideHighlight.at).toLocaleTimeString('en-US', highlightTime)
		: 'no highlight'
	// Outside edit changed a run of the Block's text, whose tip shows over that run (highlights.ts:184-186)
	const outsideTip = await loadTipAt(
		getWashPoint('block-2') ?? { x: -1, y: -1 },
		'block-tooltip-2-tip'
	)
	const plainTip = await loadTipAfterHover('block-1', 'block-tooltip-1-tip')
	check(
		'hovering a highlighted Block shows editmd’s tooltip, the Agent’s name and the time of the change; a Block with no highlight shows none',
		[outsideTip, /^Outside edit, \d{1,2}:\d{2}\s[AP]M$/.test(outsideTip ?? ''), plainTip],
		[`Outside edit, ${outsideTime}`, true, null]
	)

	// editmd's legend titles (web/src/highlights.ts:274, 284, 295, 300); Clear all has none
	const legendTips = [
		await loadTipAfterHover('legend-minimize', 'legend-minimize-tooltip-tip'),
		await loadTipAfterHover('legend-name-0', 'legend-name-tooltip-0-tip'),
		await loadTipAfterHover('legend-name-2', 'legend-name-tooltip-2-tip'),
		await loadTipAfterHover('legend-clear-0', 'legend-clear-tooltip-0-tip')
	]
	await loadTipAfterHover('legend-clear-all', 'legend-clear-all-tip')
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

	// editmd's legend titles are native tips, so each shows at the pointer, not beside the legend
	const legendTipOffsets = []
	for (const [testId, tipId] of [
		['legend-minimize', 'legend-minimize-tooltip-tip'],
		['legend-name-0', 'legend-name-tooltip-0-tip'],
		['legend-clear-0', 'legend-clear-tooltip-0-tip']
	] as const) {
		await loadTipAfterHover(testId, tipId)
		legendTipOffsets.push(getTipOffset(getCentre(testId), tipId))
	}
	check(
		'the legend’s tips show at the pointer, below-right of it as a native tip, kept inside the window',
		legendTipOffsets,
		[
			[0, 0],
			[0, 0],
			[0, 0]
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
		[find_test_id('legend-rename')?.type, getProp('legend-rename', 'value')],
		['input', claudeName]
	)
	retype(claudeName, 'planner')
	press('enter')
	settle()
	check(
		'Return keeps the new name',
		[find_test_id('legend-rename'), getLegendRows()[0]],
		[null, ['planner', '2']]
	)
	await reportAgentEdit(legendPath, 'abc', {}, menuDirectory)
	writeFileSync(
		legendPath,
		buildLegendText({ ...claudeChanges, 8: 'Eight, by Codex.', 30: 'Thirty, by Claude.' })
	)
	await waitUntil(() => documentController.highlights.length === 5, 'Claude’s third Block')
	settle()
	check('the new name sticks for the Agent’s later changes', getLegendRows()[0], ['planner', '3'])

	/**
	 * the rename field opens with the name selected, as editmd's `edit` selects it (highlights.ts:326-349): a key typed at
	 * once replaces the whole name. headless GPUI sends no blur, so leaving the field is its blur event, as a window sends
	 */
	if (find_test_id('legend-name-0')) doubleClick('legend-name-0')

	await wait(100)
	pump()
	type('k')
	const typedOverName = getProp('legend-rename', 'value')
	const renameField = find_test_id('legend-rename')
	if (renameField) dispatch({ elementId: renameField.id, eventType: 'blur' })

	settle()
	const keptOnBlur = getLegendRows()[0]
	if (find_test_id('legend-name-0')) doubleClick('legend-name-0')

	await wait(100)
	pump()
	for (const key of 'planner') type(key)
	press('enter')
	settle()
	check(
		'the rename field opens with the name selected, so a typed key replaces it; leaving the field keeps the typed name',
		[typedOverName, keptOnBlur, getLegendRows()[0]],
		['k', ['k', '3'], ['planner', '3']]
	)

	if (find_test_id('legend-name-0')) doubleClick('legend-name-0')

	const renamingBeforeEscape = find_test_id('legend-rename') !== null
	type('x')
	press('escape')
	settle()
	check(
		'Escape drops the typing and keeps the name',
		[renamingBeforeEscape, find_test_id('legend-rename'), getLegendRows()[0]],
		[true, null, ['planner', '3']]
	)
	if (find_test_id('legend-name-2')) doubleClick('legend-name-2')

	check('Outside edit has no name to change', find_test_id('legend-rename'), null)

	clickIfPresent('legend-clear-1')
	settle()
	check(
		'× clears that Agent’s highlights only',
		[getLegendRows(), find_test_id('block-8')?.style?.borderColor],
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
			getText('legend-pill-count')
		],
		[null, [legendPalette['agent-0'], legendPalette['agent-unknown']], '4']
	)
	// editmd titles the pill "Show agents" and each dot with its Agent's name (highlights.ts:253,257)
	const pillTip = await loadTipAfterHover('legend-pill-count', 'legend-pill-tooltip-tip')
	const dotTips = [
		await loadTipAfterHover('legend-pill-dot-0', 'legend-pill-dot-tooltip-0-tip'),
		await loadTipAfterHover('legend-pill-dot-1', 'legend-pill-dot-tooltip-1-tip')
	]
	check(
		'the minimized pill’s tooltip says Show agents, and each dot’s names its Agent',
		[pillTip, dotTips],
		['Show agents', documentController.agents.map(({ name }) => name)]
	)
	await loadTipAfterHover('legend-pill-count', 'legend-pill-tooltip-tip')
	const pillTipOffset = getTipOffset(getCentre('legend-pill-count'), 'legend-pill-tooltip-tip')
	await loadTipAfterHover('legend-pill-dot-0', 'legend-pill-dot-tooltip-0-tip')
	check(
		'the pill’s tip and a dot’s show at the pointer, below-right of it, kept inside the window',
		[pillTipOffset, getTipOffset(getCentre('legend-pill-dot-0'), 'legend-pill-dot-tooltip-0-tip')],
		[
			[0, 0],
			[0, 0]
		]
	)
	/** whether a window opened now, reading the same store as this one, starts with its legend minimized */
	function isNextWindowMinimized(): boolean {
		const nextWindow = new DocumentController()
		// its sockets apart, since an untitled window listens too and would answer this window's peers
		nextWindow.load('', { ...menuOptions, socketsDirectory: join(menuDirectory, 'next-s') })
		return nextWindow.legendMinimized
	}
	const minimizedInNextWindow = isNextWindowMinimized()
	clickIfPresent('legend-pill')
	settle()
	check(
		'clicking the pill shows the rows again',
		[find_test_id('legend-pill'), getLegendRows()],
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
		[minimizedInNextWindow, isNextWindowMinimized()],
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
	writeFileSync(
		legendPath,
		buildLegendText({ ...legendChanges, 5: 'Five, changed before Source mode.' })
	)
	await waitUntil(() => documentController.highlights.length === 1, 'a change before Source mode')
	settle()
	const legendBeforeSource = find_test_id('legend') !== null
	press('cmd-/')
	settle()
	const legendInSource = find_test_id('legend') !== null
	writeFileSync(
		legendPath,
		buildLegendText({
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
	 * style.css:494-498): a 2px line in the Agent's colour at 70% (its dashes measured in `highlightPaint`) with its
	 * 0.2rem margins, between the Blocks around it, titled "Deleted by <name>, <time>:" and the text; it counts in the
	 * legend
	 */
	const textWithTwelve = buildLegendText({
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
		? new Date(deletion.at).toLocaleTimeString('en-US', highlightTime)
		: 'no deletion'
	const deletedSlot = documentController.agents.find(({ id }) => id === deletion?.author.id)?.slot
	// the legend's Reveal brings the line into the window: a Deletion's stop is the Block below it
	clickIfPresent('legend-name-0')
	await wait(REVEAL_MS)
	const deletedLine = find_test_id('deleted-0')
	const deletedBox = bounds(deletedLine ?? 0)
	const aboveDeleted = bounds(find_test_id('block-11') ?? 0)
	const belowDeleted = bounds(find_test_id('block-12') ?? 0)
	const deletedTip = await loadTipAfterHover('deleted-0', 'deleted-tooltip-0-tip')
	check(
		'a Deletion line’s tip shows at the pointer, below-right of it as a native tip',
		getTipOffset(getCentre('deleted-0'), 'deleted-tooltip-0-tip'),
		[0, 0]
	)
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
				? snapToWanted(
						[
							deletedBox.y - aboveDeleted.y - aboveDeleted.height,
							belowDeleted.y - deletedBox.y - deletedBox.height,
							deletedBox.height
						],
						[16, 3.2, 2]
					)
				: null,
			deletedTip,
			getLegendRows()
		],
		[
			'Filler paragraph 13.',
			2,
			legendPalette[
				deletedSlot === null ? 'agent-unknown-deleted' : `agent-${deletedSlot}-deleted`
			],
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
	await waitUntil(() => getLegendRows()[0]?.[0] === 'Reviewer', 'the rename from another window')
	settle()
	check(
		'a rename another window sends over the agent sockets renames the legend’s row here',
		getLegendRows(),
		[['Reviewer', '1']]
	)
	const renamesElsewhere: AgentRename[] = []
	const stopOtherWindow = await listenForReports(
		menuOptions.socketsDirectory,
		() => {},
		(rename) => void renamesElsewhere.push(rename)
	)
	if (find_test_id('legend-name-0')) doubleClick('legend-name-0')

	retype('Reviewer', 'Editor')
	press('enter')
	settle()
	await waitUntil(() => renamesElsewhere.length > 0, 'the rename reaching another window')
	await stopOtherWindow()
	check(
		'a rename here reaches another window listening on the agent sockets',
		[getLegendRows(), renamesElsewhere],
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
	await waitUntil(
		() => namesForNewcomer.length > 1,
		'this window’s answer to a newcomer’s greeting'
	)
	await newcomer()
	// 'Named elsewhere' comes from the `attributionAndNaming` section: the window keeps the names it learns for its life.
	check(
		'a window opened later greets this one and gets back every name it knows, its own rename included',
		namesForNewcomer,
		[
			{ id: 'greet-session', name: 'Named elsewhere' },
			{ id: renamedId, name: 'Editor' }
		]
	)

	/**
	 * an untitled window listens on the agent sockets from launch, as editmd's `AgentEdits.shared` is app-wide
	 * (AgentEdits.swift:39-45): a rename sent while it has no file reaches it, so it answers a newcomer's greeting with
	 * that name, and another window's Bring All to Front brings it forward. a controller of its own, in a folder of its
	 * own, so no other check's window hears it
	 */
	const untitledSockets = join(menuDirectory, 'untitled-s')
	let untitledRaised = 0
	const untitledWindow = new DocumentController()
	untitledWindow.load('', {
		...menuOptions,
		socketsDirectory: untitledSockets,
		activateWindow: () => void untitledRaised++
	})
	await waitUntil(
		() => existsSync(untitledSockets) && readdirSync(untitledSockets).length > 0,
		'the untitled window’s socket'
	)
	await sendRename(untitledSockets, { id: 'untitled-agent', name: 'Heard untitled' })
	const namesFromUntitled: AgentRename[] = []
	const untitledNewcomer = await listenForReports(
		untitledSockets,
		() => {},
		(rename) => void namesFromUntitled.push(rename)
	)
	await greetPeers(untitledSockets, untitledNewcomer.socket)
	await bringAllToFront(untitledSockets, untitledNewcomer.socket)
	await waitUntil(() => namesFromUntitled.length > 0, 'the untitled window’s answer to a greeting')
	const untitledClaims = await focusWindowFor(
		untitledSockets,
		join(menuDirectory, 'launched.md'),
		untitledNewcomer.socket
	)
	await untitledNewcomer()
	check(
		'an untitled window hears the agent sockets from launch: a rename sent before it has a file reaches it, it answers a newcomer’s greeting with that name, Bring All to Front raises it, and it claims no file another window opens',
		[namesFromUntitled, untitledRaised, untitledClaims],
		[[{ id: 'untitled-agent', name: 'Heard untitled' }], 1, false]
	)

	clickIfPresent('legend-clear-0')
	settle()
	const clearedByCross = [documentController.deletions.length, find_test_id('deleted-0')]
	writeFileSync(legendPath, textWithTwelve)
	await waitUntil(
		() => documentController.text.includes('Filler paragraph 12.'),
		'the twelfth back'
	)
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
}

export async function testHighlightPaint(): Promise<void> {
	/**
	 * editmd's `.agent-block { background: var(--tint); box-shadow: -6px 0 0 var(--tint), -8px 0 0 var(--agent) }`
	 * (style.css:474-479): left of the Block the agent shadow shows from -8px, the tint shadow over it from -6px, and the
	 * tint of an agent's colour over that colour is the colour itself, so an 8px solid bar; the Block itself is tinted
	 */
	initLookDirectory()
	const lookPath = openFixture(lookDirectory, 'look.md', readFixture('a-highlight-deleted'), {
		...parityOptions,
		socketsDirectory: join(lookDirectory, 's'),
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
	await settleAfter(100)
	const highlightCapture = captureWindow()
	const highlightedText = bounds(find_test_id('block-3')?.children?.[0] ?? 0)
	// left of the text, on the bar; and inside the Block right of its short line, on the tint and clear of the glyphs
	const barColours = highlightedText
		? [-7, -3, highlightedText.width - 6].map((dx) =>
				getDevicePixel(
					highlightCapture,
					Math.round((highlightedText.x + dx) * highlightCapture.scale),
					Math.round((highlightedText.y + highlightedText.height / 2) * highlightCapture.scale)
				)
			)
		: []
	const agentColour = getPalette()['agent-unknown'] ?? ''
	const tintColour = mixColour(agentColour, getPalette().background ?? '', 0.13)
	check(
		`an Agent’s Block paints an 8px bar in the agent colour left of its text and the tint on the Block itself (at -7, -3 and its right end: ${barColours.join(', ')})`,
		[
			isNear(barColours[0] ?? '', agentColour, 6),
			isNear(barColours[1] ?? '', agentColour, 6),
			isNear(barColours[2] ?? '', tintColour, 6)
		],
		[true, true, true]
	)

	/**
	 * `.agent-deleted.between { border-top: 2px dashed }` (style.css:494-498): WebKit dashes a border three times its
	 * width, so a 2px line is 6px dashes 6px apart; gpuix has no border style, so an svg draws them. along the line's
	 * middle row the agent colour comes and goes once per dash
	 */
	const lookDeletedLine = bounds(find_test_id('deleted-0') ?? 0)
	const deletedColour = getPalette()['agent-unknown-deleted'] ?? ''
	const deletedRuns = lookDeletedLine
		? countRunsAlong(
				highlightCapture,
				Math.round((lookDeletedLine.y + lookDeletedLine.height / 2) * highlightCapture.scale),
				Math.round(lookDeletedLine.x * highlightCapture.scale),
				Math.round((lookDeletedLine.x + 118) * highlightCapture.scale),
				mixColour((deletedColour || '#000000').slice(0, 7), getPalette().background ?? '', 0.7)
			)
		: 0

	/**
	 * editmd's legend floats on `box-shadow: 0 4px 16px rgb(0 0 0 / 0.12)` (style.css:515), which gpuix-svelte drops
	 * from CSS text; under it the page is darker than further down
	 */
	const legendBox = bounds(find_test_id('legend') ?? 0)
	const legendShade = legendBox
		? [legendBox.x + legendBox.width / 2, legendBox.x - 40].map((x) =>
				getDevicePixel(
					highlightCapture,
					Math.round(x * highlightCapture.scale),
					Math.round((legendBox.y + legendBox.height + 4) * highlightCapture.scale)
				)
			)
		: []
	const getShade = (hex: string) => toChannels(hex).reduce((sum, value) => sum + value, 0)
	check(
		`a Deletion line paints dashed, 6px dashes 6px apart, and the legend casts editmd’s shadow below it (Deletion dashes in its first 118px: ${deletedRuns}; 4px under the legend, then 40px left of it: ${legendShade.join(', ')})`,
		[
			deletedRuns,
			find_test_id('legend')?.style?.boxShadow,
			legendShade.length === 2 && getShade(legendShade[0]!) < getShade(legendShade[1]!)
		],
		[
			10,
			{ offsetX: 0, offsetY: 4, blurRadius: 16, spreadRadius: 0, color: '#0000001f', inset: false },
			true
		]
	)
}

export async function testChangedRuns(): Promise<void> {
	/**
	 * editmd marks a Block a Disk merge changed but kept as the same kind by its changed text only (changes.ts:48-74,
	 * highlights.ts:185-188, `.agent-change { background: color-mix(var(--agent) 18%, transparent) }`): the core names
	 * that text as runs, each the nth occurrence of its text in the Block's painted text, and the Block takes no tint or
	 * bar; a new block is marked whole, with tint and bar. `brown` to `green` is the run `gree`: editmd's diff keeps
	 * the `n` both end in
	 */
	initRunDirectory()
	const runPath = join(runDirectory, 'runs.md')
	writeFileSync(runPath, '# Runs\n\nThe quick brown fox.\n\nOther fox here.\n')
	documentController.open(runPath, {
		...parityOptions,
		socketsDirectory: join(runDirectory, 's'),
		legendPreference: new LegendPreference(join(runDirectory, 'legend.json'))
	})
	settle()
	writeFileSync(runPath, '# Runs\n\nThe quick green fox.\n\nOther fox here.\n\nA new paragraph.\n')
	await waitUntil(
		() => documentController.highlights.length >= 2,
		'the changed word and the new Block'
	)
	settle()
	await settleAfter(100)
	const getActiveWashes = () =>
		painted_highlights()
			.filter(({ active }) => active)
			.map(({ text, start, end }) => `${text.slice(start, end)}@${start}@${text}`)
	const runWashes = getActiveWashes()
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
		[['gree@10@The quick green fox.'], 0, null, 8, getPalette()['agent-unknown-tint']]
	)

	// Find keeps working over a Block marked by its runs: its matches there count and take their turn as the active one
	press('cmd-f')
	for (const key of ['f', 'o', 'x']) type(key)
	const findOverRuns = [(await loadFindState()).slice(0, 2), getActiveWashes().sort()]
	press('cmd-g')
	const findOverRunsNext = [(await loadFindState()).slice(0, 2), getActiveWashes().sort()]
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
}

export async function testTwoAgentsIpc(): Promise<void> {
	/**
	 * two Agents on one Block: Alpha changes a word of the paragraph and adds a paragraph, then Beta changes another word
	 * of the same paragraph and turns Alpha's paragraph into a heading, a Block marked whole by both
	 */
	const twoPath = join(sandboxDirectory, 'two.md')
	writeFileSync(twoPath, '# Two\n\nThe quick brown fox jumps.\n\nEnd.\n')
	documentController.open(twoPath, sandboxOptions)
	await wait(100)
	await reportAgentEdit(twoPath, 'alpha', { EDITMD_AGENT_NAME: 'Alpha' })
	writeFileSync(twoPath, '# Two\n\nThe quick green fox jumps.\n\nEnd.\n\nNew one.\n')
	await waitUntil(() => documentController.highlights.length === 2, 'Alpha’s changes')
	await reportAgentEdit(twoPath, 'beta', { EDITMD_AGENT_NAME: 'Beta' })
	writeFileSync(twoPath, '# Two\n\nThe quick green fox leaps.\n\nEnd.\n\n## New one.\n')
	await waitUntil(() => documentController.highlights.length === 4, 'Beta’s changes')
	settle()
	await settleAfter(150)
	const twoPalette = getPalette()
	const twoBlock = documentController.blocks[1]
	/** the tooltip line of the highlight `name` made on Block 1, as editmd titles that Agent's run */
	const getTooltipLine = (name: string) =>
		documentController.highlights
			.filter(
				({ start, end, author }) =>
					author.name === name &&
					twoBlock !== undefined &&
					start < twoBlock.end &&
					end > twoBlock.start
			)
			.map(({ author, at }) => highlightTooltip(author.name, at, menuOptions.timeFormat))
			.join('\n')
	const twoWashes = (() => {
		const specs = getProp('block-1', 'highlight')
		return (Array.isArray(specs) ? specs : [])
			.map((spec) => [getField(spec, 'query'), getField(spec, 'activeColor')])
			.filter(([query]) => query === 'gree' || query === 'lea')
	})()
	/**
	 * editmd titles each changed run (highlights.ts:184-186), a native tip: with the pointer inside the Block but off its
	 * runs none shows, on a run it shows at the pointer; a Block marked whole shows its tip anywhere over it
	 */
	const twoRunPoint = getWashPoint('block-1', 'gree') ?? { x: -1, y: -1 }
	const twoBlockBox = bounds(find_test_id('block-1') ?? 0)
	const offRunPoint = { x: (twoBlockBox?.x ?? 0) + (twoBlockBox?.width ?? 0) - 4, y: twoRunPoint.y }
	const offRunTip = await loadTipAt(offRunPoint, 'block-tooltip-1-tip')
	const twoTip = await loadTipAt(twoRunPoint, 'block-tooltip-1-tip')
	const onRunOffset = getTipOffset(twoRunPoint, 'block-tooltip-1-tip')
	const betaTip = await loadTipAt(
		getWashPoint('block-1', 'lea') ?? { x: -1, y: -1 },
		'block-tooltip-1-tip'
	)
	const wholeBox = bounds(find_test_id('block-3') ?? 0)
	const wholeTip = await loadTipAt(
		{
			x: (wholeBox?.x ?? 0) + (wholeBox?.width ?? 0) - 4,
			y: (wholeBox?.y ?? 0) + (wholeBox?.height ?? 0) / 2
		},
		'block-tooltip-3-tip'
	)
	check(
		'a run highlight’s tip shows only with the pointer on the run, at the pointer; a Block marked whole shows its tip anywhere over it',
		[offRunTip, twoTip !== null, onRunOffset, wholeTip !== null],
		[null, true, [0, 0], true]
	)
	check(
		'every Agent highlight on a Block paints: each changed run washed in its own Agent’s colour, a Block marked whole by two Agents tinted by the latest, each run titled with its own Agent’s line',
		[
			twoWashes,
			find_test_id('block-3')?.style?.backgroundColor,
			find_test_id('block-3')?.style?.borderColor,
			[twoTip, betaTip]
		],
		[
			[
				['gree', twoPalette['agent-0-change']],
				['lea', twoPalette['agent-1-change']]
			],
			twoPalette['agent-1-tint'],
			twoPalette['agent-1'],
			[getTooltipLine('Alpha'), getTooltipLine('Beta')]
		]
	)

	/**
	 * editmd underlines a changed run, `.agent-change { box-shadow: inset 0 -2px 0 color-mix(var(--agent) 70%,
	 * transparent) }` (style.css:468-472): a 2px bar along the bottom of each painted run, its Agent's colour at 70%
	 */
	mouse_move({ x: 5, y: 300 })
	settle()
	const runColours: Record<string, string | undefined> = {
		gree: twoPalette['agent-0-deleted'],
		lea: twoPalette['agent-1-deleted']
	}
	const wantedUnderlines = painted_highlights()
		.filter(({ active, text, start, end }) => active && text.slice(start, end) in runColours)
		.flatMap(({ text, start, end, rects }) =>
			rects.map((rect) => [
				toHalfPixels(rect.x),
				toHalfPixels(rect.y + rect.height),
				toHalfPixels(rect.width),
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
						toHalfPixels(box.x),
						toHalfPixels(box.y + box.height),
						toHalfPixels(box.width),
						toHalfPixels(box.height),
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
	 * with "…"
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
	const tallPath = join(sandboxDirectory, 'tall.md')
	const buildTallRows = (changed: boolean) =>
		Array.from({ length: 90 }, (_row, index) =>
			index === 69 && changed ? 'row seventy' : index === 74 ? 'needle here' : `row ${index + 1}`
		).join('\n')
	writeFileSync(tallPath, `# Tall\n\nFirst.\n\n\`\`\`\n${buildTallRows(false)}\n\`\`\`\n\nAfter.\n`)
	documentController.open(tallPath, sandboxOptions)
	await wait(100)
	await reportAgentEdit(tallPath, 'gamma', { EDITMD_AGENT_NAME: 'Gamma' })
	writeFileSync(tallPath, `# Tall\n\nFirst.\n\n\`\`\`\n${buildTallRows(true)}\n\`\`\`\n\nAfter.\n`)
	await waitUntil(() => documentController.highlights.length === 1, 'Gamma’s change')
	settle()
	const gammaRun = documentController.highlights[0]?.runs?.[0]?.text ?? 'no run'
	clickIfPresent('legend-name-0')
	await wait(REVEAL_MS)
	pump()
	const gammaRect = painted_highlights().find(
		({ active, text, start, end }) => active && text.slice(start, end) === gammaRun
	)?.rects[0]
	pageMiddle = (() => {
		const bar = bounds(find_test_id('menu-bar') ?? 0)
		return bar ? (bar.y + bar.height + 538) / 2 : Number.NaN
	})()
	check(
		`the legend reveals a run deep in a Block taller than the window by putting the run’s own top at the middle of the page, as editmd's coordsAtPos (run ${gammaRun} at ${gammaRect?.y}, middle ${pageMiddle})`,
		gammaRect ? Math.abs(gammaRect.y - pageMiddle) <= 1 : null,
		true
	)

	// Find steps to a match deep in that Block and scrolls the match itself into view, not the Block's top
	await findQuery('needle')
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
}

export async function testRevealStops(): Promise<void> {
	/**
	 * editmd's reveal steps through every highlight, one stop each (`AgentLegend.nextStop`): two changes by one Agent in one
	 * tall Block are two stops, each putting its own run's top at the middle of the page
	 */
	const stopsPath = join(sandboxDirectory, 'stops.md')
	// each change writes its own word before its row, so each run's text is its own
	const buildStopRows = (changed: number[]) =>
		Array.from({ length: 90 }, (_row, index) =>
			changed.includes(index)
				? `${index === 29 ? 'alpha' : 'omega'} row ${index + 1}`
				: `row ${index + 1}`
		).join('\n')
	writeFileSync(stopsPath, `# Stops\n\n\`\`\`\n${buildStopRows([])}\n\`\`\`\n`)
	documentController.open(stopsPath, sandboxOptions)
	await wait(100)
	await reportAgentEdit(stopsPath, 'delta', { EDITMD_AGENT_NAME: 'Delta' })
	writeFileSync(stopsPath, `# Stops\n\n\`\`\`\n${buildStopRows([29])}\n\`\`\`\n`)
	await waitUntil(() => documentController.highlights.length === 1, 'Delta’s first change')
	await reportAgentEdit(stopsPath, 'delta', { EDITMD_AGENT_NAME: 'Delta' })
	writeFileSync(stopsPath, `# Stops\n\n\`\`\`\n${buildStopRows([29, 69])}\n\`\`\`\n`)
	await waitUntil(() => documentController.highlights.length === 2, 'Delta’s second change')
	settle()
	const stopRuns = documentController.highlights.map(({ runs }) => runs?.[0]?.text ?? '')
	clickIfPresent('legend-name-0')
	await wait(REVEAL_MS)
	pump()
	const firstStop = stopRuns.map(getRunFromMiddle)
	clickIfPresent('legend-name-0')
	await wait(REVEAL_MS)
	pump()
	const secondStop = stopRuns.map(getRunFromMiddle)
	check(
		`two changes by one Agent in one Block are two stops of the legend’s reveal, each run’s top at the page’s middle in turn (runs ${JSON.stringify(stopRuns)}: ${JSON.stringify(firstStop)}, then ${JSON.stringify(secondStop)})`,
		[Math.abs(firstStop[0] ?? Number.NaN) <= 1, Math.abs(secondStop[1] ?? Number.NaN) <= 1],
		[true, true]
	)
}

export async function testDeletionTooltip(): Promise<void> {
	/**
	 * a Block that only lost text in a Disk merge (`Highlight.removed`): its tooltip is editmd's "Deleted by <name>,
	 * <time>:" and the text taken away (highlights.ts:189-219)
	 */
	const losingPath = openFixture(sandboxDirectory, 'losing.md', 'one two three\n', sandboxOptions)
	await wait(100)
	await reportAgentEdit(losingPath, 'zeta', { EDITMD_AGENT_NAME: 'Zeta' })
	writeFileSync(losingPath, 'one three\n')
	await waitUntil(() => documentController.highlights.length === 1, 'Zeta’s removal')
	settle()
	const removal = documentController.highlights[0]
	const removalTip = await loadTipAfterHover('block-0', 'block-tooltip-0-tip')
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
}

export async function testSameWord(): Promise<void> {
	/**
	 * a-highlight-text: two Agents who each write the same word into one Block underline it in their own
	 * colours, the lookup keyed by Agent and run rather than by the run's text alone
	 */
	const sameWordPath = join(sandboxDirectory, 'same-word.md')
	writeFileSync(sameWordPath, 'The brown fox and the brown dog.\n')
	documentController.open(sameWordPath, sandboxOptions)
	await wait(100)
	await reportAgentEdit(sameWordPath, 'alpha', { EDITMD_AGENT_NAME: 'Alpha' })
	writeFileSync(sameWordPath, 'The red fox and the brown dog.\n')
	await waitUntil(() => documentController.highlights.length === 1, 'Alpha’s change')
	await reportAgentEdit(sameWordPath, 'beta', { EDITMD_AGENT_NAME: 'Beta' })
	writeFileSync(sameWordPath, 'The red fox and the red dog.\n')
	await waitUntil(() => documentController.highlights.length === 2, 'Beta’s change')
	settle()
	await settleAfter(300)
	const sameWordPalette = getPalette()
	const sameWordUnderlines = find_all((node) => node.testId?.startsWith('run-underline-') === true)
		.map((node) => [bounds(node)?.x ?? 0, node.style?.backgroundColor] as const)
		.sort((a, b) => a[0] - b[0])
		.map(([, colour]) => colour)
	check(
		`two Agents’ same word in one Block underlines in each Agent’s own colour (${JSON.stringify(sameWordUnderlines)})`,
		sameWordUnderlines,
		[sameWordPalette['agent-0-deleted'], sameWordPalette['agent-1-deleted']]
	)
}

export async function testRevealThroughList(): Promise<void> {
	/**
	 * editmd's reveal stops at each change in a Block in turn (`AgentLegend.nextStop`'s `run`, highlights.ts:131-142)
	 * and scrolls smoothly (`scrollIntoView({ block: "center", behavior: "smooth" })`): a list between thirty fillers and
	 * ten more, so the page can centre its last item, whose first and last items one Agent changed in one merge
	 */
	const listStopsPath = join(sandboxDirectory, 'list-stops.md')
	const buildListFillers = (from: number, count: number) =>
		Array.from({ length: count }, (_row, index) => `Filler ${from + index}.`).join('\n\n')
	const buildListStopsText = (first: string, last: string) =>
		`${buildListFillers(1, 30)}\n\n${Array.from(
			{ length: 40 },
			(_row, index) => `- ${index === 0 ? first : index === 39 ? last : `item ${index + 1}`}`
		).join('\n')}\n\n${buildListFillers(31, 10)}\n`
	writeFileSync(listStopsPath, buildListStopsText('item 1', 'item 40'))
	documentController.open(listStopsPath, sandboxOptions)
	await wait(100)
	await reportAgentEdit(listStopsPath, 'epsilon', { EDITMD_AGENT_NAME: 'Epsilon' })
	writeFileSync(listStopsPath, buildListStopsText('alpha', 'omega'))
	await waitUntil(() => documentController.highlights.length === 1, 'Epsilon’s list change')
	settle()
	/** the list Block's painted top */
	const getListTop = () => bounds(find_test_id('block-30') ?? 0)?.y ?? Number.NaN
	const listTopBefore = getListTop()
	clickIfPresent('legend-name-0')
	await wait(20)
	pump()
	const listTopOneFrame = getListTop()
	await wait(REVEAL_MS)
	pump()
	const listTopRevealed = getListTop()
	const alphaFromMiddle = getRunFromMiddle('alpha')
	clickIfPresent('legend-name-0')
	await wait(REVEAL_MS)
	pump()
	const omegaFromMiddle = getRunFromMiddle('omega')
	check(
		`a list whose first and last items one Agent changed is two stops: the first item’s run, then the last item’s, each at the page’s middle (alpha ${alphaFromMiddle}, omega ${omegaFromMiddle})`,
		[Math.abs(alphaFromMiddle) <= 1, Math.abs(omegaFromMiddle) <= 1],
		[true, true]
	)
	check(
		`a reveal scrolls smoothly over about 300ms, as editmd’s \`behavior: "smooth"\`: one frame in, the list lies between where it was and where it goes (${listTopBefore}, ${listTopOneFrame}, ${listTopRevealed})`,
		[listTopRevealed < listTopOneFrame && listTopOneFrame < listTopBefore],
		[true]
	)
}

export async function testListMerges(): Promise<void> {
	/** Eta's bar and tint colours */
	function getEtaColours(): [string | undefined, string | undefined] {
		const slot = documentController.agents.find(({ name }) => name === 'Eta')?.slot
		return [themeController.palette[`agent-${slot}`], themeController.palette[`agent-${slot}-tint`]]
	}
	/** every tinted row: its test id, bar colour and tint */
	const getTintedRows = () =>
		find_all((node) => node.testId?.startsWith('agent-row-') ?? false).map((node) => [
			node.testId,
			node.style?.borderColor,
			node.style?.backgroundColor
		])

	/**
	 * inside a list editmd compares item by item (changes.ts:28-56): a new item, or one that became another node (a
	 * ticked task), is a `block` change it tints and bars on its own row, and items taken away a dashed line between the
	 * rows left; the Block itself takes no mark
	 */
	await mergeByEta('new-item', '- a\n- b\n', '- a\n- new\n- b\n')
	check(
		'a list item an Agent added takes its tint and bar on its own row, its text no wash; the rows around it and the Block take none',
		[
			getTintedRows(),
			find_test_id('block-0')?.style?.borderColor ?? null,
			getProp('block-0', 'highlight') ?? null
		],
		[[['agent-row-6', ...getEtaColours()]], null, null]
	)
	/** a gap to 0.1px */
	const roundGap = (gap: number) => Math.round(gap * 10) / 10
	// `rowGap`: the gap GPUI lays out between two rows with no line between them, the 3.2px token as its layout snaps it
	const rowAbove = bounds(find_test_id('list-row-2') ?? 0)
	const rowBelow = bounds(find_test_id('list-row-6') ?? 0)
	const rowGap = rowAbove && rowBelow ? roundGap(rowBelow.y - (rowAbove.y + rowAbove.height)) : null

	// editmd's dashed line sits in the `ul` between the `li`s with `margin: 0.2rem 0` (style.css:494-498,
	// highlights.ts:190-204), so the next `li` loses its `li + li` 0.2em (style.css:236): the rows' own gap above the
	// line and below it, and below the last row after the last item.
	await mergeByEta('gone-item', '- a\n- b\n- c\n', '- a\n- c\n')
	const goneLines = getGapLines()
	const goneBox = bounds(goneLines[0] ?? 0)
	const goneAbove = bounds(find_test_id('list-row-2') ?? 0)
	const goneBelow = bounds(find_test_id('list-row-6') ?? 0)
	const goneId = goneLines[0]?.testId ?? 'no-gap'
	const goneTip = await loadTipAfterHover(goneId, `${goneId.replace('gap-', 'gap-tooltip-')}-tip`)
	const goneAt = documentController.highlights[0]?.at ?? 0
	check(
		`an item an Agent took away leaves one dashed line between the rows left, the rows' own ${rowGap}px apart, as editmd's 0.2rem margins, titled as editmd titles a deletion, and the Block takes no tint (${JSON.stringify(goneTip)})`,
		[
			goneLines.length,
			goneBox && goneAbove && goneBelow
				? [
						goneBox.y - (goneAbove.y + goneAbove.height),
						goneBelow.y - (goneBox.y + goneBox.height)
					].map(roundGap)
				: null,
			find_test_id('block-0')?.style?.borderColor ?? null,
			goneTip
		],
		[1, [rowGap, rowGap], null, deletionTooltip('Eta', goneAt, 'b', menuOptions.timeFormat)]
	)

	await mergeByEta('last-item', '- a\n- b\n', '- a\n')
	const lastLines = getGapLines()
	const lastBox = bounds(lastLines[0] ?? 0)
	const lastAbove = bounds(find_test_id('list-row-2') ?? 0)
	check(
		`the last item taken away leaves its dashed line the rows' own ${rowGap}px below the last row left, as editmd's 0.2rem margin`,
		[
			lastLines.length,
			lastBox && lastAbove ? roundGap(lastBox.y - (lastAbove.y + lastAbove.height)) : null
		],
		[1, rowGap]
	)

	await mergeByEta('ticked', '- [ ] a\n- [ ] b\n', '- [ ] a\n- [x] b\n')
	check(
		'a task an Agent ticked takes its tint and bar on its own row, and the Block none',
		[getTintedRows(), find_test_id('block-0')?.style?.borderColor ?? null],
		[[['agent-row-14', ...getEtaColours()]], null]
	)

	// a quote's children are its rows too: a paragraph an Agent added inside a quote is tinted on its own
	await mergeByEta('new-quoted', '> a\n>\n> b\n', '> a\n>\n> new\n>\n> b\n')
	check(
		'a paragraph an Agent added inside a quote takes its tint and bar on its own row, and the Block none',
		[getTintedRows(), find_test_id('block-0')?.style?.borderColor ?? null],
		[[[`agent-row-${documentController.text.indexOf('new')}`, ...getEtaColours()]], null]
	)

	/** every tip box painted now */
	const countShownTips = () => find_all((node) => node.testId?.endsWith('-tip') === true).length

	// a native tip hides on mouse down and on key down, and shows again once the pointer moves on and rests
	await mergeByEta('new-paragraph', 'a\n', 'a\n\nnew\n')
	const restedTip = await loadTipAfterHover('block-1', 'block-tooltip-1-tip')
	const restPoint = getCentre('block-1')
	await settleAfter(300)
	const tipBeforeKey = countShownTips()
	// a key no command or field takes
	press('f5')
	settle()
	const tipAfterKey = countShownTips()
	await settleAfter(400)
	const tipAfterKeyRest = countShownTips()
	// headless, a move inside the Block after a key enters it again only once the pointer has left it
	await loadTipAfterHover('block-0', 'block-tooltip-0-tip')
	const tipAfterMoveOn = await loadTipAfterHover('block-1', 'block-tooltip-1-tip')
	mouse_down(restPoint)
	settle()
	const tipAfterDown = countShownTips()
	await settleAfter(400)
	const tipAfterDownRest = countShownTips()
	// the release completes a click, which opens the Block's field
	mouse_up(restPoint)
	settle()
	press('escape')
	settle()
	check(
		'a tip hides on key down and on mouse down, as an AppKit tooltip, and shows again only once the pointer moves on and rests',
		[
			restedTip,
			tipBeforeKey,
			tipAfterKey,
			tipAfterKeyRest,
			tipAfterMoveOn,
			tipAfterDown,
			tipAfterDownRest
		],
		[
			highlightTooltip('Eta', documentController.highlights[0]?.at ?? 0, menuOptions.timeFormat),
			1,
			0,
			0,
			restedTip,
			0,
			0
		]
	)

	// a list item's tip is its own row's, as editmd titles the item's `block` change
	await mergeByEta('new-item-tip', '- a\n- b\n', '- a\n- new\n- b\n')
	const markedRowTip = await loadTipAfterHover('agent-row-6', 'row-tooltip-6-tip')
	await loadTipAfterHover('list-row-2', 'no-tip')
	check(
		'a list item an Agent added shows its tip over its own row, and an unmarked row of the same list none',
		[markedRowTip, countShownTips()],
		[highlightTooltip('Eta', documentController.highlights[0]?.at ?? 0, menuOptions.timeFormat), 0]
	)
}
