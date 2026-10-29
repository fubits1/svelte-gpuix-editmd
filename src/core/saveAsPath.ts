import { basename, extname, join } from 'node:path'
import { isMarkdownPath } from './fileTypes.ts'

/**
 * where Save As writes a file named `name` in `folder`, as NSDocument's save panel names it: a markdown name is kept;
 * otherwise the name gets the document's own extension, since editmd's text documents keep their type (Info.plist
 * lists markdown, plain text and any data as Editor types): `.md` for a markdown or untitled document, the file's own
 * for a text file (`.txt`), none for a file without one. `current` is the document's path, null when untitled. null
 * for a name that is blank or would leave the folder
 */
export function saveAsPath(
	folder: string,
	name: string,
	current: string | null = null
): string | null {
	const trimmed = name.trim()
	if (trimmed === '' || trimmed === '.' || trimmed === '..' || trimmed.includes('/')) return null
	if (isMarkdownPath(trimmed)) return join(folder, trimmed)
	const own = current === null || isMarkdownPath(current) ? '.md' : extname(basename(current))
	const named = own !== '' && trimmed.toLowerCase().endsWith(own.toLowerCase())
	return join(folder, named ? trimmed : `${trimmed}${own}`)
}
