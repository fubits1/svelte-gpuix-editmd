import {
	accessSync,
	chmodSync,
	closeSync,
	constants,
	existsSync,
	lstatSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { TextFile } from '../core/textFile.ts'

/** the file changed on disk since it was last read; merge `reread()` in and save again */
export class ChangedOnDiskError extends Error {
	constructor(path: string) {
		super(`${path} changed on disk since it was last read`)
		this.name = 'ChangedOnDiskError'
	}
}

/**
 * the file has no write permission; the caller may offer to save it anyway, as editmd's NSDocument asks “The file is
 * locked. Do you want to save your changes to it anyway?”. carries `EACCES`, the error a refused write gives
 */
export class FileLockedError extends Error {
	readonly code = 'EACCES'
	constructor(path: string) {
		super(`${path} is locked`)
		this.name = 'FileLockedError'
	}
}

/** Save As named a file that exists; the caller asks before replacing it, as editmd's save panel does */
export class FileExistsError extends Error {
	constructor(path: string) {
		super(`${path} already exists`)
		this.name = 'FileExistsError'
	}
}

/**
 * `cp -p`'s copy of `from` over `to`, a file this process just made exclusively, with `from`'s attributes; false when
 * cp could not make it
 */
function copyWithAttributes(from: string, to: string): boolean {
	try {
		execFileSync('/bin/cp', ['-p', from, to], { stdio: 'ignore' })
		return existsSync(to) && !lstatSync(to).isSymbolicLink()
	} catch {
		return false
	}
}

/**
 * replaces `path` with `data` the way NSDocument's safe save does: a temporary file beside it,
 * given the file's permissions, renamed over it, so a failed or interrupted write never leaves
 * the file half written. a file the user may not write is refused first, as NSDocument refuses it:
 * a rename alone would replace a read-only file. a file that is gone is written anew with the
 * default permissions, as NSDocument writes it. a symlink is followed, so the file it points to is
 * saved and the link stays a link; the temporary file starts as `cp -p`'s copy of the file, which
 * carries its mode, extended attributes such as Finder tags, and ACLs, as NSDocument's safe save keeps
 * them (Node's copyFileSync drops extended attributes in every mode, measured; `cp -p` costs about 1ms). when `cp`
 * cannot make the copy, the save goes ahead without them
 */
function writeAtomically(path: string, data: Uint8Array, anyway = false): void {
	const exists = existsSync(path)
	const target = exists && lstatSync(path).isSymbolicLink() ? realpathSync(path) : path
	// saved anyway, the copy renamed over the file keeps its mode, as editmd's Save Anyway leaves a 444 file 444
	if (exists && !anyway) {
		try {
			accessSync(target, constants.W_OK)
		} catch {
			throw new FileLockedError(target)
		}
	}
	// a random name nobody could have prepared a link at, as NSDocument's `<name>.sb-<id>` (seen from swift)
	const temporary = join(
		dirname(target),
		`.${basename(target)}.${randomBytes(6).toString('hex')}.editmd-gpuix`
	)
	try {
		// made exclusively first (O_EXCL also refuses a link someone put there), which reports why a folder refuses it
		closeSync(openSync(temporary, 'wx', exists ? 0o600 : 0o666))
		const copied = exists && copyWithAttributes(target, temporary)
		const mode = exists ? statSync(target).mode & 0o7777 : 0
		// a locked file's copy carries its read-only mode: the owner may write it for the moment of the save
		if (anyway && copied) chmodSync(temporary, mode | 0o200)
		writeFileSync(temporary, data)
		// without the copy, or saved anyway, the file's own mode; a new file has the default the umask leaves (0o666)
		if (exists && (!copied || anyway)) chmodSync(temporary, mode)
		renameSync(temporary, target)
	} catch (error) {
		rmSync(temporary, { force: true })
		throw error
	}
}

/**
 * a file's bytes, only when it is a regular file: a FIFO or a device named like text would block the read for good,
 * and the window reads on its own thread
 */
function readRegularFile(path: string): Buffer {
	if (!statSync(path).isFile()) {
		throw Object.assign(new Error(`${path} is not a regular file`), { code: 'ENOTREG', path })
	}
	return readFileSync(path)
}

/** a text file on disk, read and written in its own encoding and line endings */
export type OpenTextFile = {
	readonly path: string
	readonly text: string
	/**
	 * writes `text`; throws ChangedOnDiskError instead of overwriting bytes someone else wrote.
	 * returns what to tell the user when the file had to change encoding to hold it, else null; throws FileLockedError for
	 * a file without write permission unless `anyway` is set
	 */
	save(text: string, options?: { anyway?: boolean }): string | null
	/** reads the file again and returns its text, which becomes what saves compare against */
	reread(): string
	/** writes `text` to `path` in this file's format and returns the file there (Save As); see `createTextFile` for `replace` */
	saveAs(path: string, text: string, options?: ReplaceOptions): OpenTextFile
	/** the same file, now at `path`, where another program renamed or moved it */
	movedTo(path: string): OpenTextFile
}

type ReplaceOptions = { replace?: boolean }

/**
 * writes a Save As target; throws FileExistsError for an existing file unless `replace` is set.
 * `wx` refuses an existing file in the same call that creates the new one, so nothing can slip in between;
 * a replaced file is swapped in atomically like any other save, so a failed write never leaves it half written
 */
function writeNewFile(path: string, file: TextFile, { replace = false }: ReplaceOptions): void {
	if (replace && existsSync(path)) return writeAtomically(path, file.data)
	try {
		writeFileSync(path, file.data, { flag: replace ? 'w' : 'wx' })
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
			throw new FileExistsError(path)
		}
		throw error
	}
}

function bindTextFile(path: string, initial: TextFile): OpenTextFile {
	let file = initial

	return {
		path,
		get text() {
			return file.text
		},
		save(text, { anyway = false } = {}) {
			// a file another program deleted has nothing to compare and is written again (Document.swift:159-161)
			if (existsSync(path) && !Buffer.from(file.data).equals(readRegularFile(path))) {
				throw new ChangedOnDiskError(path)
			}
			const next = file.replacingText(text)
			writeAtomically(path, next.data, anyway)
			const notice = next.conversionNotice(file)
			file = next
			return notice
		},
		reread() {
			file = TextFile.fromData(readRegularFile(path))
			return file.text
		},
		saveAs(newPath, text, options = {}) {
			const next = file.replacingText(text)
			writeNewFile(newPath, next, options)
			return bindTextFile(newPath, next)
		},
		movedTo(newPath) {
			return bindTextFile(newPath, file)
		}
	}
}

export function openTextFile(path: string): OpenTextFile {
	return bindTextFile(path, TextFile.fromData(readRegularFile(path)))
}

/**
 * an untitled Document's first save: writes `text` to a new file in the default format (UTF-8, LF)
 * and returns it open. throws FileExistsError for an existing file unless `replace` is set
 */
export function createTextFile(
	path: string,
	text: string,
	options: ReplaceOptions = {}
): OpenTextFile {
	const file = TextFile.fromText(text)
	writeNewFile(path, file, options)
	return bindTextFile(path, file)
}
