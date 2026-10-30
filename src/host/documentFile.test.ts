import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { Document } from '../core/document.ts'
import { labelDetail, labelText } from '../core/persistence.ts'
import { DocumentFile, type Scheduler } from './documentFile.ts'
import { FileExistsError, FileLockedError } from './files.ts'

const directory = mkdtempSync(join(tmpdir(), 'editmd-gpuix-document-file-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

/** a clock the test moves by hand; `wake` replaces any earlier request, like Persistence's decisions */
class ManualScheduler implements Scheduler {
	now = 0
	#wake: { at: number; callback: () => void } | null = null

	at(time: number, callback: () => void): void {
		this.#wake = { at: time, callback }
	}

	cancel(): void {
		this.#wake = null
	}

	advance(seconds: number): void {
		this.now += seconds
		const wake = this.#wake
		if (wake && wake.at <= this.now) {
			this.#wake = null
			wake.callback()
		}
	}
}

function fileWith(name: string, text: string): string {
	const path = join(directory, name)
	writeFileSync(path, text)
	return path
}

describe('DocumentFile', () => {
	test('an untitled Document’s first save keeps the Document, its undo history, and autosaves there', () => {
		const document = new Document('- [ ] a\n')
		document.toggleTask(3)
		const path = join(directory, 'first-save.md')
		const scheduler = new ManualScheduler()

		const documentFile = DocumentFile.create(path, document, scheduler)
		expect(documentFile.document).toBe(document)
		expect(readFileSync(path, 'utf8')).toBe('- [x] a\n')
		expect(document.isDirty).toBe(false)

		document.undo()
		documentFile.changed()
		scheduler.advance(1.1)
		expect(readFileSync(path, 'utf8')).toBe('- [ ] a\n')
	})

	test('a save that had to change the encoding tells the window once', () => {
		const path = join(directory, 'latin-notice.md')
		// "# Café\n" in Windows-1252
		writeFileSync(path, Buffer.from([0x23, 0x20, 0x43, 0x61, 0x66, 0xe9, 0x0a]))
		const notices: string[] = []
		const documentFile = new DocumentFile(path, new ManualScheduler())
		documentFile.onNotice = (notice) => notices.push(notice)

		documentFile.document.editBlock(0, '# Café 😀')
		documentFile.save()
		documentFile.document.editBlock(0, '# Café 😀 again')
		documentFile.save()

		expect(notices).toEqual([
			"The file was saved as UTF-8, because it now contains characters Windows-1252 can't represent."
		])
	})

	// File > Save on a file without write permission: editmd asks to save anyway, then writes it and keeps its mode
	test('a locked file’s save says it is locked, and saving anyway writes it and says Saved', () => {
		const path = fileWith('locked-save.md', '# Locked\n')
		chmodSync(path, 0o444)
		const documentFile = new DocumentFile(path, new ManualScheduler())
		documentFile.document.editBlock(0, '# Locked, edited')

		const refused = documentFile.save()
		const anyway = documentFile.saveAnyway()
		expect([
			refused instanceof FileLockedError,
			anyway,
			readFileSync(path, 'utf8'),
			labelText(documentFile.label)
		]).toEqual([true, null, '# Locked, edited\n', 'Saved'])
	})

	test('Save As says Saved like any save, and asking to replace leaves the label alone', () => {
		const created = DocumentFile.create(
			join(directory, 'labelled.md'),
			new Document('a\n'),
			new ManualScheduler()
		)
		expect(labelText(created.label)).toBe('Saved')

		const opened = new DocumentFile(fileWith('opened.md', 'b\n'), new ManualScheduler())
		const taken = fileWith('taken-target.md', 'theirs\n')
		expect(() => opened.saveAs(taken)).toThrow(FileExistsError)
		expect(labelText(opened.label)).toBe('')

		opened.saveAs(taken, { replace: true })
		expect(labelText(opened.label)).toBe('Saved')
	})

	// editmd's save treats a Save As onto the document's own file as a save in place, merging first
	// (Document.swift:108-111, 118)
	test('Save As onto its own file merges what is newer on disk first, as a save does', () => {
		const path = fileWith('save-as-self.md', '# A\n\nbody\n')
		const documentFile = new DocumentFile(path, new ManualScheduler())
		documentFile.document.editBlock(0, '# A, mine')
		writeFileSync(path, '# A\n\nbody\n\ntheirs\n')

		documentFile.saveAs(path, { replace: true })

		expect([readFileSync(path, 'utf8'), labelText(documentFile.label)]).toEqual([
			'# A, mine\n\nbody\n\ntheirs\n',
			'Saved'
		])
	})

	// the same file under another spelling: a symlink to it, or its name in other case on a case-insensitive volume
	test('Save As onto its own file by a symlink or in other case merges first too', () => {
		const results = ['link', 'case'].map((how) => {
			const path = fileWith(`self-${how}.md`, '# A\n\nbody\n')
			const documentFile = new DocumentFile(path, new ManualScheduler())
			documentFile.document.editBlock(0, '# A, mine')
			writeFileSync(path, '# A\n\nbody\n\ntheirs\n')
			let target = join(directory, `self-${how}-link.md`)
			if (how === 'link') symlinkSync(path, target)
			else target = join(directory, `SELF-${how.toUpperCase()}.md`)

			documentFile.saveAs(target, { replace: true })
			return readFileSync(path, 'utf8')
		})
		expect(results).toEqual(['# A, mine\n\nbody\n\ntheirs\n', '# A, mine\n\nbody\n\ntheirs\n'])
	})

	test('an edit is saved once the user pauses for a second', () => {
		const path = fileWith('idle.md', '# A\n\nbody\n')
		const scheduler = new ManualScheduler()
		const documentFile = new DocumentFile(path, scheduler)

		documentFile.document.editBlock(1, 'body, edited')
		documentFile.changed()
		scheduler.advance(0.5)
		expect(readFileSync(path, 'utf8')).toBe('# A\n\nbody\n')

		scheduler.advance(0.6)
		expect(readFileSync(path, 'utf8')).toBe('# A\n\nbody, edited\n')
		expect(documentFile.document.isDirty).toBe(false)
	})

	test('File > Save writes at once, and no autosave follows', () => {
		const path = fileWith('save.md', '# A\n\nbody\n')
		const scheduler = new ManualScheduler()
		const documentFile = new DocumentFile(path, scheduler)

		documentFile.document.editBlock(1, 'body, saved')
		documentFile.changed()
		documentFile.save()
		expect(readFileSync(path, 'utf8')).toBe('# A\n\nbody, saved\n')
		expect(documentFile.document.isDirty).toBe(false)

		writeFileSync(path, '# A\n\nbody, by someone else\n')
		scheduler.advance(1.1)
		expect(readFileSync(path, 'utf8')).toBe('# A\n\nbody, by someone else\n')
	})

	test('an outside write is merged with unsaved edits, and the merge is what gets saved', () => {
		const path = fileWith('outside.md', '# A\n\nmine\n\ntheirs\n')
		const scheduler = new ManualScheduler()
		const documentFile = new DocumentFile(path, scheduler)

		documentFile.document.editBlock(1, 'mine, edited')
		documentFile.changed()
		writeFileSync(path, '# A\n\nmine\n\ntheirs, edited by an agent\n')
		documentFile.diskChanged()

		expect(documentFile.document.text).toBe('# A\n\nmine, edited\n\ntheirs, edited by an agent\n')
		scheduler.advance(1.1)
		expect(readFileSync(path, 'utf8')).toBe('# A\n\nmine, edited\n\ntheirs, edited by an agent\n')
	})

	// editmd skips a file it cannot read on a disk change (`try?` in Document.swift:230) and goes on
	test('an outside write it cannot read (binary, or gone) is skipped, and later changes still merge', () => {
		const path = fileWith('unreadable.md', '# A\n\nbody\n')
		const documentFile = new DocumentFile(path, new ManualScheduler())

		writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x0d]))
		expect(() => documentFile.diskChanged()).not.toThrow()
		rmSync(path)
		expect(() => documentFile.diskChanged()).not.toThrow()
		expect(documentFile.document.text).toBe('# A\n\nbody\n')

		writeFileSync(path, '# A\n\nbody, back again\n')
		documentFile.diskChanged()
		expect(documentFile.document.text).toBe('# A\n\nbody, back again\n')
	})

	/**
	 * asking who wrote the file runs `ps` and `lsof` synchronously (host/agentProcesses.ts), so it must not happen
	 * for the watcher's event on the window's own save, which leaves the file as the Document's baseline
	 */
	test('a disk check that finds the file as last saved asks nobody who wrote it', () => {
		const path = fileWith('own-save.md', '# A\n\nbody\n')
		const scheduler = new ManualScheduler()
		const asked: string[] = []
		const documentFile = new DocumentFile(
			path,
			scheduler,
			() => {},
			(changedPath) => {
				asked.push(changedPath)
				return null
			}
		)

		documentFile.document.editBlock(1, 'body, mine')
		documentFile.changed()
		scheduler.advance(1.1)
		documentFile.diskChanged()
		documentFile.diskChanged()

		expect([readFileSync(path, 'utf8'), asked]).toEqual(['# A\n\nbody, mine\n', []])
	})

	test('an outside write is credited to whoever the attribution names for this file', () => {
		const path = fileWith('credited.md', '# A\n\nbody\n')
		const scheduler = new ManualScheduler()
		const claude = { id: 'abc', name: 'Claude · notes' }
		const asked: string[] = []
		const documentFile = new DocumentFile(
			path,
			scheduler,
			() => {},
			(changedPath) => {
				asked.push(changedPath)
				return claude
			}
		)

		writeFileSync(path, '# A\n\nbody, by claude\n')
		documentFile.diskChanged()

		expect(asked).toEqual([path])
		expect(documentFile.document.highlights.map(({ author }) => author)).toEqual([claude])
	})

	test('Save As writes the text to the new path in the same format, and later saves go there', () => {
		const path = fileWith('original.md', '# A\r\n\r\nbody\r\n')
		const copy = join(directory, 'copy.md')
		const scheduler = new ManualScheduler()
		const documentFile = new DocumentFile(path, scheduler)

		documentFile.document.editBlock(1, 'body, edited')
		documentFile.saveAs(copy)
		expect(readFileSync(copy, 'utf8')).toBe('# A\r\n\r\nbody, edited\r\n')
		expect(documentFile.path).toBe(copy)

		documentFile.document.editBlock(1, 'body, edited again')
		documentFile.changed()
		scheduler.advance(1.1)
		expect(readFileSync(copy, 'utf8')).toBe('# A\r\n\r\nbody, edited again\r\n')
		expect(readFileSync(path, 'utf8')).toBe('# A\r\n\r\nbody\r\n')
	})

	test('Revert to Saved drops unsaved edits and shows what is on disk', () => {
		const path = fileWith('revert.md', '# A\n\nbody\n')
		const documentFile = new DocumentFile(path, new ManualScheduler())

		documentFile.document.editBlock(1, 'body, edited')
		documentFile.changed()
		writeFileSync(path, '# A\n\nbody, by an agent\n')
		documentFile.revert()

		expect(documentFile.document.text).toBe('# A\n\nbody, by an agent\n')
		expect(documentFile.document.isDirty).toBe(false)
	})

	test('a save that races an unreported outside write merges it and saves again', () => {
		const path = fileWith('race.md', '# A\n\nmine\n\ntheirs\n')
		const scheduler = new ManualScheduler()
		const documentFile = new DocumentFile(path, scheduler)

		documentFile.document.editBlock(1, 'mine, edited')
		documentFile.changed()
		writeFileSync(path, '# A\n\nmine\n\ntheirs, raced\n')
		scheduler.advance(1.1)

		expect(readFileSync(path, 'utf8')).toBe('# A\n\nmine, edited\n\ntheirs, raced\n')
		expect(documentFile.document.isDirty).toBe(false)
	})

	// editmd credits every disk merge, the one a save makes too (Document.swift:108-112, 218)
	test('the change a save merges in is credited like any outside write', () => {
		const path = fileWith('race-credited.md', '# A\n\nmine\n\ntheirs\n')
		const scheduler = new ManualScheduler()
		const codex = { id: 'xyz', name: 'Codex · notes' }
		const documentFile = new DocumentFile(
			path,
			scheduler,
			() => {},
			() => codex
		)

		documentFile.document.editBlock(1, 'mine, edited')
		documentFile.changed()
		writeFileSync(path, '# A\n\nmine\n\ntheirs, raced\n')
		scheduler.advance(1.1)

		expect(readFileSync(path, 'utf8')).toBe('# A\n\nmine, edited\n\ntheirs, raced\n')
		expect(documentFile.document.highlights.map(({ author }) => author)).toEqual([codex])
	})

	test('a failed save shows Not Saved with the reason, and the next edit tries again', () => {
		const path = fileWith('readonly.md', 'text\n')
		const scheduler = new ManualScheduler()
		const documentFile = new DocumentFile(path, scheduler)
		chmodSync(path, 0o444)

		documentFile.document.editBlock(0, 'text, edited')
		documentFile.changed()
		scheduler.advance(1.1)

		expect(documentFile.label.kind).toBe('failed')
		// editmd's tooltip is the save error's localizedDescription, Foundation's Err513.df for a write refused
		expect(labelDetail(documentFile.label)).toBe(
			`You don’t have permission to save the file “readonly.md” in the folder “${basename(directory)}”.`
		)

		chmodSync(path, 0o644)
		// Persistence retries only for a change made after the failure, never at the same instant
		scheduler.advance(0.5)
		documentFile.document.editBlock(0, 'text, edited again')
		documentFile.changed()
		scheduler.advance(1.1)

		expect(readFileSync(path, 'utf8')).toBe('text, edited again\n')
		expect(documentFile.label.kind).toBe('saved')
	})

	// editmd tries a save 3 times when the file keeps changing under it, merging what is on disk before each attempt,
	// then reports it failed (Document.swift:88-95, 108-112, 152-154)
	test('a file that changes under every save attempt is tried 3 times, then the save fails', () => {
		const path = fileWith('keeps-changing.md', '# A\n\nbody\n')
		let outsideWrites = 0
		// each merge between attempts asks who wrote the change; writing again there makes the next attempt find new bytes
		const documentFile = new DocumentFile(
			path,
			new ManualScheduler(),
			() => {},
			() => {
				outsideWrites++
				writeFileSync(path, `# A\n\nbody, outside write ${outsideWrites}\n`)
				return null
			}
		)

		writeFileSync(path, '# A\n\nbody, outside write 0\n')
		documentFile.document.editBlock(0, '# A, mine')
		const error = documentFile.save()

		expect([outsideWrites, error?.name, documentFile.label.kind]).toEqual([
			3,
			'ChangedOnDiskError',
			'failed'
		])
	})

	// NSDocument follows its file when another program renames or moves it (NSFilePresenter `presentedItemDidMove`),
	// so the next save goes to the new place and nothing reappears at the old one
	test('a file another program renames or moves is followed: saves go to its new place', () => {
		const path = fileWith('before-rename.md', 'text\n')
		const renamed = join(directory, 'after-rename.md')
		const elsewhere = join(mkdtempSync(join(directory, 'moved-')), 'moved.md')
		const scheduler = new ManualScheduler()
		const moves: string[] = []
		const documentFile = new DocumentFile(path, scheduler)
		documentFile.onMoved = (to) => moves.push(to)

		renameSync(path, renamed)
		documentFile.diskChanged()
		documentFile.document.editBlock(0, 'text, edited')
		documentFile.changed()
		scheduler.advance(1.1)
		renameSync(renamed, elsewhere)
		documentFile.diskChanged()
		documentFile.document.editBlock(0, 'text, edited again')
		documentFile.save()

		expect([
			existsSync(path),
			existsSync(renamed),
			existsSync(elsewhere) ? readFileSync(elsewhere, 'utf8') : null,
			documentFile.path,
			moves.map((to) => basename(to))
		]).toEqual([
			false,
			false,
			'text, edited again\n',
			realpathSync(elsewhere),
			['after-rename.md', 'moved.md']
		])
	})

	/**
	 * Emacs, and vim with `backupcopy=no`, save by renaming the file to a backup and writing a new one in its place: a
	 * disk check between the two steps must not take the backup for the document's new home
	 */
	test('a rename to a backup followed by a new file at the path is not followed', () => {
		const path = fileWith('Notes.md', 'one\n\ntwo\n')
		const backup = `${path}~`
		const documentFile = new DocumentFile(path, new ManualScheduler())
		const moves: string[] = []
		documentFile.onMoved = (to) => moves.push(to)

		renameSync(path, backup)
		documentFile.diskChanged()
		writeFileSync(path, 'one\n\ntwo AGENT\n')
		documentFile.diskChanged()
		documentFile.document.editBlock(0, 'one USER')
		documentFile.changed()
		documentFile.save()

		expect([
			documentFile.path,
			readFileSync(path, 'utf8'),
			readFileSync(backup, 'utf8'),
			moves
		]).toEqual([path, 'one USER\n\ntwo AGENT\n', 'one\n\ntwo\n', []])
	})

	// after an outside atomic write the held descriptor must move to the new inode, or a later rename goes unfollowed
	// and the next save writes the old path anew: two files
	test('a rename after another program’s atomic write is followed', async () => {
		const path = fileWith('atomic-then-rename.md', 'one\n')
		const renamed = join(directory, 'atomic-then-renamed.md')
		const documentFile = new DocumentFile(path, new ManualScheduler())
		writeFileSync(`${path}.tmp`, 'one, theirs\n')
		renameSync(`${path}.tmp`, path)
		documentFile.diskChanged()

		renameSync(path, renamed)
		documentFile.diskChanged()
		await new Promise((done) => setTimeout(done, 400))
		documentFile.document.editBlock(0, 'one, theirs, mine')
		documentFile.save()

		expect([existsSync(path), readFileSync(renamed, 'utf8'), documentFile.path]).toEqual([
			false,
			'one, theirs, mine\n',
			realpathSync(renamed)
		])
	})

	// with no save to come, a rename still retitles the window soon after, as NSDocument's does
	test('a rename with no edit to save is followed a moment later', async () => {
		const path = fileWith('quiet-before.md', 'text\n')
		const renamed = join(directory, 'quiet-after.md')
		const documentFile = new DocumentFile(path, new ManualScheduler())
		const moves: string[] = []
		documentFile.onMoved = (to) => moves.push(basename(to))

		renameSync(path, renamed)
		documentFile.diskChanged()
		const before = [...moves]
		await new Promise((done) => setTimeout(done, 600))

		expect([before, moves]).toEqual([[], ['quiet-after.md']])
	})

	// an app started from Finder has no LANG, and lsof then escapes a name's bytes outside ASCII
	test('a file renamed to a name outside ASCII is followed with no locale set, as from Finder', () => {
		const saved = {
			LANG: process.env.LANG,
			LC_ALL: process.env.LC_ALL,
			LC_CTYPE: process.env.LC_CTYPE
		}
		delete process.env.LANG
		delete process.env.LC_ALL
		delete process.env.LC_CTYPE
		try {
			const path = fileWith('Notizen ü.md', 'text\n')
			const renamed = join(directory, 'Übersicht – 日本.md')
			const documentFile = new DocumentFile(path, new ManualScheduler())
			renameSync(path, renamed)
			documentFile.diskChanged()
			documentFile.document.editBlock(0, 'text, edited')
			documentFile.save()
			expect([existsSync(path), readFileSync(renamed, 'utf8')]).toEqual([false, 'text, edited\n'])
		} finally {
			for (const [key, value] of Object.entries(saved)) {
				if (value !== undefined) process.env[key] = value
			}
		}
	})

	// NSDocument presents the error when a revert cannot read the file; the window then shows it, and nothing changes
	test('Revert to Saved of a file that is gone or binary returns why and leaves the Document as it was', () => {
		const gone = fileWith('revert-gone.md', 'text\n')
		const binary = fileWith('revert-binary.md', 'text\n')
		const first = new DocumentFile(gone, new ManualScheduler())
		const second = new DocumentFile(binary, new ManualScheduler())
		first.document.editBlock(0, 'mine')
		second.document.editBlock(0, 'mine')
		rmSync(gone)
		writeFileSync(binary, Buffer.from([0, 1, 2, 0xff]))

		const errors = [first.revert(), second.revert()]
		expect([
			errors.map((error) => error instanceof Error),
			first.document.text,
			second.document.text
		]).toEqual([[true, true], 'mine\n', 'mine\n'])
	})

	// editmd's save reads the file with `try?` and writes when there is nothing to read, so NSDocument puts a file
	// another program deleted back (Document.swift:111, 159-161, 216)
	test('a file another program deleted is written again by the next save', () => {
		const path = fileWith('deleted.md', 'text\n')
		const scheduler = new ManualScheduler()
		const documentFile = new DocumentFile(path, scheduler)
		rmSync(path)

		documentFile.document.editBlock(0, 'text, edited')
		documentFile.changed()
		scheduler.advance(1.1)

		expect([readFileSync(path, 'utf8'), documentFile.label.kind]).toEqual([
			'text, edited\n',
			'saved'
		])
	})

	// File > Save presents its error as editmd's Document `save(_:)` does (Document.swift:168-178), so it hands it back
	test('File > Save returns the error that stopped it, and null once it writes', () => {
		const path = fileWith('save-error.md', 'text\n')
		const documentFile = new DocumentFile(path, new ManualScheduler())
		chmodSync(path, 0o444)

		documentFile.document.editBlock(0, 'text, edited')
		documentFile.changed()
		const failed = documentFile.save()
		chmodSync(path, 0o644)
		const saved = documentFile.save()

		expect([
			failed instanceof Error && 'code' in failed ? failed.code : failed,
			saved,
			readFileSync(path, 'utf8')
		]).toEqual(['EACCES', null, 'text, edited\n'])
	})
})
