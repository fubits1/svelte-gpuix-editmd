// `editmd:` is editmd's own page scheme: `editmd://file/<path>` is a file (EditorBridge.swift `AssetSchemeHandler.fileURL`), any other `editmd:` URL is ignored (LinkPolicyTests.swift)

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { describeOnDisk, linkAction, type LinkTarget } from './linkPolicy.ts'

const action = (href: string, target: LinkTarget | null = null) => linkAction(href, () => target)

describe('linkAction', () => {
	test('web and mail open normally', () => {
		for (const link of [
			'https://example.com/a?b#c',
			'http://example.com',
			'mailto:me@example.com',
			'HTTPS://EXAMPLE.COM'
		]) {
			expect(action(link)).toEqual({ kind: 'openExternally', url: link })
		}
	})

	test('other schemes ask first', () => {
		for (const link of [
			'ftp://example.com/x',
			'vnc://host',
			'x-apple.systempreferences:com.apple.preference',
			'ssh://host',
			'slack://open'
		]) {
			expect(action(link)).toEqual({ kind: 'confirm', url: link })
		}
	})

	test('page-internal URLs and relative links do nothing', () => {
		expect(action('about:blank')).toEqual({ kind: 'ignore' })
		expect(action('data:text/html,hi')).toEqual({ kind: 'ignore' })
		expect(action('javascript:alert(1)')).toEqual({ kind: 'ignore' })
		// editmd's own page scheme (LinkPolicy.swift:50-53): a link to it is ignored, not asked about
		expect(action('editmd://app/index.html')).toEqual({ kind: 'ignore' })
		expect(action('editmd://app/tools/x.app')).toEqual({ kind: 'ignore' })
		// editmd SelfTest.swift: `editmd://file/Applications/Calculator.app` reveals the app
		expect(
			action('editmd://file/Applications/Calculator.app', { isDirectory: true, isText: false })
		).toEqual({ kind: 'reveal', path: '/Applications/Calculator.app' })
		expect(action('editmd://file/tmp/my%20notes.md', { isDirectory: false, isText: true })).toEqual(
			{
				kind: 'openInEditor',
				path: '/tmp/my notes.md'
			}
		)
		expect(action('relative/path.md')).toEqual({ kind: 'ignore' })
	})

	test('text files open in the editor', () => {
		for (const name of [
			'notes.md',
			'notes.markdown',
			'readme.txt',
			'script.sh',
			'run.command',
			'page.html'
		]) {
			expect(action(`file:///tmp/${name}`)).toEqual({ kind: 'openInEditor', path: `/tmp/${name}` })
		}
	})

	test('other files are revealed, never launched', () => {
		for (const name of [
			'x.app',
			'x.pkg',
			'x.fileloc',
			'x.webloc',
			'x.inetloc',
			'x.workflow',
			'x.dmg',
			'x.png',
			'x'
		]) {
			expect(action(`file:///tmp/${name}`)).toEqual({ kind: 'reveal', path: `/tmp/${name}` })
		}
	})

	// the app judges a name by macOS's type for its extension (host/fileKinds.ts), as UTType(filenameExtension:)
	test('a file with nothing on disk is judged by the name test it is given', () => {
		const sqlIsText = (path: string) => path.endsWith('.sql')
		expect([
			linkAction('file:///tmp/missing.sql', () => null, sqlIsText),
			linkAction('file:///tmp/missing.md', () => null, sqlIsText)
		]).toEqual([
			{ kind: 'openInEditor', path: '/tmp/missing.sql' },
			{ kind: 'reveal', path: '/tmp/missing.md' }
		])
	})

	// a document can hold any link; editmd's URL parsing never throws on one (LinkPolicy.swift:58-67). Foundation's
	// `URL.path` leaves out a file URL's host and keeps a broken percent-escape as written (swift:
	// file://host/etc/hosts -> /etc/hosts, file:///%E0%A4%A.md -> /%E0%A4%A.md)
	test('a file link with a host names the local path, and a broken percent-escape stays as written', () => {
		expect(
			['file://host/x.md', 'file:///%E0%A4%A.md', 'editmd://file/%E0%A4%A'].map((href) =>
				linkAction(href, () => null)
			)
		).toEqual([
			{ kind: 'openInEditor', path: '/x.md' },
			{ kind: 'openInEditor', path: '/%E0%A4%A.md' },
			{ kind: 'ignore' }
		])
	})

	// Foundation's `URL.path` keeps `%00` and `%2F` as written (swift): a NUL would make no path, and a
	// decoded slash a different file
	test('a file link keeps an escaped NUL or slash as written', () => {
		expect(
			['file:///tmp/a%00b.md', 'file:///tmp/a%2Fb.md', 'file:///tmp/a%2fb%20c.md'].map((href) =>
				linkAction(href, () => null)
			)
		).toEqual([
			{ kind: 'openInEditor', path: '/tmp/a%00b.md' },
			{ kind: 'openInEditor', path: '/tmp/a%2Fb.md' },
			{ kind: 'openInEditor', path: '/tmp/a%2fb c.md' }
		])
	})

	test('folders and packages are revealed whatever their name', () => {
		const href = 'file:///tmp/looks-like.md'
		expect(action(href, { isDirectory: true, isText: false })).toEqual({
			kind: 'reveal',
			path: '/tmp/looks-like.md'
		})
		expect(action(href, { isDirectory: true, isText: true })).toEqual({
			kind: 'reveal',
			path: '/tmp/looks-like.md'
		})
		expect(action(href, { isDirectory: false, isText: false })).toEqual({
			kind: 'reveal',
			path: '/tmp/looks-like.md'
		})
		expect(action(href, { isDirectory: false, isText: true })).toEqual({
			kind: 'openInEditor',
			path: '/tmp/looks-like.md'
		})
	})
})

describe('describeOnDisk', () => {
	const directory = mkdtempSync(join(tmpdir(), 'editmd-gpuix-links-'))
	afterAll(() => rmSync(directory, { recursive: true, force: true }))

	test('follows symlinks', () => {
		mkdirSync(join(directory, 'Tool.app/Contents/MacOS'), { recursive: true })
		const note = join(directory, 'note.md')
		writeFileSync(note, '# hi\n')
		const disguised = join(directory, 'docs.md')
		symlinkSync(join(directory, 'Tool.app'), disguised)

		const href = (path: string) => pathToFileURL(path).href
		expect(linkAction(href(note))).toEqual({ kind: 'openInEditor', path: note })
		expect(linkAction(href(join(directory, 'Tool.app')))).toEqual({
			kind: 'reveal',
			path: join(directory, 'Tool.app')
		})
		expect(linkAction(href(disguised))).toEqual({ kind: 'reveal', path: disguised })
		expect(linkAction(href(directory))).toEqual({ kind: 'reveal', path: directory })
		expect(describeOnDisk(join(directory, 'missing.md'))).toBeNull()
	})
})
