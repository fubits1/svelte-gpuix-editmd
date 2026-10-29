import { lstatSync, realpathSync, watch } from 'node:fs'
import { basename, dirname } from 'node:path'

/**
 * calls `changed` when the file at `path` may have been written. Watches the folder, not the
 * file: an atomic save (write a temp file, rename it over) replaces the inode a file watch holds.
 * returns the unwatch function.
 */
export function watchFile(path: string, changed: () => void): () => void {
	const watched = [path]
	// a symlink's writes land at its target, often in another folder: that folder is watched too
	try {
		if (lstatSync(path).isSymbolicLink()) watched.push(realpathSync(path))
	} catch {
		// a file that is not there yet is watched by its own name
	}
	const watchers = watched.map((each) => {
		const name = basename(each)
		return watch(dirname(each), (_event, filename) => {
			if (filename === name) changed()
		})
	})
	return () => {
		for (const watcher of watchers) watcher.close()
	}
}
