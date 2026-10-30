import { execFileSync } from 'node:child_process'
import {
	chmodSync,
	closeSync,
	lstatSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import fc from 'fast-check'
import { afterAll, describe, expect, test } from 'vitest'
import {
	ChangedOnDiskError,
	createTextFile,
	FileExistsError,
	FileLockedError,
	openTextFile
} from './files.ts'

const directory = mkdtempSync(join(tmpdir(), 'editmd-gpuix-files-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

describe('openTextFile', () => {
	test('saving untouched text writes the original bytes back, CRLF and BOM included', () => {
		const path = join(directory, 'crlf.md')
		const original = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('# A\r\n\r\nbody\r\n')])
		writeFileSync(path, original)

		const file = openTextFile(path)
		expect(file.text).toBe('# A\n\nbody\n')

		file.save(file.text)
		expect(readFileSync(path).equals(original)).toBe(true)
	})

	// the safe save replaces the file's contents, not what the user arranged around it
	test('a save through a symlink writes the file it points to and leaves the link a link', () => {
		const target = join(directory, 'target.md')
		const link = join(directory, 'link.md')
		writeFileSync(target, 'before\n')
		symlinkSync(target, link)

		openTextFile(link).save('after\n')
		expect([lstatSync(link).isSymbolicLink(), readFileSync(target, 'utf8')]).toEqual([
			true,
			'after\n'
		])
	})

	test('a save keeps the file’s extended attributes, such as Finder tags', () => {
		const path = join(directory, 'tagged.md')
		writeFileSync(path, 'before\n')
		execFileSync('xattr', ['-w', 'com.editmd-gpuix.test', 'kept', path])

		openTextFile(path).save('after\n')
		expect(
			execFileSync('xattr', ['-p', 'com.editmd-gpuix.test', path], { encoding: 'utf8' }).trim()
		).toBe('kept')
	})

	test('saving over a change someone else wrote is refused and leaves their bytes', () => {
		const path = join(directory, 'raced.md')
		writeFileSync(path, 'mine\n')
		const file = openTextFile(path)
		writeFileSync(path, 'theirs\n')

		expect(() => file.save('mine, edited\n')).toThrow(ChangedOnDiskError)
		expect(readFileSync(path, 'utf8')).toBe('theirs\n')
	})

	test('a save the old encoding cannot hold switches to UTF-8 and says so, once', () => {
		const path = join(directory, 'latin.md')
		// "# Café\r\n" in Windows-1252
		writeFileSync(path, Buffer.from([0x23, 0x20, 0x43, 0x61, 0x66, 0xe9, 0x0d, 0x0a]))
		const file = openTextFile(path)

		expect(file.save('# Café 😀\n')).toBe(
			"The file was saved as UTF-8, because it now contains characters Windows-1252 can't represent."
		)
		expect(readFileSync(path, 'utf8')).toBe('# Café 😀\r\n')
		expect(file.save('# Café 😀 again\n')).toBeNull()
	})

	// a FIFO (or a device) named like text would block the read for good and freeze the window; the read runs
	// in a child process, since a blocked read would stop this test too
	test('opening a FIFO or a device as a document throws at once', () => {
		const fifo = join(directory, 'pipe.md')
		execFileSync('/usr/bin/mkfifo', [fifo])
		const module = pathToFileURL(join(import.meta.dirname, 'files.ts')).href
		const script = `const { openTextFile } = await import(${JSON.stringify(module)}); console.log(JSON.stringify([${JSON.stringify(fifo)}, '/dev/zero'].map((path) => { try { openTextFile(path); return 'opened' } catch (error) { return 'refused' } })))`

		const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
			encoding: 'utf8',
			timeout: 5000
		})

		expect(JSON.parse(out)).toEqual(['refused', 'refused'])
	})

	// a symlink planted at a predictable copy name (`.<name>.<pid>.editmd-gpuix`) must not make the save
	// overwrite the file it points to
	test('a save never writes through a link someone planted where its copy could go', () => {
		const folder = mkdtempSync(join(directory, 'planted-'))
		const path = join(folder, 'doc.md')
		const victim = join(folder, 'victim.txt')
		writeFileSync(path, 'before\n')
		writeFileSync(victim, 'victim\n')
		symlinkSync(victim, join(folder, `.doc.md.${process.pid}.editmd-gpuix`))
		const file = openTextFile(path)

		file.save('after\n')

		expect([
			readFileSync(victim, 'utf8'),
			readFileSync(path, 'utf8'),
			lstatSync(path).isSymbolicLink()
		]).toEqual(['victim\n', 'after\n', false])
	})

	test('a save replaces the file atomically, as NSDocument does: a folder that refuses new files fails it and leaves the file', () => {
		const folder = mkdtempSync(join(directory, 'locked-'))
		const path = join(folder, 'atomic.md')
		writeFileSync(path, 'before\n')
		const file = openTextFile(path)

		chmodSync(folder, 0o555)
		// the failure is the temporary file's: a new file beside the target, which the folder refuses
		let refusedPath = ''
		try {
			file.save('after\n')
		} catch (error) {
			refusedPath = error instanceof Error && 'path' in error ? String(error.path) : String(error)
		} finally {
			chmodSync(folder, 0o755)
		}
		expect([
			dirname(refusedPath),
			basename(refusedPath).startsWith('.atomic.md.'),
			readFileSync(path, 'utf8')
		]).toEqual([folder, true, 'before\n'])
		file.save('after\n')
		expect(readFileSync(path, 'utf8')).toBe('after\n')
		expect(readdirSync(folder)).toEqual(['atomic.md'])
	})

	test('a save renames a new file over the old one: a new inode with the old mode, the old one left whole, no temporary file', () => {
		const folder = mkdtempSync(join(directory, 'renamed-'))
		const path = join(folder, 'renamed.md')
		writeFileSync(path, 'before\n')
		chmodSync(path, 0o640)
		const file = openTextFile(path)
		const inodeBefore = statSync(path).ino
		// a reader that opened the file before the save keeps the old one, whole
		const reader = openSync(path, 'r')

		file.save('after\n')

		expect([
			statSync(path).ino === inodeBefore,
			statSync(path).mode & 0o7777,
			readFileSync(path, 'utf8'),
			readFileSync(reader, 'utf8'),
			readdirSync(folder)
		]).toEqual([false, 0o640, 'after\n', 'before\n', ['renamed.md']])
		closeSync(reader)
	})

	test.each([
		// mixed line endings in each, so a save that re-encoded the text would change the bytes
		['UTF-8', Buffer.from('# Café\r\n\nbody\n', 'utf8')],
		[
			'UTF-8 with BOM',
			Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Café\r\n\nbody\n', 'utf8')])
		],
		[
			'UTF-16BE',
			Buffer.concat([
				Buffer.from([0xfe, 0xff]),
				Buffer.from('# Café\r\n\nbody\n', 'utf16le').swap16()
			])
		],
		[
			'UTF-16LE',
			Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('# Café\n\r\nbody\r\n', 'utf16le')])
		],
		['Windows-1252', Buffer.from([0x23, 0x20, 0x43, 0x61, 0x66, 0xe9, 0x0d, 0x0a, 0x62, 0x0a])]
	])('saving untouched %s text writes its bytes back to disk', (_name, original) => {
		const path = join(directory, 'untouched.md')
		writeFileSync(path, original)
		const file = openTextFile(path)
		const inodeBefore = statSync(path).ino

		file.save(file.text)
		// a new inode: the save really wrote, rather than skipping an untouched file
		expect([statSync(path).ino === inodeBefore, readFileSync(path).equals(original)]).toEqual([
			false,
			true
		])
	})

	test('a file the user may not write is refused, as NSDocument refuses it, and keeps its bytes', () => {
		const folder = mkdtempSync(join(directory, 'read-only-file-'))
		const path = join(folder, 'locked.md')
		writeFileSync(path, 'before\n')
		chmodSync(path, 0o444)
		const file = openTextFile(path)

		let refusal = ''
		try {
			file.save('after\n')
		} catch (error) {
			refusal = error instanceof Error && 'code' in error ? String(error.code) : String(error)
		}
		// refused for want of write permission, not for any other failure
		expect([refusal, readFileSync(path, 'utf8'), readdirSync(folder)]).toEqual([
			'EACCES',
			'before\n',
			['locked.md']
		])
	})

	// editmd's Save Anyway (measured in editmd's window): the edit is written and the file keeps its mode 444
	test('a file the user may not write is told locked, and saving it anyway writes it and keeps its mode', () => {
		const folder = mkdtempSync(join(directory, 'save-anyway-'))
		const path = join(folder, 'locked.md')
		writeFileSync(path, 'before\n')
		chmodSync(path, 0o444)
		const file = openTextFile(path)

		let locked = false
		try {
			file.save('after\n')
		} catch (error) {
			locked = error instanceof FileLockedError
		}
		file.save('after\n', { anyway: true })
		expect([
			locked,
			readFileSync(path, 'utf8'),
			statSync(path).mode & 0o777,
			readdirSync(folder)
		]).toEqual([true, 'after\n', 0o444, ['locked.md']])
	})

	test('after reading the change back in, the save goes through', () => {
		const path = join(directory, 'reread.md')
		writeFileSync(path, 'mine\n')
		const file = openTextFile(path)
		writeFileSync(path, 'theirs\n')

		expect(file.reread()).toBe('theirs\n')
		file.save('merged\n')
		expect(readFileSync(path, 'utf8')).toBe('merged\n')
	})
})

describe('createTextFile', () => {
	test('an untitled Document’s first save is UTF-8, so no later save, whatever its text, has to change the encoding', () => {
		const path = join(directory, 'untitled-property.md')
		fc.assert(
			fc.property(
				fc.string({ unit: 'grapheme' }),
				fc.string({ unit: 'grapheme' }),
				(first, later) => {
					rmSync(path, { force: true })
					const firstText = first.replaceAll('\r', '')
					const file = createTextFile(path, firstText)
					// the first save is plain UTF-8, no byte order mark
					expect(readFileSync(path).equals(Buffer.from(firstText, 'utf8'))).toBe(true)
					const edited = later.replaceAll('\r', '')
					expect([file.save(edited), readFileSync(path, 'utf8')]).toEqual([null, edited])
				}
			),
			{ numRuns: 200 }
		)
	})

	test('an untitled Document’s first save writes a new UTF-8 file that later saves go to', () => {
		const path = join(directory, 'new.md')

		const file = createTextFile(path, '# New\n')
		expect(readFileSync(path, 'utf8')).toBe('# New\n')

		file.save('# New, edited\n')
		expect(readFileSync(path, 'utf8')).toBe('# New, edited\n')
	})

	test('an existing file is replaced only when asked, as the save panel asks first', () => {
		const path = join(directory, 'taken.md')
		writeFileSync(path, 'someone else’s\n')

		expect(() => createTextFile(path, 'mine\n')).toThrow(FileExistsError)
		expect(readFileSync(path, 'utf8')).toBe('someone else’s\n')

		createTextFile(path, 'mine\n', { replace: true })
		expect(readFileSync(path, 'utf8')).toBe('mine\n')
	})

	test('Replace swaps the new file in atomically too: a new inode, the old one whole for a reader that had it open, no temporary file', () => {
		const folder = mkdtempSync(join(directory, 'replace-'))
		const source = join(folder, 'source.md')
		const target = join(folder, 'target.md')
		writeFileSync(source, 'mine\n')
		writeFileSync(target, 'theirs\n')
		const inodeBefore = statSync(target).ino
		const reader = openSync(target, 'r')

		openTextFile(source).saveAs(target, 'mine\n', { replace: true })

		expect([
			statSync(target).ino === inodeBefore,
			readFileSync(target, 'utf8'),
			readFileSync(reader, 'utf8'),
			readdirSync(folder).sort()
		]).toEqual([false, 'mine\n', 'theirs\n', ['source.md', 'target.md']])
		closeSync(reader)
	})

	test('Save As from an open file asks before replacing too', () => {
		const source = join(directory, 'source.md')
		const target = join(directory, 'target.md')
		writeFileSync(source, 'mine\n')
		writeFileSync(target, 'theirs\n')
		const file = openTextFile(source)

		expect(() => file.saveAs(target, 'mine\n')).toThrow(FileExistsError)
		expect(readFileSync(target, 'utf8')).toBe('theirs\n')

		file.saveAs(target, 'mine\n', { replace: true })
		expect(readFileSync(target, 'utf8')).toBe('mine\n')
	})
})
