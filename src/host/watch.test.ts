import { mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { watchFile } from './watch.ts'

const directory = mkdtempSync(join(tmpdir(), 'editmd-gpuix-watch-'))
afterAll(() => rmSync(directory, { recursive: true, force: true }))

/**
 * macOS starts a folder watch's FSEvents stream asynchronously, so a write made right after
 * `watchFile` can land before the stream is live and is never reported; each poll writes again
 */
const WATCH_TIMEOUT = { timeout: 5000, interval: 50 }

describe('watchFile', () => {
	test('reports in-place writes and atomic replacements', async () => {
		const path = join(directory, 'watched.md')
		writeFileSync(path, 'a\n')
		const changed = vi.fn()
		const unwatch = watchFile(path, changed)

		await vi.waitFor(() => {
			writeFileSync(path, 'b\n')
			expect(changed).toHaveBeenCalled()
		}, WATCH_TIMEOUT)

		changed.mockClear()
		await vi.waitFor(() => {
			writeFileSync(join(directory, 'watched.md.tmp'), 'c\n')
			renameSync(join(directory, 'watched.md.tmp'), path)
			expect(changed).toHaveBeenCalled()
		}, WATCH_TIMEOUT)

		unwatch()
	})

	// a document opened through a symlink: its writes land in the target's folder
	test('reports writes to a symlink’s target in another folder', async () => {
		const real = mkdtempSync(join(directory, 'real-'))
		const links = mkdtempSync(join(directory, 'links-'))
		const target = join(real, 'target.md')
		writeFileSync(target, 'a\n')
		symlinkSync(target, join(links, 'doc.md'))
		// FSEvents also delivers the link's own creation, made just before the stream started: let it pass first
		await new Promise((done) => setTimeout(done, 1500))
		const changed = vi.fn()
		const unwatch = watchFile(join(links, 'doc.md'), changed)
		await new Promise((done) => setTimeout(done, 1500))
		changed.mockClear()

		await vi.waitFor(() => {
			writeFileSync(target, 'b\n')
			expect(changed).toHaveBeenCalled()
		}, WATCH_TIMEOUT)

		unwatch()
	}, 15_000)

	test('reports nothing for other files in the folder', async () => {
		const path = join(directory, 'quiet.md')
		const otherPath = join(directory, 'other.md')
		// never written: FSEvents also delivers writes made just before the stream started
		const changed = vi.fn()
		const sawOther = vi.fn()
		const unwatch = watchFile(path, changed)
		// a second watch on the other file proves its write was delivered before asserting the negative
		const unwatchOther = watchFile(otherPath, sawOther)

		await vi.waitFor(() => {
			writeFileSync(otherPath, 'x\n')
			expect(sawOther).toHaveBeenCalled()
		}, WATCH_TIMEOUT)
		expect(changed).not.toHaveBeenCalled()

		unwatchOther()
		unwatch()
	})
})
