// the Blocks editmd's Format menu inserts: Table and Horizontal Rule (the block commands live in formatBlock.ts)

/** Table: Milkdown's `insertTableCommand` default, a header row and two body rows of three empty cells */
export const TABLE = ['|   |   |   |', '| - | - | - |', '|   |   |   |', '|   |   |   |'].join('\n')

/** Horizontal Rule, as editmd's serializer writes rules (`rule: '-'`) */
export const HORIZONTAL_RULE = '---'

/** a list item's marker line: its indent, marker and the space after it, which together indent the item's text */
const ITEM_START = /^[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+/gm

/**
 * the list `list` with `inserted` under its last item, indented to that item's text, where editmd's insert lands
 * with its caret at the end of the list (measured in editmd's own editor)
 */
export function underLastItem(list: string, inserted: string): string {
	const indent = ' '.repeat([...list.matchAll(ITEM_START)].at(-1)?.[0].length ?? 0)
	return `${list}\n${inserted.replace(/^/gm, indent)}`
}
