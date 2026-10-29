import { describe, expect, test } from 'vitest'
import { commandFor } from './shortcuts.ts'

const cmd = { cmd: true, ctrl: false, alt: false, shift: false }
const shift = { ...cmd, shift: true }
const alt = { ...cmd, alt: true }

describe('commandFor', () => {
	test.each([
		['s', cmd, 'save'],
		['s', shift, 'saveAs'],
		['o', cmd, 'open'],
		['n', cmd, 'new'],
		['w', cmd, 'close'],
		// Quit, from gpuix's App menu: taken first so unsaved edits are saved or asked about (GPUI's own quit ends
		// the process without Node's `exit` event, measured in a real window)
		['q', cmd, 'quit'],
		['p', cmd, 'print'],
		['p', shift, 'pageSetup'],
		['/', shift, 'commandPalette'],
		['z', cmd, 'undo'],
		['z', shift, 'redo'],
		// editmd's editor keymap also redoes on Mod-y (web/src/editor.ts:509)
		['y', cmd, 'redo'],
		['f', cmd, 'find'],
		['g', cmd, 'findNext'],
		['g', shift, 'findPrevious'],
		['b', cmd, 'bold'],
		['i', cmd, 'italic'],
		['x', shift, 'strikethrough'],
		['e', cmd, 'code'],
		['k', cmd, 'link'],
		['0', alt, 'body'],
		['1', alt, 'heading1'],
		['2', alt, 'heading2'],
		['3', alt, 'heading3'],
		['4', alt, 'heading4'],
		['5', alt, 'heading5'],
		['6', alt, 'heading6'],
		['8', shift, 'bulletList'],
		['7', shift, 'numberedList'],
		[']', cmd, 'indent'],
		['[', cmd, 'outdent'],
		['b', shift, 'quote'],
		['c', alt, 'codeBlock'],
		['/', cmd, 'toggleSource'],
		['=', cmd, 'zoomIn'],
		['-', cmd, 'zoomOut'],
		['0', cmd, 'actualSize'],
		// Edit > Paste and Match Style, ⌥⇧⌘V (MainMenu.swift)
		['v', { ...cmd, alt: true, shift: true }, 'pasteAndMatchStyle']
	] as const)('%s with %j is %s (editmd MainMenu.swift)', (key, modifiers, command) => {
		expect(commandFor(key, modifiers)).toBe(command)
	})

	/** every printable key and the named ones, under every mix of Ctrl, Alt and Shift, with Cmd held or not */
	const keys = [
		..."abcdefghijklmnopqrstuvwxyz0123456789-=[]\\;',./`",
		'enter',
		'tab',
		'space',
		'escape',
		'backspace',
		'delete',
		'up',
		'down',
		'left',
		'right',
		'home',
		'end'
	]
	const flags = [false, true]
	const modifiersWith = (cmd: boolean) =>
		flags.flatMap((ctrl) =>
			flags.flatMap((alt) => flags.map((shift) => ({ cmd, ctrl, alt, shift })))
		)

	test('Table and Horizontal Rule have no key, as in editmd’s Format menu', () => {
		const commands = keys.flatMap((key) =>
			modifiersWith(true).map((held) => String(commandFor(key, held)))
		)
		expect(
			commands.filter((command) => command === 'table' || command === 'horizontalRule')
		).toEqual([])
	})

	// AppKit adds View > Enter Full Screen on ⌃⌘F to editmd's View menu; no other chord with ctrl is a command
	test('with ctrl held only ⌃⌘F is a command: Enter Full Screen', () => {
		const commands = keys.flatMap((key) =>
			modifiersWith(true)
				.filter(({ ctrl }) => ctrl)
				.map((held) => [key, held, commandFor(key, held)] as const)
		)
		expect(commands.filter(([, , command]) => command !== null)).toEqual([
			['f', { cmd: true, ctrl: true, alt: false, shift: false }, 'toggleFullScreen']
		])
	})

	test('a key without cmd is no command, so typing is never stolen', () => {
		const commands = keys.flatMap((key) =>
			modifiersWith(false).map((held) => commandFor(key, held))
		)
		expect(commands.filter((command) => command !== null)).toEqual([])
	})
})
