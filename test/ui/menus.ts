/**
 * the headless UI suite's menu sections: Format's inserts, the command palette, the in-window menu bar with its
 * submenus and Help search, and Edit's Undo and Paste and Match Style from the menu
 */
import './harness.ts'
import {
	clickIfPresent,
	clickRow,
	getPaletteTitles,
	getPanelRows,
	getProp,
	getRowIndex,
	getRows,
	getText,
	initMenuRecorders,
	loadFindState,
	MENU_TITLES,
	menuDirectory,
	menuOptions,
	menuRecent,
	menuRuns,
	menuWindows,
	openDirectory,
	openMenu,
	retype,
	sandboxOptions,
	typeQuery,
	waitForFieldIdle,
	waitUntil
} from './harness.ts'
import { check } from './check.ts'
import { get_native } from 'gpuix-svelte'
import {
	bounds,
	click_at,
	click_test_id,
	find_test_id,
	mouse_move,
	press,
	settle,
	type,
	wait
} from 'gpuix-svelte/test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findController } from '../../src/app/find.svelte.ts'
import { type MenuBarItem, type MenuBarMenu, menuBar } from '../../src/app/menu.ts'
import { themeController } from '../../src/app/theme.svelte.ts'
import { zoomOut } from '../../src/app/zoom.ts'
import { TABLE } from '../../src/core/blockCommands.ts'
import { tableCells } from '../../src/core/tableCells.ts'
import { listenForReports } from '../../src/host/agentIpc.ts'
import { documentController } from '../../src/ui/DocumentView/controller.svelte.ts'

/** opens the command palette through its command and types `query` into its field */
function queryPalette(query: string): void {
	documentController.run('commandPalette')
	settle()
	typeQuery(query)
	settle()
}

/** the text of the first cell of the table at Block `index`, as the Document holds it */
function firstCellOf(index: number): string | undefined {
	const block = documentController.blocks[index]
	if (!block) return undefined
	const source = documentController.text.slice(block.start, block.end)
	const cell = tableCells(source)[0]
	return cell && source.slice(cell.from, cell.to)
}

/**
 * Format > Table after `open` sets the Document up, then `x` typed as a person types it: the Active block and its kind
 * as typed, and after Escape the first cell of the table at Block `index`.
 */
async function typeIntoInsertedTable(open: () => void, index: number): Promise<unknown[]> {
	open()
	documentController.run('table')
	settle()
	await waitForFieldIdle()
	type('x')
	await waitForFieldIdle()
	const field = [documentController.activeIndex, documentController.activeKind]
	press('escape')
	return [...field, firstCellOf(index)]
}

export async function testFormatTableAndRule(): Promise<void> {
	rmSync(openDirectory, { recursive: true, force: true })

	/**
	 * the menus' items with no key (gap G2): they run through the same `run` as the shortcuts, and
	 * the command palette runs any of them. a palette entry can reach every File menu effect, so each is this
	 * test's: nothing spawns, no picker shows, no window closes and the real Open Recent is never read or written
	 */
	initMenuRecorders()

	// Format > Table and Horizontal Rule have no key in editmd: each goes in as a Block of its own, one Undo step
	documentController.load('Intro\n\nEnd\n', menuOptions)
	settle()
	click_test_id('block-0')
	type('x')
	documentController.run('table')
	settle()
	/** The inserted table's field opens, as editmd's insertTableCommand puts its caret in the first cell. */
	check(
		'Table after an Active paragraph inserts editmd’s 3x3 table as the Block after it',
		[documentController.text, documentController.blocks[1]?.kind, documentController.activeIndex],
		[`Introx\n\n${TABLE}\n\nEnd\n`, 'table', 1]
	)
	/**
	 * A focused <textarea> takes Cmd-Z as its own native undo before any listener hears it (measured headless), so
	 * Escape closes the field before Cmd-Z takes the insert back.
	 */
	press('escape')
	press('cmd-z')
	check(
		'Cmd-Z takes the table out again, the typing before it staying',
		documentController.text,
		'Introx\n\nEnd\n'
	)
	check(
		'Table from an open paragraph field opens the table’s field, and `x` typed then goes in its first cell',
		await typeIntoInsertedTable(() => {
			documentController.load('Intro\n\nEnd\n', menuOptions)
			settle()
			click_test_id('block-0')
		}, 1),
		[1, 'table', 'x']
	)

	/**
	 * editmd nests a table inserted at the end of a list under its last item (measured in editmd's own editor), so the
	 * list's text gains the table indented to that item's text, one Undo step
	 */
	documentController.load('- a\n- b\n', menuOptions)
	settle()
	click_test_id('block-0')
	documentController.run('table')
	settle()
	const tableInList = documentController.text
	press('cmd-z')
	check(
		'Table with the field open at the end of a list nests editmd’s table under its last item, one Undo step',
		[tableInList, documentController.text],
		['- a\n- b\n  |   |   |   |\n  | - | - | - |\n  |   |   |   |\n  |   |   |   |\n', '- a\n- b\n']
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
		[`${TABLE}\n\nA\n\nB\n`, 0]
	)
	press('escape')
	press('cmd-z')
	check(
		'Cmd-Z takes the inserted table out again as one Undo step',
		documentController.text,
		'A\n\nB\n'
	)
	check(
		'Table with no field open opens the table’s field, and `x` typed then goes in its first cell',
		await typeIntoInsertedTable(() => {
			documentController.load('A\n\nB\n', menuOptions)
			settle()
		}, 0),
		[0, 'table', 'x']
	)
	documentController.load('A\n\nB\n', menuOptions)
	settle()
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
	queryPalette('table')
	const tableTitles = getPaletteTitles()
	press('enter')
	settle()
	check(
		'typing `table` in the command palette lists Table, and Return inserts it after the Active block',
		[tableTitles, documentController.text, find_test_id('command-palette')],
		[['Table'], `A\n\n${TABLE}\n\nB\n`, null]
	)
	documentController.load('A\n\nB\n', menuOptions)
	settle()
	queryPalette('horizontal')
	const ruleTitles = getPaletteTitles()
	press('enter')
	settle()
	check(
		'typing `horizontal` in the command palette lists Horizontal Rule, and Return puts it before the first Block',
		[ruleTitles, documentController.text, find_test_id('command-palette')],
		[['Horizontal Rule'], '---\n\nA\n\nB\n', null]
	)
}

export async function testCommandPalette(): Promise<void> {
	// the command palette (gap G2) on ⌘K, editmd's Link…, which moves to ⇧⌘K
	documentController.load('Title\n\nBody\n', menuOptions)
	settle()
	click_test_id('block-0')
	press('cmd-k')
	settle()
	check(
		'Cmd-K opens the command palette, its field’s placeholder Search menus',
		[find_test_id('command-palette') !== null, getProp('command-palette-field', 'placeholder')],
		[true, 'Search menus']
	)
	// The checks after it drive the palette through its command, so a key that misses fails only the Cmd-K check.
	if (find_test_id('command-palette') === null) documentController.run('commandPalette')

	settle()
	typeQuery('head 2')
	settle()
	const headingTitles = getPaletteTitles()
	check('typing `head 2` lists exactly Heading 2', headingTitles, ['Heading 2'])
	press('enter')
	await waitForFieldIdle()
	check(
		'Return runs the selected entry on the Active block and closes the palette',
		[headingTitles, documentController.text, find_test_id('command-palette')],
		[['Heading 2'], '## Title\n\nBody\n', null]
	)
	press('escape')

	queryPalette('zoom')
	const zoomTitles = getPaletteTitles()
	press('down')
	press('enter')
	settle()
	check(
		'`zoom` lists Zoom In and Zoom Out, and Down then Return zooms out',
		[zoomTitles, themeController.zoom, find_test_id('command-palette')],
		[['Zoom In', 'Zoom Out'], zoomOut(1), null]
	)
	press('cmd-0')

	// an untitled Document has no file to revert to, so Revert to Saved is listed but disabled, as NSDocument validates it
	queryPalette('revert')
	press('enter')
	settle()
	check(
		'Revert to Saved is listed but greyed for an untitled Document, and Return on it does nothing',
		[
			getPaletteTitles(),
			find_test_id('palette-row-0')?.style?.color,
			find_test_id('revert'),
			find_test_id('command-palette') !== null
		],
		[['Revert to Saved'], themeController.palette.muted, null, true]
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
	queryPalette('markdown')
	const sourceToggleTitles = getPaletteTitles()
	retype('markdown', 'format')
	settle()
	const formatColours = getPaletteTitles().map(
		(_title, index) => find_test_id(`palette-row-${index}`)?.style?.color
	)
	check('in Source mode the toggle reads Show Rendered Markdown', sourceToggleTitles, [
		'Show Rendered Markdown'
	])
	check(
		'in Source mode every Format entry is greyed',
		[
			formatColours.length,
			formatColours.every((colour) => colour === themeController.palette.muted)
		],
		[20, true]
	)
	press('escape')
	documentController.run('toggleSource')

	documentController.load('Plain\n', menuOptions)
	settle()
	click_test_id('block-0')
	queryPalette('quote')
	clickIfPresent('palette-row-0')
	await waitForFieldIdle()
	check(
		'clicking an entry runs it and closes the palette',
		[documentController.text, find_test_id('command-palette')],
		['> Plain\n', null]
	)
	press('escape')

	/**
	 * twenty-five Downs from New, past Revert to Saved (greyed for this untitled Document, as NSDocument validates it) and
	 * Copy (greyed with nothing selected), select Heading 6, far below the first rows
	 */
	documentController.run('commandPalette')
	settle()
	for (let step = 0; step < 25; step++) {
		press('down')
		settle()
	}
	// the list's own box, below the field: the rows scroll inside it
	const paletteListBox = bounds(find_test_id('command-palette-list') ?? 0)
	const selectedRowBox = bounds(find_test_id('palette-row-27') ?? 0)
	check(
		'Down past the visible rows scrolls the selected entry into view',
		[
			getText('palette-title-27'),
			find_test_id('palette-row-27')?.style?.backgroundColor,
			paletteListBox !== null &&
				selectedRowBox !== null &&
				selectedRowBox.y >= paletteListBox.y &&
				selectedRowBox.y + selectedRowBox.height <= paletteListBox.y + paletteListBox.height
		],
		['Heading 6', themeController.palette.accent, true]
	)
	press('escape')
	settle()

	// ⇧⌘/ is macOS's Help menu search: the Help menu drops down with its search field taking the keys at once.
	documentController.load('Title\n\nBody\n', menuOptions)
	settle()
	click_test_id('block-0')
	press('cmd-shift-/')
	settle()
	const helpOverlay = documentController.overlay
	const helpFieldFocused =
		find_test_id('help-search') !== null &&
		get_native()?.getFocusedElementId() === find_test_id('help-search')?.id
	typeQuery('head 2')
	settle()
	const helpMatches = getRows('help-result', (index) => getText(`help-result-title-${index}`))
	press('escape')
	settle()
	press('escape')
	check(
		'Cmd-Shift-/ opens the Help menu with its search field focused, and `head 2` typed then lists Format ▸ Heading 2',
		[helpOverlay, helpFieldFocused, helpMatches],
		[{ kind: 'menu', index: MENU_TITLES.indexOf('Help') }, true, ['Format ▸ Heading 2']]
	)

	/**
	 * The window's bottom edge names the palette's key in its middle, and a click on it opens the palette as ⌘K does;
	 * Source mode keeps it. A click beside it, at its height, still reaches the Block painted there.
	 */
	documentController.load(
		Array.from({ length: 40 }, (_, index) => `Paragraph ${index}.`).join('\n\n') + '\n',
		menuOptions
	)
	settle()
	const hintText = getText('palette-hint')
	const hintBox = bounds(find_test_id('palette-hint') ?? 0)
	const windowBox = bounds(find_test_id('window') ?? 0)
	const beside = hintBox && {
		x: hintBox.x + hintBox.width + 120,
		y: hintBox.y + hintBox.height / 2
	}
	const blockBeside = beside
		? Array.from({ length: 40 }, (_, index) => index).find((index) => {
				const box = bounds(find_test_id(`block-${index}`) ?? 0)
				return box !== null && box.y <= beside.y && beside.y < box.y + box.height
			})
		: undefined
	if (beside) click_at(beside.x, beside.y)
	settle()
	const openedBeside = documentController.activeIndex
	press('escape')
	settle()
	documentController.run('toggleSource')
	settle()
	const hintInSource = getText('palette-hint')
	clickIfPresent('palette-hint')
	settle()
	const paletteFromHint = find_test_id('command-palette') !== null
	press('escape')
	settle()
	documentController.run('toggleSource')
	settle()
	check(
		`the bottom edge reads ⌘K Commands in its middle, in Source mode too, a click on it opens the command palette, and a click beside it opens the Block there (hint ${JSON.stringify(hintBox)}, Block ${blockBeside}, opened ${openedBeside})`,
		[
			hintText,
			hintInSource,
			hintBox !== null &&
				windowBox !== null &&
				Math.abs(hintBox.x + hintBox.width / 2 - (windowBox.x + windowBox.width / 2)) <= 1 &&
				hintBox.y + hintBox.height <= windowBox.y + windowBox.height &&
				hintBox.y + hintBox.height > windowBox.y + windowBox.height - 20,
			paletteFromHint,
			blockBeside !== undefined && openedBeside === blockBeside
		],
		['⌘K Commands', '⌘K Commands', true, true, true]
	)
}

export async function testMenuBar(): Promise<void> {
	press('escape')

	/** the rows `getPanelRows` in harness.ts reads off a painted panel, made from the model's `items` */
	function getModelRows(items: readonly MenuBarItem[]): (string | [string, string])[] {
		return items.map((item) => (item.kind === 'separator' ? 'separator' : [item.title, item.keys]))
	}

	/** the model's menus for the Document as it stands, Open Recent's files from this test's store */
	function getModelMenus(): MenuBarMenu[] {
		return menuBar({
			sourceMode: documentController.sourceMode,
			remoteImagesAllowed: documentController.remoteImagesAllowed,
			recent: menuRecent.list(),
			hasFile: documentController.hasFile
		})
	}

	/**
	 * the in-window menu bar in place of the one gpuix cannot extend (gap G2): editmd's six menus across the top of
	 * the window, each a dropdown under its title that runs its items through the same commands as the shortcuts
	 */
	const barHostPath = join(menuDirectory, 'host.md')
	writeFileSync(barHostPath, 'Host.\n')
	documentController.load('First.\n\nSecond.\n', menuOptions)
	settle()
	check(
		'the menu bar paints editmd’s six menu titles in order',
		MENU_TITLES.map((_title, index) => getText(`menu-title-text-${index}`)),
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
		getPanelRows(),
		getModelRows(getModelMenus()[0]?.items ?? [])
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

	openMenu('File')
	const revertIndex = getRowIndex('Revert to Saved')
	const revertColour = find_test_id(`menu-row-${revertIndex}`)?.style?.color
	clickRow('Revert to Saved')
	check(
		'clicking the greyed Revert to Saved of an untitled Document opens nothing and leaves the menu open',
		[revertColour, find_test_id('revert'), find_test_id('menu-panel') !== null],
		[themeController.palette.faint, null, true]
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

	/**
	 * Bring All to Front raises every editor window, as editmd's `arrangeInFront` raises every window of its one process
	 * (MainMenu.swift:121): with one process per window (ADR-0008) each other window listening beside this one runs its
	 * focus, and this one raises itself once
	 */
	const frontSockets = join(menuDirectory, 'front')
	let frontFocused = 0
	const stopFrontWindow = await listenForReports(
		frontSockets,
		() => {},
		() => {},
		() => [],
		{ owns: () => false, focus: () => void frontFocused++ }
	)
	const frontPath = join(menuDirectory, 'front.md')
	writeFileSync(frontPath, 'Front\n')
	documentController.open(frontPath, { ...menuOptions, socketsDirectory: frontSockets })
	settle()
	await wait(150)
	menuRuns.length = 0
	openMenu('Window')
	clickRow('Bring All to Front')
	await waitUntil(() => frontFocused > 0, 'the other window coming forward')
	await wait(100)
	await stopFrontWindow()
	check(
		'Window > Bring All to Front raises this window once and the other window listening beside it',
		[menuRuns, frontFocused],
		[[['activateWindow', []]], 1]
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
	const recentRows = getPanelRows('submenu')
	menuWindows.length = 0
	clickRow('recent-a.md', 'submenu')
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
		[recentAfterClear, getPanelRows('submenu')],
		[[], [['Clear Menu', '']]]
	)
	press('escape')
	settle()

	/** highlights the open menu `menu`'s item titled `title` by keys: one Down per enabled item down to it */
	function pressDownTo(menu: number, title: string): void {
		const items = getModelMenus()[menu]?.items ?? []
		const row = items.findIndex((item) => item.kind === 'item' && item.title === title)
		const downs = items.slice(0, row + 1).filter((item) => item.kind === 'item' && item.enabled)
		for (let step = 0; step < downs.length; step++) press('down')
		settle()
	}

	/**
	 * an NSMenu's submenu takes the keys (MainMenu.swift:37-39): Right shows it with its first item highlighted, Up and
	 * Down move in it, Return runs the highlighted item and Left closes it. File > Open Recent lists the newest first, so
	 * Right then Down highlights the file added before it
	 */
	menuRecent.add(recentA)
	menuRecent.add(recentB)
	menuWindows.length = 0
	openMenu('File')
	pressDownTo(0, 'Open Recent')
	for (const key of ['right', 'down', 'enter']) press(key)
	await waitUntil(() => menuWindows.length > 0, 'the recent file’s window')
	check(
		'File menu: Down to Open Recent, Right, Down and Return open the second listed recent file and close the menu',
		[menuWindows, find_test_id('menu-panel')],
		[[recentA], null]
	)

	documentController.load('be be be\n', menuOptions)
	settle()
	press('cmd-f')
	settle()
	type('b')
	type('e')
	press('escape')
	const findBeforeMenu = await loadFindState()
	openMenu('Edit')
	pressDownTo(1, 'Find')
	press('right')
	settle()
	const findSubmenuOnRight = find_test_id('submenu-panel') !== null
	press('left')
	settle()
	const findSubmenuOnLeft = find_test_id('submenu-panel')
	for (const key of ['right', 'down', 'enter']) press(key)
	const findAfterMenu = await loadFindState()
	findController.clear()
	check(
		'Edit menu: Down to Find, Right shows its submenu and Left closes it; Right, Down and Return run Find Next',
		[
			findBeforeMenu,
			findSubmenuOnRight,
			findSubmenuOnLeft,
			findAfterMenu,
			find_test_id('menu-panel')
		],
		[[3, 0, 0], true, null, [3, 1, 1], null]
	)

	// an opened file again, so the list's file opens through the opener; File > Open Recent's open put recent-a first
	documentController.open(barHostPath, menuOptions)
	settle()
	menuWindows.length = 0
	documentController.run('openRecent')
	settle()
	press('down')
	press('enter')
	await waitUntil(() => menuWindows.length > 0, 'the recent file’s window')
	check(
		'the Open Recent list: Down and Return open its first file and close the list',
		[menuWindows, find_test_id('open-recent')],
		[[recentA], null]
	)

	openMenu('File')
	const viewTitle = find_test_id('menu-title-3')
	if (viewTitle) mouse_move(viewTitle)

	settle()
	check(
		'with the File menu open, hovering View switches the panel to View’s items',
		getPanelRows(),
		getModelRows(getModelMenus()[3]?.items ?? [])
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
	press('cmd-k')
	settle()
	check(
		'Cmd-K while a menu is open opens the command palette and closes the menu',
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
	const sourceViewFirst = getPanelRows()[0]
	// the pointer onto Format would switch to it first, and a click on the open title closes it, so View closes here
	press('escape')
	settle()
	openMenu('Format')
	const sourceFormatColours = getPanelRows().flatMap((row, index) =>
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
	const helpPlaceholder = getProp('help-search', 'placeholder')
	for (const key of ['h', 'e', 'a', 'd', 'space', '2']) type(key)
	settle()
	const helpResults: [string | undefined, string | undefined][] = []
	for (let index = 0; find_test_id(`help-result-${index}`); index++) {
		helpResults.push([getText(`help-result-title-${index}`), getText(`help-result-keys-${index}`)])
	}
	press('enter')
	await waitForFieldIdle()
	check(
		'Help’s search lists exactly Format ▸ Heading 2 for `head 2`, and Return applies it to the Active block',
		[helpPlaceholder, helpResults, documentController.text, find_test_id('menu-panel')],
		['Search', [['Format ▸ Heading 2', '⌥⌘2']], '## Para\n', null]
	)
	press('escape')

	/** opens Help, types `query` into its search through `typeQuery` and reads back every match row */
	function searchHelp(query: string) {
		openMenu('Help')
		typeQuery(query)
		settle()
		return getRows('help-result', (index) => {
			const colour = find_test_id(`help-result-${index}`)?.style?.color
			return [
				getText(`help-result-title-${index}`),
				getText(`help-result-keys-${index}`),
				typeof colour === 'string' ? colour : undefined
			]
		})
	}

	/**
	 * macOS's menu search covers the whole bar (`searchMenuBar`), not the palette's entries: an item AppKit adds
	 * (View's Enter Full Screen) is found under its menu, and Return does what clicking it in the bar does
	 */
	menuRuns.length = 0
	const fullScreenRows = searchHelp('full')
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
	const recentHelpRows = searchHelp('recent-a')
	clickIfPresent('help-result-0')
	settle()
	await waitUntil(() => menuWindows.length > 0, 'the recent file’s window')
	const recentHelpWindows = [...menuWindows]
	const copyHelpRows = searchHelp('copy')
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
}

export async function testEditUndoFromMenu(): Promise<void> {
	// Edit > Undo from the menu with a Block's field open takes back the field's last typing, as editmd's one step
	documentController.load('One.\n', sandboxOptions)
	settle()
	click_test_id('block-0')
	type('cmd-right')
	// one word, one typing step: the field groups a space before it as a step of its own
	typeQuery('more')
	await waitForFieldIdle()
	openMenu('Edit')
	clickRow('Undo')
	await waitForFieldIdle()
	const undoneOpen = documentController.activeIndex
	press('escape')
	check(
		`Edit > Undo with a field open takes back the last typing and leaves the field open (open Block ${undoneOpen})`,
		[undoneOpen, documentController.text],
		[0, 'One.\n']
	)
}

export async function testPasteAndMatchStyle(): Promise<void> {
	// Edit > Paste and Match Style shows editmd's ⌥⇧⌘V, greyed with no field open, where Paste is enabled
	documentController.load('One.\n', sandboxOptions)
	settle()
	openMenu('Edit')
	const matchStyleRow = getRowIndex('Paste and Match Style')
	const matchStyleKeys = getText(`menu-item-keys-${matchStyleRow}`)
	const editItems = documentController.menus[1]?.items ?? []
	const findEditItem = (title: string) =>
		editItems.find((item) => item.kind === 'item' && item.title === title)
	const matchStyleItem = findEditItem('Paste and Match Style')
	const pasteItem = findEditItem('Paste')
	press('escape')
	settle()
	press('cmd-alt-shift-v')
	settle()
	check(
		'Paste and Match Style shows ⌥⇧⌘V and is greyed with no field open, where Paste is enabled, and ⌥⇧⌘V there changes nothing',
		[
			matchStyleKeys,
			matchStyleItem?.kind === 'item' && matchStyleItem.enabled,
			pasteItem?.kind === 'item' && pasteItem.enabled,
			documentController.text,
			documentController.activeIndex
		],
		['⌥⇧⌘V', false, true, 'One.\n', null]
	)
}
