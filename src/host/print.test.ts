import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { describe, expect, test } from 'vitest'
import { printablePage, removePrintedPages, writePrintablePage } from './print.ts'

describe('print', () => {
	test('a printable page renders the document with its title and without front matter', () => {
		const page = printablePage('---\ntitle: A\n---\n\n# Heading\n\nSome **bold**.\n', 'notes.md')

		expect(page).toContain('<title>notes.md</title>')
		expect(page).toContain('<h1')
		expect(page).toContain('<strong>bold</strong>')
		expect(page).not.toContain('title: A')
	})

	// editmd prints its page, whose code is in `--font-mono: ui-monospace, "SF Mono", Menlo, monospace` (style.css:14)
	test('code prints in editmd’s mono stack, SF Mono before Menlo', () => {
		expect(printablePage('`x`\n', 'x.md')).toContain(
			'pre,code{font-family:ui-monospace,"SF Mono",Menlo,monospace}'
		)
	})

	// a markdown file can come from anywhere; editmd's page loads nothing and runs no script of the document's
	// (RemoteContentBlocker.swift, its page shows raw HTML as source, style.css:344-349), so the browser must not either
	test('raw HTML prints as its source text, never as live elements', () => {
		const page = printablePage(
			'<script>alert(1)</script>\n\nA <img src=x onerror=alert(2)> b\n\n<meta http-equiv="refresh" content="0;url=https://e.example">\n',
			'x.md'
		)
		expect([
			page.includes('<script>alert'),
			page.includes('<img src=x'),
			page.includes('<meta http-equiv="refresh"'),
			page.includes('&#60;script&#62;alert(1)&#60;/script&#62;') ||
				page.includes('&lt;script&gt;alert(1)&lt;/script&gt;')
		]).toEqual([false, false, false, true])
	})

	test('a link of another scheme prints as its text, and the page forbids scripts and remote loads', () => {
		const page = printablePage('[x](javascript:alert(3)) and [web](https://e.example)\n', 'x.md')
		expect([
			page.includes('javascript:'),
			page.includes('href="https://e.example"'),
			page.includes(
				`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: file:">`
			)
		]).toEqual([false, true, true])
	})

	// following a link must never launch an app (editmd LinkPolicy.swift:1-7): in the browser only web, mail and the
	// page's own anchors stay links, however the markdown spells them
	test('reference links, data, file and custom-scheme links print as their text; images keep no script source', () => {
		const page = printablePage(
			[
				'[ref][a] [data](data:text/html,hi) [app](file:///Applications/X.app) [chat](slack://open) [web][w] [top](#top)',
				'',
				'![pic][i]',
				'',
				'[a]: javascript:alert(1)',
				'[w]: https://e.example',
				'[i]: javascript:alert(2)',
				''
			].join('\n'),
			'x.md'
		)
		expect([
			page.includes('javascript:'),
			page.includes('data:text/html'),
			page.includes('file:///Applications'),
			page.includes('slack:'),
			page.includes('href="https://e.example"'),
			page.includes('href="#top"')
		]).toEqual([false, false, false, false, true, true])
	})

	// `//host/p.png` has no scheme, so it passed as a relative path, and a file:// page resolves it to
	// `file://host/…`, which the policy lets load
	test('an image from another host with no scheme prints as its alt text', () => {
		const page = printablePage('![pic](//evil.example/p.png)\n', 'x.md')
		expect([page.includes('evil.example'), page.includes('pic')]).toEqual([false, true])
	})

	// the same look however the link is spelled (inline in italics, by reference plain)
	test('a neutralised link prints in italics, inline or by reference', () => {
		const page = printablePage('[in](slack://a) [ref][r]\n\n[r]: slack://b\n', 'x.md')
		expect([page.includes('<em>in</em>'), page.includes('<em>ref</em>')]).toEqual([true, true])
	})

	// editmd's page shows no "Footnotes" heading; satteri marks it sr-only, which the page must hide
	test('the footnotes section heading is hidden, as a screen-reader-only label', () => {
		const page = printablePage('a[^1]\n\n[^1]: note\n', 'x.md')
		expect([page.includes('class="sr-only"'), page.includes('.sr-only{')]).toEqual([true, true])
	})

	// the page lives in a temporary folder, so a README's `![shot](img/shot.png)` printed broken
	test('relative images resolve against the document’s folder, and an untitled page has no base', () => {
		const page = printablePage('![shot](img/shot.png)\n', 'README.md', '/Users/me/My Notes')
		expect([
			page.includes('<base href="file:///Users/me/My%20Notes/">'),
			printablePage('# Hi\n', 'Untitled').includes('<base')
		]).toEqual([true, false])
	})

	// a file name may hold 255 bytes; a long title with `.html` after it must not make the export fail
	test('a title too long for a file name still writes the page', () => {
		const path = writePrintablePage('# Hi\n', `${'ü'.repeat(200)}.md`)
		expect([
			path.endsWith('.html'),
			Buffer.byteLength(path.slice(path.lastIndexOf('/') + 1)) <= 255
		]).toEqual([true, true])
		rmSync(path)
	})

	// the page holds the whole document; it goes when this window ends, by when the browser has loaded it
	test('the pages this process wrote are removed by removePrintedPages', () => {
		const path = writePrintablePage('# secret\n', 'gone.md')
		removePrintedPages()
		expect([existsSync(path), existsSync(dirname(path))]).toEqual([false, false])
	})

	test('the page is written to a temporary file that can be handed to the browser', () => {
		const path = writePrintablePage('# Hi\n', 'hi.md')

		expect(path.endsWith('.html')).toBe(true)
		expect(readFileSync(path, 'utf8')).toContain('Hi')
		rmSync(path)
	})
})
