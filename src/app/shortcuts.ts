/**
 * editmd's menu key equivalents (MainMenu.swift); GPUI's menu bar cannot be extended (gap G2),
 * so every shortcut is matched here from `on_window_key` events
 */

export type Modifiers = { cmd: boolean; ctrl: boolean; alt: boolean; shift: boolean }

export type Command =
	| 'save'
	| 'saveAs'
	| 'open'
	| 'new'
	| 'close'
	| 'print'
	| 'pageSetup'
	| 'undo'
	| 'redo'
	| 'copy'
	| 'paste'
	| 'pasteAndMatchStyle'
	| 'find'
	| 'findNext'
	| 'findPrevious'
	| 'bold'
	| 'italic'
	| 'strikethrough'
	| 'code'
	| 'link'
	| 'body'
	| 'heading1'
	| 'heading2'
	| 'heading3'
	| 'heading4'
	| 'heading5'
	| 'heading6'
	| 'bulletList'
	| 'numberedList'
	| 'indent'
	| 'outdent'
	| 'quote'
	| 'codeBlock'
	| 'toggleSource'
	| 'zoomIn'
	| 'zoomOut'
	| 'actualSize'
	| 'commandPalette'
	| 'helpSearch'
	| 'toggleFullScreen'
	| 'quit'

/** `<ctrl><shift><alt><key>` behind cmd: '' / 'ctrl-' / 'shift-' / 'alt-' prefixes */
const COMMANDS: Record<string, Command> = {
	s: 'save',
	'shift-s': 'saveAs',
	o: 'open',
	n: 'new',
	w: 'close',
	// App > Quit (MainMenu.swift:30), which in a real window GPUI's own Quit takes first (gap G17; see `quit` in the
	// `#commands` of ui/DocumentView/controller.svelte.ts)
	q: 'quit',
	p: 'print',
	'shift-p': 'pageSetup',
	z: 'undo',
	'shift-z': 'redo',
	// editmd's editor keymap redoes on Mod-y too (web/src/editor.ts:509); after ⇧⌘Z, so the menu shows ⇧⌘Z
	y: 'redo',
	// Edit > Copy: a focused field copies its own selection; outside one, the painted text's selection is copied
	c: 'copy',
	// Edit > Paste: a focused field pastes on its own; with none, editmd's page pastes at its caret
	v: 'paste',
	// Edit > Paste and Match Style, ⌥⇧⌘V (MainMenu.swift): a focused field takes it; with none it is greyed, unlike Paste
	'shift-alt-v': 'pasteAndMatchStyle',
	f: 'find',
	g: 'findNext',
	'shift-g': 'findPrevious',
	b: 'bold',
	i: 'italic',
	'shift-x': 'strikethrough',
	e: 'code',
	// editmd's Link… is ⌘K (MainMenu.swift); the port gives ⌘K to its palette, as Notion and Linear do.
	'shift-k': 'link',
	'alt-0': 'body',
	'alt-1': 'heading1',
	'alt-2': 'heading2',
	'alt-3': 'heading3',
	'alt-4': 'heading4',
	'alt-5': 'heading5',
	'alt-6': 'heading6',
	'shift-8': 'bulletList',
	'shift-7': 'numberedList',
	']': 'indent',
	'[': 'outdent',
	'shift-b': 'quote',
	'alt-c': 'codeBlock',
	'/': 'toggleSource',
	'=': 'zoomIn',
	'-': 'zoomOut',
	'0': 'actualSize',
	// not editmd's: the palette of the File, Edit, Format and View commands (`menuEntries`), beside the in-window Help
	// menu's search (HelpSearch.svelte), which stands in for the native one (gap G2)
	k: 'commandPalette',
	// macOS's Help menu search, here the in-window Help menu's
	'shift-/': 'helpSearch',
	// AppKit's View > Enter Full Screen, which it adds to editmd's View menu
	'ctrl-f': 'toggleFullScreen'
}

/** the chord behind cmd that runs `command`, spelled as in COMMANDS ('shift-s'), or null when it has no key */
export function chordOf(command: string): string | null {
	return Object.entries(COMMANDS).find(([, each]) => each === command)?.[0] ?? null
}

/** the command for a key press, or null so ordinary typing is never taken */
export function commandFor(key: string, modifiers: Modifiers): Command | null {
	if (!modifiers.cmd) return null
	const chord = `${modifiers.ctrl ? 'ctrl-' : ''}${modifiers.shift ? 'shift-' : ''}${modifiers.alt ? 'alt-' : ''}${key.toLowerCase()}`
	return COMMANDS[chord] ?? null
}
