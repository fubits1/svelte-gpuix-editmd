// the Blocks editmd's Format menu inserts: Table and Horizontal Rule (the block commands live in formatBlock.ts)

/** Table: Milkdown's `insertTableCommand` default, a header row and two body rows of three empty cells */
export const TABLE = ['|   |   |   |', '| - | - | - |', '|   |   |   |', '|   |   |   |'].join('\n')

/** Horizontal Rule, as editmd's serializer writes rules (`rule: '-'`) */
export const HORIZONTAL_RULE = '---'
