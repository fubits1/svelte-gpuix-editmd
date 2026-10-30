import { describe, expect, test } from 'vitest'
import { parseBlocks } from '../engine/blocks.ts'
import { linkDestination } from './linkDestination.ts'

const text = "# What's new\n\nSee [it](#whats-new), a note[^n].\n\n## Café\n\n[^N]: The note.\n"
const blocks = parseBlocks(text)

describe('linkDestination', () => {
	test('a #fragment scrolls to the heading with that GitHub anchor, percent-decoded or not', () => {
		expect(linkDestination('#whats-new', blocks, null)).toEqual({ kind: 'block', index: 0 })
		expect(linkDestination('#caf%C3%A9', blocks, null)).toEqual({ kind: 'block', index: 2 })
		expect(linkDestination('#Café', blocks, null)).toEqual({ kind: 'block', index: 2 })
	})

	// editmd's page takes every h1-h6 as a target (main.ts:39), those inside quotes and lists too
	test('a #fragment finds a heading inside a quote or a list, in the Block that holds it', () => {
		const nested = parseBlocks('intro\n\n> ## Quoted\n\n- item\n\n  ### Listed\n\n## Quoted\n')
		expect([
			linkDestination('#quoted', nested, null),
			linkDestination('#listed', nested, null),
			linkDestination('#quoted-1', nested, null)
		]).toEqual([
			{ kind: 'block', index: 1 },
			{ kind: 'block', index: 2 },
			{ kind: 'block', index: 3 }
		])
	})

	test('a link to nothing in the Document does nothing', () => {
		expect(linkDestination('#missing', blocks, null)).toEqual({ kind: 'none' })
	})

	// a document can spell a link any way; a broken percent-escape is matched as written, as editmd's findHeading does
	test('a footnote link with a broken percent-escape throws nothing', () => {
		expect(linkDestination('footnote:%E0%A4%A', blocks, null)).toEqual({ kind: 'none' })
	})

	// in an untitled document editmd resolves a relative link against its page (`editmd:`, main.ts:44), which its
	// LinkPolicy ignores ("a relative link in a document with no folder", LinkPolicy.swift:17-18) with a beep
	test('other links resolve against the folder, and relative ones are ignored in an untitled Document', () => {
		expect(linkDestination('other notes.md', blocks, '/Users/me/My Notes')).toEqual({
			kind: 'url',
			href: 'file:///Users/me/My%20Notes/other%20notes.md'
		})
		expect(linkDestination('https://example.com/a', blocks, null)).toEqual({
			kind: 'url',
			href: 'https://example.com/a'
		})
		expect(linkDestination('other.md', blocks, null)).toEqual({ kind: 'ignore' })
	})

	// editmd's page keeps a link's href only for these schemes (Milkdown's sanitizeLinkHref), so ⌘-clicking any other
	// link does nothing there: measured in editmd's window, obsidian:, file: and sms: links paint with an empty href
	test('a link of a scheme other than http, https, mailto, tel or ftp does nothing, as in editmd', () => {
		for (const href of [
			'obsidian://open?vault=a',
			'x-custom://do',
			'file:///tmp/a.md',
			'sms:+4930',
			' java\tscript:x'
		])
			expect(linkDestination(href, blocks, '/tmp')).toEqual({ kind: 'none' })
		for (const href of ['tel:+4930', 'ftp://example.com/a', 'MAILTO:a@b.example'])
			expect(linkDestination(href, blocks, '/tmp')).toEqual({
				kind: 'url',
				href: new URL(href).href
			})
	})
})
