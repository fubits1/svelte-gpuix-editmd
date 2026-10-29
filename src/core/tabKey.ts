import type { BlockKind } from '../engine/blocks.ts'

/** the modifiers held with a key, as a gpuix key event reports them */
type Modifiers = { cmd: boolean; ctrl: boolean; alt: boolean; shift: boolean }

/**
 * what Tab or Shift-Tab does in a Block's field: `spaces` types INDENT_KEYS at the caret, `indent` and `outdent` run
 * Format > Indent and Outdent on the caret's list item, `none` takes the key and changes nothing
 */
type TabAction = 'spaces' | 'indent' | 'outdent' | 'none'

/**
 * editmd's `.use(indent)` with no config (editmd/web/src/editor.ts:481) types `{ type: 'space', size: 2 }` at the
 * caret (@milkdown/plugin-indent src/index.ts:52, 63-71). editmd keeps a selection and puts them after it; here, as in
 * VS Code, they replace it
 */
const INDENT_KEYS = 'space space'

/** what a taken Tab does to the open Block field */
export type TabEffects = {
	/** sends keystrokes to the focused field */
	type: (keys: string) => void
	/** gives the open field the keys back; false when no field is there to take them */
	focus: () => boolean
	/** Format > Indent or Outdent on the field; `refused` runs where the command gives null */
	format: (command: 'indent' | 'outdent', refused?: () => void) => void
}

/**
 * the TabAction for `key` in the field of a `kind` Block (undefined for an empty Document's first field), null where
 * gpuix keeps it for its focus move: any key but Tab, Tab with Cmd, Ctrl or Alt, and front matter, whose box in editmd
 * has no Tab handler. in a list Tab and Shift-Tab sink and lift the item (@milkdown/preset-commonmark
 * src/node/list-item.ts:212-225); elsewhere Tab indents with plugin-indent and Shift-Tab, which nothing binds there,
 * changes nothing
 */
export function tabAction(
	key: string,
	{ cmd, ctrl, alt, shift }: Modifiers,
	kind: BlockKind | undefined
): TabAction | null {
	if (key !== 'tab' || cmd || ctrl || alt || kind === 'frontmatter') return null
	if (kind === 'list') return shift ? 'outdent' : 'indent'
	return shift ? 'none' : 'spaces'
}

/**
 * carries out `tabAction` through `effects`; true when the key is taken, so the view keeps gpuix from moving focus.
 * where Indent refuses (a list's first item) Tab types INDENT_KEYS instead, as editmd's plugin-indent takes a Tab the
 * list item sink refused
 */
export function pressTab(
	key: string,
	modifiers: Modifiers,
	kind: BlockKind | undefined,
	{ type, focus, format }: TabEffects
): boolean {
	const action = tabAction(key, modifiers, kind)
	if (action === 'spaces') type(INDENT_KEYS)
	else if (action === 'indent') {
		format('indent', () => {
			if (focus()) type(INDENT_KEYS)
		})
	} else if (action === 'outdent') format('outdent')
	return action !== null
}
