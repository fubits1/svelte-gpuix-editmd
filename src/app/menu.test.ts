import { describe, expect, test } from 'vitest'
import { filterEntries, menuBar, menuEntries, searchMenuBar, type MenuBarItem } from './menu.ts'
import { commandFor } from './shortcuts.ts'

const STATE = {
	sourceMode: false,
	remoteImagesAllowed: false,
	recent: [],
	hasFile: true
}

describe('menuEntries', () => {
	test('editmd’s menus in order, each item with its key equivalent in macOS glyphs', () => {
		const file = menuEntries(STATE).filter((entry) => entry.menu === 'File')

		expect(file.map(({ title, keys }) => [title, keys])).toEqual([
			['New', '⌘N'],
			['Open…', '⌘O'],
			['Open Recent', ''],
			['Close', '⌘W'],
			['Save…', '⌘S'],
			['Save As…', '⇧⌘S'],
			['Revert to Saved', ''],
			['Page Setup…', '⇧⌘P'],
			['Print…', '⌘P']
		])
	})

	test('Format lists every item, each enabled outside Source mode', () => {
		const format = menuEntries(STATE).filter((entry) => entry.menu === 'Format')

		expect(format.map(({ title }) => title)).toEqual([
			'Bold',
			'Italic',
			'Strikethrough',
			'Inline Code',
			'Link…',
			'Body Text',
			'Heading 1',
			'Heading 2',
			'Heading 3',
			'Heading 4',
			'Heading 5',
			'Heading 6',
			'Bulleted List',
			'Numbered List',
			'Indent',
			'Outdent',
			'Quote',
			'Code Block',
			'Table',
			'Horizontal Rule'
		])
		expect(format.find(({ title }) => title === 'Heading 2')).toMatchObject({
			command: 'heading2',
			keys: '⌥⌘2',
			enabled: true
		})
		// with no field open Bold acts at the load caret, and Link… inserts the URL itself (editor.ts:387-396)
		expect(format.find(({ title }) => title === 'Bold')?.enabled).toBe(true)
		expect(format.find(({ title }) => title === 'Link…')?.enabled).toBe(true)
	})

	test('View keys, the minus key included', () => {
		const view = menuEntries(STATE).filter((entry) => entry.menu === 'View')

		expect(view.map(({ title, keys }) => [title, keys])).toEqual([
			['Show Markdown Source', '⌘/'],
			['Load Remote Images', ''],
			['Actual Size', '⌘0'],
			['Zoom In', '⌘='],
			['Zoom Out', '⌘-']
		])
	})

	test('as editmd validates them: Source mode renames the toggle and disables Format; Load Remote Images is done once allowed', () => {
		const source = menuEntries({ ...STATE, sourceMode: true, remoteImagesAllowed: true })

		expect(source.find(({ command }) => command === 'toggleSource')?.title).toBe(
			'Show Rendered Markdown'
		)
		expect(source.filter(({ menu }) => menu === 'Format').every(({ enabled }) => !enabled)).toBe(
			true
		)
		expect(source.find(({ command }) => command === 'loadRemoteImages')?.enabled).toBe(false)
		expect(menuEntries(STATE).find(({ command }) => command === 'toggleSource')?.title).toBe(
			'Show Markdown Source'
		)
	})
})

/** a menu as a row of strings: '-' for a separator, 'Title ⌘K' for an item, '(Title)' when disabled, '▸' before a submenu */
function spelled(items: readonly MenuBarItem[]): string[] {
	return items.map((item) => {
		if (item.kind === 'separator') return '-'
		const text = `${item.submenu ? '▸ ' : ''}${item.title}${item.keys ? ` ${item.keys}` : ''}`
		return item.enabled ? text : `(${text})`
	})
}

describe('menuBar', () => {
	const RECENT_STATE = { ...STATE, recent: ['/notes/a.md', '/notes/b.md'] }

	// MainMenu.swift:33-130; the app menu is gpuix's own native one, so the bar starts at File
	test('editmd’s menus in its order, with its separators, submenus and key equivalents', () => {
		const bar = menuBar(RECENT_STATE)

		expect(bar.map(({ title }) => title)).toEqual([
			'File',
			'Edit',
			'Format',
			'View',
			'Window',
			'Help'
		])
		expect(spelled(bar[0]!.items)).toEqual([
			'New ⌘N',
			'Open… ⌘O',
			'▸ Open Recent',
			'-',
			'Close ⌘W',
			'Save… ⌘S',
			'Save As… ⇧⌘S',
			'Revert to Saved',
			'-',
			'Page Setup… ⇧⌘P',
			'Print… ⌘P'
		])
		expect(spelled(bar[1]!.items)).toEqual([
			'Undo ⌘Z',
			'Redo ⇧⌘Z',
			'-',
			'(Cut ⌘X)',
			'(Copy ⌘C)',
			'Paste ⌘V',
			'(Paste and Match Style ⌥⇧⌘V)',
			'(Delete)',
			'(Select All ⌘A)',
			'-',
			'▸ Find',
			'(▸ Spelling and Grammar)'
		])
		expect(spelled(bar[2]!.items)).toEqual([
			'Bold ⌘B',
			'Italic ⌘I',
			'Strikethrough ⇧⌘X',
			'Inline Code ⌘E',
			'Link… ⌘K',
			'-',
			'Body Text ⌥⌘0',
			'Heading 1 ⌥⌘1',
			'Heading 2 ⌥⌘2',
			'Heading 3 ⌥⌘3',
			'Heading 4 ⌥⌘4',
			'Heading 5 ⌥⌘5',
			'Heading 6 ⌥⌘6',
			'-',
			'Bulleted List ⇧⌘8',
			'Numbered List ⇧⌘7',
			'Indent ⌘]',
			'Outdent ⌘[',
			'-',
			'Quote ⇧⌘B',
			'Code Block ⌥⌘C',
			'Table',
			'Horizontal Rule'
		])
		expect(spelled(bar[3]!.items)).toEqual([
			'Show Markdown Source ⌘/',
			'Load Remote Images',
			'-',
			'Actual Size ⌘0',
			'Zoom In ⌘=',
			'Zoom Out ⌘-',
			'-',
			// AppKit appends Enter Full Screen after the separator editmd ends its View menu with (MainMenu.swift:112)
			'Enter Full Screen ⌃⌘F'
		])
		expect(spelled(bar[4]!.items)).toEqual(['Minimize ⌘M', 'Zoom', '-', 'Bring All to Front'])
		expect(spelled(bar[5]!.items)).toEqual([])
	})

	test('Open Recent lists the recent files, then Clear Menu; Find and Spelling hold editmd’s items', () => {
		const [file, edit] = menuBar(RECENT_STATE)
		const submenuOf = (items: readonly MenuBarItem[], title: string) =>
			items.find((item) => item.kind === 'item' && item.title === title)

		const recent = submenuOf(file!.items, 'Open Recent')
		expect(recent?.kind === 'item' && spelled(recent.submenu ?? [])).toEqual([
			'a.md',
			'b.md',
			'-',
			'Clear Menu'
		])
		const find = submenuOf(edit!.items, 'Find')
		expect(find?.kind === 'item' && spelled(find.submenu ?? [])).toEqual([
			'Find… ⌘F',
			'Find Next ⌘G',
			'Find Previous ⇧⌘G'
		])
		const spelling = submenuOf(edit!.items, 'Spelling and Grammar')
		expect(spelling?.kind === 'item' && spelled(spelling.submenu ?? [])).toEqual([
			'(Show Spelling and Grammar ⌘:)',
			'(Check Document Now ⌘;)',
			'-',
			'(Check Spelling While Typing)'
		])
		const empty = menuBar(STATE)[0]!.items.find(
			(item) => item.kind === 'item' && item.title === 'Open Recent'
		)
		expect(empty?.kind === 'item' && spelled(empty.submenu ?? [])).toEqual(['(Clear Menu)'])
	})

	test('validated as editmd does: Source mode renames the toggle and disables Format', () => {
		const [, , format, view] = menuBar({ ...STATE, sourceMode: true })
		expect(spelled(view!.items)[0]).toBe('Show Rendered Markdown ⌘/')
		expect(format!.items.every((item) => item.kind === 'separator' || !item.enabled)).toBe(true)
	})
})

describe('Revert to Saved', () => {
	// NSDocument validates `revertDocumentToSaved:` to a file-backed document, edited or not (editmd's
	// File menu on a clean document shows it enabled)
	test('is enabled for a document with a file, edited or not', () => {
		const revert = (hasFile: boolean) =>
			menuEntries({ ...STATE, hasFile }).find(({ command }) => command === 'revert')?.enabled

		expect([revert(true), revert(false)]).toEqual([true, false])
	})
})

describe('Copy', () => {
	// WKWebView validates `copy:` to a page holding a selection; the port's is the painted text's (gpuix's selection)
	test('is enabled only while painted text is selected, in the bar and the palette alike', () => {
		const copy = (hasSelection: boolean | undefined) => [
			menuEntries({ ...STATE, hasSelection }).find(({ command }) => command === 'copy')?.enabled,
			menuBar({ ...STATE, hasSelection })[1]!.items.find(
				(item) => item.kind === 'item' && item.title === 'Copy'
			)
		]

		expect(copy(true)).toEqual([
			true,
			{ kind: 'item', title: 'Copy', keys: '⌘C', enabled: true, command: 'copy' }
		])
		expect(copy(false)[0]).toBe(false)
		expect(copy(undefined)[0]).toBe(false)
	})
})

describe('Paste', () => {
	// editmd's editable page takes `paste:` at its caret, a field open or not (plugin-clipboard handlePaste), so Paste
	// is a command of its own, ⌘V, enabled in the bar and the palette alike
	test('is enabled with no field open, as the command ⌘V runs', () => {
		const bar = menuBar(STATE)[1]!.items.find(
			(item) => item.kind === 'item' && item.title === 'Paste'
		)
		expect([
			bar,
			menuEntries(STATE).find(({ command }) => command === 'paste')?.enabled,
			commandFor('v', { cmd: true, ctrl: false, alt: false, shift: false })
		]).toEqual([
			{ kind: 'item', title: 'Paste', keys: '⌘V', enabled: true, command: 'paste' },
			true,
			'paste'
		])
	})
})

describe('a field of the Document', () => {
	/**
	 * the inline formats act on a Block field's selection, or with no field open at editmd's load caret, so they are
	 * enabled as editmd's are in its rich editor, and disabled in Source mode with the rest of Format
	 */
	test('Bold, Italic, Strikethrough and Inline Code are enabled outside Source mode, a field open or not, in the bar and the palette', () => {
		const inline = (state: typeof STATE) => [
			menuEntries(state)
				.filter(({ menu }) => menu === 'Format')
				.slice(0, 4)
				.map(({ enabled }) => enabled),
			spelled(menuBar(state)[2]!.items.slice(0, 4))
		]

		expect(inline(STATE)).toEqual([
			[true, true, true, true],
			['Bold ⌘B', 'Italic ⌘I', 'Strikethrough ⇧⌘X', 'Inline Code ⌘E']
		])
		expect(inline({ ...STATE, sourceMode: true })[0]).toEqual([false, false, false, false])
	})

	/**
	 * Cut, Copy, Paste, Paste and Match Style and Select All go to the focused field as its own keys; Delete stays
	 * greyed. outside a field Copy is the painted text's
	 */
	test('Edit’s field items are enabled while a field is focused, each sending its key; Delete stays greyed', () => {
		const edit = menuBar({ ...STATE, fieldFocused: true })[1]!.items
		expect(spelled(edit.slice(3, 9))).toEqual([
			'Cut ⌘X',
			'Copy ⌘C',
			'Paste ⌘V',
			'Paste and Match Style ⌥⇧⌘V',
			'(Delete)',
			'Select All ⌘A'
		])
		expect(edit.slice(3, 9).map((item) => (item.kind === 'item' ? item.command : null))).toEqual([
			'cut',
			'copy',
			'paste',
			'pasteAndMatchStyle',
			null,
			'selectAll'
		])
		expect(
			menuEntries({ ...STATE, fieldFocused: true }).find(({ command }) => command === 'copy')
				?.enabled
		).toBe(true)
	})
})

describe('filterEntries', () => {
	test('every word of the query must appear in the menu or the title, case ignored, in menu order', () => {
		const titles = filterEntries('head 2', menuEntries(STATE)).map(({ title }) => title)
		expect(titles).toEqual(['Heading 2'])

		expect(filterEntries('view zoom', menuEntries(STATE)).map(({ title }) => title)).toEqual([
			'Zoom In',
			'Zoom Out'
		])
		expect(filterEntries('', menuEntries(STATE))).toHaveLength(menuEntries(STATE).length)
	})
})

/** macOS menu search in the Help menu finds every item of every menu, submenus and disabled items included */
describe('searchMenuBar', () => {
	const RECENT = { ...STATE, recent: ['/notes/a.md'] }
	const found = (query: string) =>
		searchMenuBar(query, menuBar(RECENT)).map(
			({ path, item }) => `${[...path, item.title].join(' ▸ ')}${item.enabled ? '' : ' (disabled)'}`
		)

	test('finds items the command palette leaves out: field items, Window, submenu entries', () => {
		expect(found('copy')).toEqual(['Edit ▸ Copy (disabled)'])
		expect(found('front')).toEqual(['Window ▸ Bring All to Front'])
		expect(found('a.md')).toEqual(['File ▸ Open Recent ▸ a.md'])
		expect(found('full screen')).toEqual(['View ▸ Enter Full Screen'])
		expect(found('spelling')).toEqual([
			'Edit ▸ Spelling and Grammar ▸ Show Spelling and Grammar (disabled)',
			'Edit ▸ Spelling and Grammar ▸ Check Spelling While Typing (disabled)'
		])
	})

	test('every word must appear in the item title, case ignored; nothing for an empty query', () => {
		expect(found('FIND prev')).toEqual(['Edit ▸ Find ▸ Find Previous'])
		expect(found('  ')).toEqual([])
	})
})
