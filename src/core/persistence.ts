/**
 * When a document saves itself, when it rereads its file, and what its
 * save-status label says.
 *
 * A pure state machine: the document feeds it events with the current time
 * (in seconds) and carries out the `Decision` it returns. It never touches a
 * file, a timer or a view itself, so every rule here can be tested by simulation.
 */

export type Policy = {
	/** Save once the user has paused this long... */
	idle: number
	/** ...or once changes have waited this long, even while typing. */
	maxWait: number
	/** How long "Saved" stays up after a save. */
	savedVisible: number
}

export const DEFAULT_POLICY: Policy = { idle: 1, maxWait: 5, savedVisible: 2 }

export type PersistenceEvent =
	/** Autosave applies only to documents with a file (not untitled ones). */
	| { type: 'autosaves'; enabled: boolean }
	/** The content changed; `dirty` says whether it now differs from the file. */
	| { type: 'changed'; dirty: boolean }
	/** A save began (an autosave, or one the user asked for). */
	| { type: 'saveStarted' }
	/** A save ended, with an error message if it failed. */
	| { type: 'saveFinished'; error: string | null }
	/** Something else may have written to the file. */
	| { type: 'diskChanged' }
	/** A check of the file asked for by a decision is done. */
	| { type: 'diskChecked' }
	/** A wake-up asked for by a decision. */
	| { type: 'tick' }

/** What the window's save-status label shows. */
export type SaveLabel =
	{ kind: 'none' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'failed'; message: string }

export type Decision = {
	/** Start saving now. */
	save: boolean
	/** Read the file and merge in anything new. */
	checkDisk: boolean
	/** Send `tick` at this time (replacing any earlier request), or never. */
	wake: number | null
	label: SaveLabel
}

const LABEL_TEXT: Record<SaveLabel['kind'], string> = {
	none: '',
	saving: 'Saving…',
	saved: 'Saved',
	failed: 'Not Saved'
}

export function labelText(label: SaveLabel): string {
	return LABEL_TEXT[label.kind]
}

/** More detail, for a tooltip. */
export function labelDetail(label: SaveLabel): string | null {
	return label.kind === 'failed' ? label.message : null
}

type Failure = { message: string; at: number }

export class Persistence {
	readonly policy: Policy
	#autosaves = false
	#dirty = false
	/** When the content last changed, and when the oldest unsaved change was made. */
	#lastChange = 0
	#firstUnsaved: number | null = null
	/** A save has been asked for but has not started yet. */
	#saveRequested = false
	#saving = 0
	#savedAt: number | null = null
	#failure: Failure | null = null
	#checkingDisk = false
	/** The file changed while it could not be read safely (mid-save, mid-check). */
	#diskPending = false

	constructor(policy: Policy = DEFAULT_POLICY) {
		this.policy = policy
	}

	handle(event: PersistenceEvent, now: number): Decision {
		const decision: Decision = {
			save: false,
			checkDisk: false,
			wake: null,
			label: { kind: 'none' }
		}

		switch (event.type) {
			case 'autosaves':
				this.#autosaves = event.enabled
				break
			case 'changed':
				this.#dirty = event.dirty
				if (event.dirty) {
					this.#lastChange = now
					this.#firstUnsaved ??= now
				} else {
					// Nothing left to save, so no failure left to report.
					this.#firstUnsaved = null
					this.#failure = null
				}
				break
			case 'saveStarted':
				this.#saveRequested = false
				this.#saving += 1
				break
			case 'saveFinished':
				this.#saving = Math.max(this.#saving - 1, 0)
				if (event.error !== null) {
					this.#failure = { message: event.error, at: now }
				} else {
					// Clean until the editor says otherwise: it reports right
					// after a save, including any edits made while it ran.
					this.#failure = null
					this.#savedAt = now
					this.#dirty = false
					this.#firstUnsaved = null
				}
				break
			case 'diskChanged':
				this.#diskPending = true
				break
			case 'diskChecked':
				this.#checkingDisk = false
				break
			case 'tick':
				break
		}

		const busy = this.#saving > 0 || this.#saveRequested || this.#checkingDisk
		if (this.#diskPending && !busy) {
			this.#diskPending = false
			this.#checkingDisk = true
			decision.checkDisk = true
		}

		const due = this.#saveDue()
		if (due !== null && !busy) {
			if (now >= due) {
				this.#saveRequested = true
				decision.save = true
			} else {
				decision.wake = due
			}
		}

		decision.label = this.label(now)
		if (decision.label.kind === 'saved' && this.#savedAt !== null) {
			decision.wake = Math.min(decision.wake ?? Infinity, this.#savedAt + this.policy.savedVisible)
		}

		return decision
	}

	label(now: number): SaveLabel {
		if (!this.#autosaves) return { kind: 'none' }
		if (this.#saving > 0 || this.#saveRequested) return { kind: 'saving' }
		if (this.#failure) return { kind: 'failed', message: this.#failure.message }
		if (this.#dirty) return { kind: 'saving' }
		if (this.#savedAt !== null && now < this.#savedAt + this.policy.savedVisible)
			return { kind: 'saved' }
		return { kind: 'none' }
	}

	/** When the next autosave should happen, if one is needed. */
	#saveDue(): number | null {
		if (!this.#autosaves || !this.#dirty || this.#firstUnsaved === null) return null
		// After a failure, wait for another change rather than retry in a loop.
		if (this.#failure && this.#lastChange <= this.#failure.at) return null
		return Math.min(this.#lastChange + this.policy.idle, this.#firstUnsaved + this.policy.maxWait)
	}
}
