import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { RecentFiles } from './recent.ts'

const directory = mkdtempSync(join(tmpdir(), 'editmd-gpuix-recent-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

describe('RecentFiles', () => {
	test('newest first, no duplicates, at most ten, kept across instances', () => {
		const store = join(directory, 'recent.json')
		const recent = new RecentFiles(store)
		const note = (number: number) => join(directory, `${number}.md`)
		for (let i = 1; i <= 12; i++) {
			writeFileSync(note(i), '')
			recent.add(note(i))
		}
		recent.add(note(5))

		const reopened = new RecentFiles(store)
		expect(reopened.list()).toEqual([5, 12, 11, 10, 9, 8, 7, 6, 4, 3].map(note))
	})

	// NSDocumentController leaves a deleted file out of its recent documents (run in Swift: noted, deleted, gone from
	// `recentDocumentURLs`)
	test('a file that no longer exists is left out', () => {
		const recent = new RecentFiles(join(directory, 'deleted.json'))
		const kept = join(directory, 'kept.md')
		const gone = join(directory, 'gone.md')
		writeFileSync(kept, '')
		writeFileSync(gone, '')
		recent.add(kept)
		recent.add(gone)
		rmSync(gone)
		expect(recent.list()).toEqual([kept])
	})

	// every window is its own process: one reading the store while another writes must never find it cut short, and
	// read as empty, so the store is replaced whole, never rewritten in place
	test('the store is replaced whole by each write, never written in place', () => {
		const store = join(directory, 'whole.json')
		const recent = new RecentFiles(store)
		recent.add('/a.md')
		const before = statSync(store).ino
		recent.add('/b.md')

		expect([
			statSync(store).ino === before,
			readdirSync(directory).filter((name) => name.includes('whole'))
		]).toEqual([false, ['whole.json']])
	})

	// an Open or Save As must not fail because the list cannot be kept
	test('a store that cannot be written is ignored', () => {
		const blocked = join(directory, 'recent-file-not-folder')
		writeFileSync(blocked, '')
		expect(() => new RecentFiles(join(blocked, 'recent.json')).add('/a.md')).not.toThrow()
	})

	test('Clear Menu empties the list; a missing or broken store reads as empty', () => {
		const recent = new RecentFiles(join(directory, 'missing', 'recent.json'))
		expect(recent.list()).toEqual([])
		recent.add('/a.md')
		recent.clear()
		expect(recent.list()).toEqual([])
	})
})
