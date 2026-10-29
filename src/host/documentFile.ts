import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, fstatSync, openSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AgentAuthor } from '../core/agentEdits.ts'
import { withUtf8Locale } from './locale.ts'
import { stableRead } from './stableRead.ts'
import { saveErrorDescription } from '../core/writeErrors.ts'
import { Document } from '../core/document.ts'
import {
	type Decision,
	Persistence,
	type PersistenceEvent,
	type SaveLabel
} from '../core/persistence.ts'
import {
	ChangedOnDiskError,
	createTextFile,
	FileExistsError,
	openTextFile,
	type OpenTextFile
} from './files.ts'

/** merge-and-retry rounds when the file keeps changing under a save, as editmd's Document does */
const SAVE_ATTEMPTS = 3

/** how long a path seen gone is given to come back (another editor's rename-and-write save) before it is followed */
const MOVE_SETTLE_MS = 150

/** the reason a "Not Saved" label shows for a save of `path` */
const messageOf = (path: string, error: unknown) =>
	error instanceof Error ? saveErrorDescription(path, error) : String(error)

/** `a` and `b` name one file: the same path, or the same device and inode once symlinks are followed */
function isSameFile(a: string, b: string): boolean {
	if (resolve(a) === resolve(b)) return true
	try {
		const [first, second] = [statSync(a), statSync(b)]
		return first.dev === second.dev && first.ino === second.ino
	} catch {
		return false
	}
}

/** time in seconds, and one pending wake-up that a new request replaces */
export type Scheduler = {
	readonly now: number
	at(time: number, callback: () => void): void
	cancel(): void
}

/** a Document bound to its file: autosave, saving and disk merges, driven by Persistence's decisions */
export class DocumentFile {
	readonly document: Document
	/** the window shows these, as editmd's "Saved in a Different Encoding" sheet: a save changed the file's encoding */
	onNotice: ((notice: string) => void) | null = null
	/** the file was renamed or moved by another program and now lives at this path: the window retitles itself */
	onMoved: ((path: string) => void) | null = null
	#file: OpenTextFile
	/** a descriptor kept open on the file, so a rename or move can be followed (`#follow`) */
	#descriptor: number | null = null
	/** the path was seen gone once and is looked at again before the file is followed (`#follow`) */
	#moveSeen = false
	#persistence = new Persistence()
	#scheduler: Scheduler
	#onUpdate: () => void
	#authorOfChange: (path: string) => AgentAuthor | null

	/**
	 * `onUpdate` runs whenever the text or the label may have changed without an edit (timers, saves, merges).
	 * `authorOfChange` names the Agent an outside write is credited to (Claims, then running agent processes)
	 */
	constructor(
		opened: string | { file: OpenTextFile; document: Document },
		scheduler: Scheduler,
		onUpdate: () => void = () => {},
		authorOfChange: (path: string) => AgentAuthor | null = () => null
	) {
		this.#file = typeof opened === 'string' ? openTextFile(opened) : opened.file
		this.document = typeof opened === 'string' ? new Document(this.#file.text) : opened.document
		this.#scheduler = scheduler
		this.#onUpdate = onUpdate
		this.#authorOfChange = authorOfChange
		this.#hold()
		this.#handle({ type: 'autosaves', enabled: true })
	}

	/**
	 * keeps a descriptor open on the file as it is now; a safe save puts a new file in its place, so this runs again
	 * after every write
	 */
	#hold(): void {
		if (this.#descriptor !== null) closeSync(this.#descriptor)
		try {
			this.#descriptor = openSync(this.#file.path, 'r')
		} catch {
			this.#descriptor = null
		}
	}

	/** the held descriptor is the file at the path now */
	#holdsPath(): boolean {
		try {
			const [held, now] = [fstatSync(this.#descriptor!), statSync(this.#file.path)]
			return held.dev === now.dev && held.ino === now.ino
		} catch {
			return false
		}
	}

	/**
	 * where the file is now when its path is gone: NSDocument follows a file another program renames or moves
	 * (NSFilePresenter `presentedItemDidMove`); the open descriptor still names it, and `lsof` reads that name.
	 * a file that was deleted, not moved, has no name left, so the save writes it again at its path
	 */
	#follow(saving: boolean): void {
		if (this.#descriptor === null || existsSync(this.#file.path)) {
			this.#moveSeen = false
			// another program's atomic write put a new file at the path: hold that one, or a later rename goes unseen
			if (this.#descriptor !== null && !this.#holdsPath()) this.#hold()
			return
		}
		/**
		 * Emacs, and vim with `backupcopy=no`, save by renaming the file to a backup and then writing a new file at its
		 * path: the first time the path is seen gone, a disk check only looks again a moment later, and a save waits a
		 * moment first, so a new file at the path keeps the document where it is
		 */
		if (!saving && !this.#moveSeen) {
			this.#moveSeen = true
			setTimeout(() => {
				if (this.#moveSeen) this.#follow(true)
			}, MOVE_SETTLE_MS).unref()
			return
		}
		if (!this.#moveSeen) {
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, MOVE_SETTLE_MS)
			if (existsSync(this.#file.path)) return
		}
		this.#moveSeen = false
		let now: string | null = null
		try {
			const listed = execFileSync(
				'/usr/sbin/lsof',
				['-a', '-p', String(process.pid), '-d', String(this.#descriptor), '-Fn'],
				// with no locale (a Finder launch) lsof escapes a name's bytes outside ASCII
				{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: withUtf8Locale(process.env) }
			)
			now =
				listed
					.split('\n')
					.find((line) => line.startsWith('n'))
					?.slice(1) ?? null
		} catch {
			now = null
		}
		if (now === null || now === this.#file.path || !existsSync(now)) return
		this.#file = this.#file.movedTo(now)
		this.onMoved?.(now)
	}

	/**
	 * an untitled Document's first save (Save As): writes a new file at `path` and binds the same
	 * Document to it, so its undo history and highlights carry over. throws FileExistsError unless
	 * `replace`, so the caller can ask first
	 */
	static create(
		path: string,
		document: Document,
		scheduler: Scheduler,
		onUpdate?: () => void,
		authorOfChange?: (path: string) => AgentAuthor | null,
		options: { replace?: boolean } = {}
	): DocumentFile {
		const file = createTextFile(path, document.text, options)
		document.markSaved()
		const documentFile = new DocumentFile({ file, document }, scheduler, onUpdate, authorOfChange)
		documentFile.#reportSaved(null)
		return documentFile
	}

	/** what the window's save-status label shows right now */
	get label(): SaveLabel {
		return this.#persistence.label(this.#scheduler.now)
	}

	/** call after every edit to the Document */
	changed(): void {
		this.#handle({ type: 'changed', dirty: this.document.isDirty })
	}

	/** call when the file may have been written by someone else (a file watcher event) */
	diskChanged(): void {
		this.#handle({ type: 'diskChanged' })
	}

	get path(): string {
		return this.#file.path
	}

	/**
	 * File > Save: write the Document now, through the same save the autosave runs. returns the error that stopped
	 * it, null once written, so the window can present it as editmd's `save(_:)` does (Document.swift:168-178)
	 */
	save(): Error | null {
		return this.#save()
	}

	/**
	 * Save Anyway, for a file without write permission (`save` returned FileLockedError): written all the same, its mode
	 * kept, as editmd's NSDocument does once the user agrees to save the locked file
	 */
	saveAnyway(): Error | null {
		return this.#save(true)
	}

	/**
	 * File > Revert to Saved: unsaved edits are dropped for the text on disk. returns why when the file cannot be read
	 * now (gone, binary, an unknown encoding), the Document left as it was, so the window can present it as NSDocument
	 * presents a failed revert; null once reverted
	 */
	revert(): Error | null {
		let text: string
		try {
			text = this.#file.reread()
		} catch (error) {
			return error instanceof Error ? error : new Error(String(error))
		}
		this.document.reset(text)
		this.changed()
		return null
	}

	/**
	 * File > Save As: the Document now lives at `path`, in the same encoding and line endings.
	 * throws FileExistsError unless `replace`, so the caller can ask first
	 */
	saveAs(path: string, options: { replace?: boolean } = {}): void {
		// onto its own file, a save in place that merges first, as editmd's save treats it (Document.swift:108-111, 118);
		// the same file by a symlink, or in other case on a case-insensitive volume, too
		if (options.replace && isSameFile(path, this.#file.path)) {
			const error = this.#save()
			if (error) throw error
			return
		}
		try {
			this.#file = this.#file.saveAs(path, this.document.text, options)
		} catch (error) {
			// asking to replace is not a failed save, so only other errors say Not Saved
			if (!(error instanceof FileExistsError)) this.#reportSaved(messageOf(path, error))
			throw error
		}
		this.#hold()
		this.document.markSaved()
		this.#reportSaved(null)
		this.changed()
	}

	/**
	 * Save As is tracked like any save, as editmd's `.saveAsOperation` is: "Saved", or "Not Saved" with
	 * `error`. the write is synchronous, so started and finished go together after it
	 */
	#reportSaved(error: string | null): void {
		this.#handle({ type: 'saveStarted' })
		this.#handle({ type: 'saveFinished', error })
	}

	#handle(event: PersistenceEvent): void {
		this.#carryOut(this.#persistence.handle(event, this.#scheduler.now))
	}

	#carryOut(decision: Decision): void {
		if (decision.wake === null) this.#scheduler.cancel()
		else this.#scheduler.at(decision.wake, () => this.#handle({ type: 'tick' }))
		if (decision.checkDisk) this.#checkDisk()
		if (decision.save) this.#save()
		this.#onUpdate()
	}

	/** a disk check: anything newer on disk is merged in, then Persistence hears that the check finished */
	#checkDisk(): void {
		this.#mergeFromDisk(false)
		this.#handle({ type: 'diskChecked' })
		this.changed()
	}

	/**
	 * merges what the file holds when it is not what was last loaded or saved, as editmd's `mergeFromDisk` does
	 * (Document.swift:215-221). a file that cannot be read now (gone, binary, unknown encoding) is skipped, as
	 * editmd's `try?` read does (Document.swift:230)
	 */
	#mergeFromDisk(saving: boolean): void {
		this.#follow(saving)
		const read = () => {
			try {
				return this.#file.reread()
			} catch {
				return null
			}
		}
		let disk = read()
		// a change is merged only once two reads agree: a program writing in place can be caught half way
		if (disk !== null && disk !== this.document.baseline) {
			disk = stableRead(read, (ms) =>
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
			)
		}
		// the file as last loaded or saved (the watcher's event on this window's own save) changes nothing, and asking
		// who wrote it runs `ps` and `lsof` synchronously (host/agentProcesses.ts)
		if (disk !== null && disk !== this.document.baseline) {
			this.document.mergeFromDisk(disk, this.#authorOfChange(this.#file.path))
		}
	}

	/** the save the autosave and File > Save share: the error that stopped it, null once written */
	#save(anyway = false): Error | null {
		this.#handle({ type: 'saveStarted' })
		let notice: string | null
		try {
			notice = this.#writeMerging(anyway)
		} catch (error) {
			this.#handle({ type: 'saveFinished', error: messageOf(this.#file.path, error) })
			return error instanceof Error ? error : new Error(String(error))
		}
		this.document.markSaved()
		this.#handle({ type: 'saveFinished', error: null })
		if (notice) this.onNotice?.(notice)
		this.changed()
		return null
	}

	/**
	 * each attempt merges anything newer on disk first, credited like any outside write, then writes; a write that
	 * finds the file changed again in between starts over, as editmd's `saveOnce` does (Document.swift:88-95, 108-112)
	 */
	#writeMerging(anyway: boolean): string | null {
		for (let attempt = 1; ; attempt++) {
			this.#mergeFromDisk(true)
			try {
				const notice = this.#file.save(this.document.text, { anyway })
				this.#hold()
				return notice
			} catch (error) {
				if (!(error instanceof ChangedOnDiskError) || attempt === SAVE_ATTEMPTS) throw error
			}
		}
	}
}
