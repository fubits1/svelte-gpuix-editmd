import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const LIMIT = 10

/** File > Open Recent, kept in one JSON file shared by every editor process */
export class RecentFiles {
	#store: string

	constructor(store: string) {
		this.#store = store
	}

	/** the recent files newest first, a file that no longer exists left out, as NSDocumentController does */
	list(): string[] {
		try {
			const paths: unknown = JSON.parse(readFileSync(this.#store, 'utf8'))
			return Array.isArray(paths)
				? paths.filter((path): path is string => typeof path === 'string' && existsSync(path))
				: []
		} catch {
			return []
		}
	}

	add(path: string): void {
		this.#write([path, ...this.list().filter((recent) => recent !== path)].slice(0, LIMIT))
	}

	clear(): void {
		this.#write([])
	}

	/**
	 * a new file renamed over the store: every window is its own process, and one reading while another writes must
	 * never find it cut short. two windows adding at once can still drop one of the two entries
	 */
	#write(paths: string[]): void {
		const temporary = `${this.#store}.${process.pid}.tmp`
		try {
			mkdirSync(dirname(this.#store), { recursive: true })
			writeFileSync(temporary, JSON.stringify(paths))
			renameSync(temporary, this.#store)
		} catch {
			// a list that cannot be kept never fails the Open or Save As that added to it
		}
	}
}
