import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * whether the Agent legend is shrunk to its pill, kept in one JSON file every editor process shares, as editmd keeps
 * it in localStorage across its windows and launches (web/src/highlights.ts:221-229)
 */
export class LegendPreference {
	#store: string

	constructor(store: string) {
		this.#store = store
	}

	/** false for a store that is missing or unreadable, as editmd's `remembered` falls back to shown */
	minimized(): boolean {
		try {
			const stored: unknown = JSON.parse(readFileSync(this.#store, 'utf8'))
			return typeof stored === 'object' && stored !== null && 'minimized' in stored
				? stored.minimized === true
				: false
		} catch {
			return false
		}
	}

	/**
	 * a new file renamed over the store, which every window reads; a store that cannot be written keeps the choice for
	 * this window only, as editmd's `remember` catches a storage error (highlights.ts:318-322)
	 */
	setMinimized(minimized: boolean): void {
		const temporary = `${this.#store}.${process.pid}.tmp`
		try {
			mkdirSync(dirname(this.#store), { recursive: true })
			writeFileSync(temporary, JSON.stringify({ minimized }))
			renameSync(temporary, this.#store)
		} catch {
			try {
				rmSync(temporary, { force: true })
			} catch {
				// no folder to have left a copy in
			}
		}
	}
}
