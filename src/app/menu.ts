import { chordOf, type Command } from './shortcuts.ts'

/** editmd's menu items that have no key equivalent, reachable here only through the command palette */
const MENU_ONLY = ['openRecent', 'revert', 'table', 'horizontalRule', 'loadRemoteImages'] as const

export type MenuOnlyCommand = (typeof MENU_ONLY)[number]

export type MenuCommand = Command | MenuOnlyCommand

export type MenuEntry = {
	menu: 'File' | 'Edit' | 'Format' | 'View'
	title: string
	command: MenuCommand
	/** the key equivalent in macOS glyphs ('⇧⌘S'), empty for none */
	keys: string
	enabled: boolean
}

/** what editmd's `validateMenuItem` looks at, and the files Open Recent lists */
export type MenuState = {
	sourceMode: boolean
	remoteImagesAllowed: boolean
	/** none when left out, as for the command palette, which lists Open Recent as one entry */
	recent?: readonly string[]
	/** a file to revert to: NSDocument enables Revert to Saved for one, edited or not */
	hasFile: boolean
	/**
	 * painted text is selected, which Edit > Copy copies, as WKWebView enables Copy while the page holds a selection;
	 * none when left out
	 */
	hasSelection?: boolean
	/**
	 * a Block's field is open, whose selection the inline formats read through its keys; none when left
	 * out
	 */
	blockField?: boolean
	/**
	 * a field of the Document (a Block's or Source mode's) has the keys, so Cut, Copy, Paste and Select All can send it
	 * its own; none when left out
	 */
	fieldFocused?: boolean
}

type Item = [title: string, command: MenuCommand]

/**
 * editmd's menus (Sources/editmd/MainMenu.swift@9e889e6) without what gpuix's fixed app menu already
 * has (Hide, Quit, Minimize, Zoom) and what belongs to the focused text field (Cut, Paste, Paste and
 * Match Style, Delete, Select All, Spelling and Grammar); Copy is here for the painted text's selection
 */
const MENUS: Record<MenuEntry['menu'], Item[]> = {
	File: [
		['New', 'new'],
		['Open…', 'open'],
		['Open Recent', 'openRecent'],
		['Close', 'close'],
		['Save…', 'save'],
		['Save As…', 'saveAs'],
		['Revert to Saved', 'revert'],
		['Page Setup…', 'pageSetup'],
		['Print…', 'print']
	],
	Edit: [
		['Undo', 'undo'],
		['Redo', 'redo'],
		['Copy', 'copy'],
		['Find…', 'find'],
		['Find Next', 'findNext'],
		['Find Previous', 'findPrevious']
	],
	Format: [
		['Bold', 'bold'],
		['Italic', 'italic'],
		['Strikethrough', 'strikethrough'],
		['Inline Code', 'code'],
		['Link…', 'link'],
		['Body Text', 'body'],
		['Heading 1', 'heading1'],
		['Heading 2', 'heading2'],
		['Heading 3', 'heading3'],
		['Heading 4', 'heading4'],
		['Heading 5', 'heading5'],
		['Heading 6', 'heading6'],
		['Bulleted List', 'bulletList'],
		['Numbered List', 'numberedList'],
		['Indent', 'indent'],
		['Outdent', 'outdent'],
		['Quote', 'quote'],
		['Code Block', 'codeBlock'],
		['Table', 'table'],
		['Horizontal Rule', 'horizontalRule']
	],
	View: [
		['Show Markdown Source', 'toggleSource'],
		['Load Remote Images', 'loadRemoteImages'],
		['Actual Size', 'actualSize'],
		['Zoom In', 'zoomIn'],
		['Zoom Out', 'zoomOut']
	]
}

/**
 * inline formats act on a Block field's selection, which the field reports only through its keys, so they
 * need a Block's field open. Link… stays enabled: with nothing selected editmd inserts the URL itself
 * (editor.ts:387-396)
 */
const NEEDS_SELECTION = new Set<MenuCommand>(['bold', 'italic', 'strikethrough', 'code'])

/** a COMMANDS chord ('shift-alt-s', or '-' for the minus key) as macOS draws it, modifiers in the order ⌥⇧⌘ */
function glyphs(chord: string): string {
	const modifiers = chord.slice(0, -1)
	const key = chord.at(-1)!
	return `${modifiers.includes('alt-') ? '⌥' : ''}${modifiers.includes('shift-') ? '⇧' : ''}⌘${key.toUpperCase()}`
}

const isKeyed = (command: MenuCommand): command is Command =>
	!MENU_ONLY.some((menuOnly) => menuOnly === command)

/** every menu item for the command palette, titled and enabled as editmd's `validateMenuItem` would */
export function menuEntries({
	sourceMode,
	remoteImagesAllowed,
	hasFile,
	hasSelection = false,
	blockField = false,
	fieldFocused = false
}: MenuState): MenuEntry[] {
	return Object.entries(MENUS).flatMap(([menu, items]) =>
		items.map(([title, command]) => {
			const chord = isKeyed(command) ? chordOf(command) : null
			const entry: MenuEntry = {
				menu: menu as MenuEntry['menu'],
				title,
				command,
				keys: chord ? glyphs(chord) : '',
				enabled: !NEEDS_SELECTION.has(command) || blockField
			}
			if (command === 'toggleSource' && sourceMode) entry.title = 'Show Rendered Markdown'
			if (menu === 'Format' && sourceMode) entry.enabled = false
			if (command === 'loadRemoteImages' && remoteImagesAllowed) entry.enabled = false
			if (command === 'revert') entry.enabled = hasFile
			// a focused field copies its own selection; outside one, the painted text's
			if (command === 'copy') entry.enabled = hasSelection || fieldFocused
			return entry
		})
	)
}

/**
 * the Edit items a focused field carries out as its own keys, which the menu sends it (`simulateKeystrokes`);
 * editmd's AppKit sends `cut:`, `paste:`, `pasteAsPlainText:` and `selectAll:` to the first responder
 */
export type FieldCommand = 'cut' | 'paste' | 'pasteAndMatchStyle' | 'selectAll'

/** what an in-window menu item does beyond a MenuCommand: window actions, Open Recent's entries, field keys */
export type BarCommand =
	| MenuCommand
	| FieldCommand
	| 'minimize'
	| 'zoomWindow'
	| 'bringAllToFront'
	| 'clearRecent'
	| 'toggleFullScreen'

export type MenuBarItem =
	| { kind: 'separator' }
	| {
			kind: 'item'
			title: string
			/** macOS glyphs, empty for none */
			keys: string
			enabled: boolean
			/** null for an item that only holds a submenu, or that this port cannot carry out (disabled) */
			command: BarCommand | null
			/** for an Open Recent entry: the file it opens */
			path?: string
			submenu?: MenuBarItem[]
	  }

export type MenuBarMenu = { title: string; items: MenuBarItem[] }

const SEPARATOR: MenuBarItem = { kind: 'separator' }

/**
 * an item the focused text field handles by key, which a menu click cannot reach in gpuix (no field API for it):
 * Delete, and spelling (gap G7). Copy is a command of its own, for the painted text's selection, which gpuix reports
 */
const fieldOnly = (title: string, keys = ''): Extract<MenuBarItem, { kind: 'item' }> => ({
	kind: 'item',
	title,
	keys,
	enabled: false,
	command: null
})

/**
 * editmd's menu bar (MainMenu.swift:33-130) for drawing inside the window, since gpuix's native bar
 * holds only its fixed app and Window menus (gap G2). Items, order, separators, submenus and key
 * equivalents are editmd's; what gpuix cannot do from a click is listed disabled
 */
export function menuBar(state: MenuState): MenuBarMenu[] {
	const entries = new Map(menuEntries(state).map((entry) => [entry.command, entry]))
	const entry = (command: MenuCommand): Extract<MenuBarItem, { kind: 'item' }> => {
		const { title, keys, enabled } = entries.get(command)!
		return { kind: 'item', title, keys, enabled, command }
	}
	const action = (title: string, command: BarCommand, keys = ''): MenuBarItem => ({
		kind: 'item',
		title,
		keys,
		enabled: true,
		command
	})
	// enabled while a field of the Document has the keys, which the item sends it
	const fieldKey = (title: string, command: FieldCommand, keys: string): MenuBarItem => ({
		kind: 'item',
		title,
		keys,
		enabled: state.fieldFocused ?? false,
		command
	})
	const recentFiles: MenuBarItem[] = (state.recent ?? []).map((path) => ({
		kind: 'item',
		title: path.split('/').at(-1) ?? path,
		keys: '',
		enabled: true,
		command: 'openRecent',
		path
	}))
	const clearRecent = { ...action('Clear Menu', 'clearRecent'), enabled: recentFiles.length > 0 }

	return [
		{
			title: 'File',
			items: [
				entry('new'),
				entry('open'),
				{
					...entry('openRecent'),
					submenu: [...recentFiles, ...(recentFiles.length > 0 ? [SEPARATOR] : []), clearRecent]
				},
				SEPARATOR,
				entry('close'),
				entry('save'),
				entry('saveAs'),
				entry('revert'),
				SEPARATOR,
				entry('pageSetup'),
				entry('print')
			]
		},
		{
			title: 'Edit',
			items: [
				entry('undo'),
				entry('redo'),
				SEPARATOR,
				fieldKey('Cut', 'cut', '⌘X'),
				entry('copy'),
				fieldKey('Paste', 'paste', '⌘V'),
				fieldKey('Paste and Match Style', 'pasteAndMatchStyle', '⌥⇧⌘V'),
				fieldOnly('Delete'),
				fieldKey('Select All', 'selectAll', '⌘A'),
				SEPARATOR,
				{
					kind: 'item',
					title: 'Find',
					keys: '',
					enabled: true,
					command: null,
					submenu: [entry('find'), entry('findNext'), entry('findPrevious')]
				},
				// spelling in the gpuix text field is unknown (gap G7)
				{
					...fieldOnly('Spelling and Grammar'),
					submenu: [
						fieldOnly('Show Spelling and Grammar', '⌘:'),
						fieldOnly('Check Document Now', '⌘;'),
						SEPARATOR,
						fieldOnly('Check Spelling While Typing')
					]
				}
			]
		},
		{
			title: 'Format',
			items: [
				entry('bold'),
				entry('italic'),
				entry('strikethrough'),
				entry('code'),
				entry('link'),
				SEPARATOR,
				entry('body'),
				entry('heading1'),
				entry('heading2'),
				entry('heading3'),
				entry('heading4'),
				entry('heading5'),
				entry('heading6'),
				SEPARATOR,
				entry('bulletList'),
				entry('numberedList'),
				entry('indent'),
				entry('outdent'),
				SEPARATOR,
				entry('quote'),
				entry('codeBlock'),
				entry('table'),
				entry('horizontalRule')
			]
		},
		{
			title: 'View',
			items: [
				entry('toggleSource'),
				entry('loadRemoteImages'),
				SEPARATOR,
				entry('actualSize'),
				entry('zoomIn'),
				entry('zoomOut'),
				SEPARATOR,
				// AppKit appends this after the separator editmd ends its View menu with (MainMenu.swift:112)
				action('Enter Full Screen', 'toggleFullScreen', '⌃⌘F')
			]
		},
		{
			title: 'Window',
			items: [
				action('Minimize', 'minimize', '⌘M'),
				action('Zoom', 'zoomWindow'),
				SEPARATOR,
				action('Bring All to Front', 'bringAllToFront')
			]
		},
		// editmd's Help menu is empty; macOS adds its menu search to it
		{ title: 'Help', items: [] }
	]
}

export type MenuSearchHit = {
	/** the menu and any submenus above the item, as macOS's menu search shows them */
	path: string[]
	item: Extract<MenuBarItem, { kind: 'item' }>
}

/**
 * macOS's menu search in the Help menu: every item without a submenu, in any menu or submenu, whose
 * title holds each word of `query`, case ignored, in bar order; disabled items are found too (macOS
 * lists them greyed). Nothing for an empty query
 */
export function searchMenuBar(query: string, bar: readonly MenuBarMenu[]): MenuSearchHit[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean)
	if (words.length === 0) return []

	const search = (items: readonly MenuBarItem[], path: string[]): MenuSearchHit[] =>
		items.flatMap((item) => {
			if (item.kind === 'separator') return []
			if (item.submenu) return search(item.submenu, [...path, item.title])
			const title = item.title.toLowerCase()
			return words.every((word) => title.includes(word)) ? [{ path, item }] : []
		})
	return bar.flatMap((menu) => search(menu.items, [menu.title]))
}

/** the entries whose menu and title hold every word of `query`, case ignored, in menu order */
export function filterEntries(query: string, entries: readonly MenuEntry[]): MenuEntry[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean)
	return entries.filter((entry) => {
		const text = `${entry.menu} ${entry.title}`.toLowerCase()
		return words.every((word) => text.includes(word))
	})
}
