import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { describeFile, isImageName, isTextName } from './fileKinds.ts'

const folder = mkdtempSync(join(tmpdir(), 'editmd-gpuix-file-kinds-'))
afterAll(() => rmSync(folder, { recursive: true, force: true }))

const file = (name: string) => {
	const path = join(folder, name)
	writeFileSync(path, 'x')
	return path
}

// editmd asks macOS for a linked file's type and whether it conforms to public.text (LinkPolicy.swift:36-44, 69-75),
// and for a dropped file's type by its extension and whether it conforms to public.image (ImageLink.swift:20)
describe('fileKinds', () => {
	test('a file on disk is text when its type conforms to public.text, source code included', () => {
		expect(
			['a.php', 'b.sql', 'c.m', 'd.md', 'e.txt', 'f.png', 'g.zip', 'noext'].map((name) => [
				name,
				describeFile(file(name))?.isText
			])
		).toEqual([
			['a.php', true],
			['b.sql', true],
			['c.m', true],
			['d.md', true],
			['e.txt', true],
			['f.png', false],
			['g.zip', false],
			['noext', false]
		])
	})

	test('a folder, a bundle, and a link named like text that points at a bundle are directories', () => {
		mkdirSync(join(folder, 'Thing.app'))
		symlinkSync(join(folder, 'Thing.app'), join(folder, 'notes.md'))
		expect(
			[join(folder, 'Thing.app'), join(folder, 'notes.md'), folder].map(
				(path) => describeFile(path)?.isDirectory
			)
		).toEqual([true, true, true])
	})

	// editmd's Info.plist declares net.daringfireball.markdown with these extensions (Info.plist:85-110), so inside
	// editmd they are markdown, which conforms to public.plain-text; macOS alone gives them a dynamic type
	test('every extension editmd declares as markdown is text, on disk and by name', () => {
		const names = ['a.md', 'b.markdown', 'c.mdown', 'd.mkd', 'e.MKDN']
		expect([
			names.map((name) => describeFile(file(name))?.isText),
			names.map((name) => isTextName(`/x/missing-${name}`))
		]).toEqual([
			[true, true, true, true, true],
			[true, true, true, true, true]
		])
	})

	// a link named `.md` to a FIFO, a device or a program is not markdown by its own name; editmd
	// reads the type of what it points to and reveals all three (named-pipe, character-special, unix-executable)
	test('a link named like markdown is judged by what it points to', () => {
		const fifo = join(folder, 'target-pipe')
		execFileSync('/usr/bin/mkfifo', [fifo])
		const links = [
			[fifo, 'fifo.md'],
			['/dev/zero', 'zero.md'],
			['/bin/ls', 'tool.md']
		].map(([target, name]) => {
			const link = join(folder, name!)
			symlinkSync(target!, link)
			return link
		})
		expect(links.map((link) => describeFile(link)?.isText)).toEqual([false, false, false])
	})

	test('nothing on disk is null, so the link is judged by its name', () => {
		expect(describeFile(join(folder, 'missing.sql'))).toBeNull()
	})

	test('by name: text and image types from the extension, as UTType(filenameExtension:)', () => {
		expect([
			isTextName('/x/missing.sql'),
			isTextName('/x/missing.pdf'),
			isTextName('/x/noext'),
			isImageName('/x/photo.heic'),
			isImageName('/x/photo.PNG'),
			isImageName('/x/notes.md')
		]).toEqual([true, false, false, true, true, false])
	})
})
