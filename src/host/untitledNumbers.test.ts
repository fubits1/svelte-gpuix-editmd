import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { untitledName, UntitledNumbers } from './untitledNumbers.ts'

const root = mkdtempSync(join(tmpdir(), 'editmd-gpuix-untitled-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** a registry in a folder of its own, where the pids in `alive` are running */
const registry = (name: string, alive: Set<number>) =>
	new UntitledNumbers(join(root, name), (pid) => alive.has(pid))

// NSDocument, run in Swift: three open are Untitled, Untitled 2, Untitled 3; with the second closed the next is
// Untitled 4; with all closed the next is Untitled again. every window is its own process, so the folder is shared
describe('UntitledNumbers', () => {
	test('a new untitled window takes one past the highest number still open, from 1 when none is', () => {
		const alive = new Set([1, 2, 3, 4, 5])
		const numbers = registry('order', alive)
		const taken = [numbers.take(1), numbers.take(2), numbers.take(3)]
		numbers.release(2)
		taken.push(numbers.take(4))
		for (const pid of [1, 3, 4]) numbers.release(pid)
		taken.push(numbers.take(5))
		expect(taken).toEqual([1, 2, 3, 4, 1])
	})

	test('a number held by a process that is gone is free again', () => {
		const alive = new Set([1, 2])
		const numbers = registry('crashed', alive)
		numbers.take(1)
		numbers.take(2)
		alive.delete(2)
		expect(numbers.take(3)).toBe(2)
	})

	// signal 0 checks a process without touching it: a gone pid is free, another user's (launchd, pid 1) still runs
	test('by default a number counts as held while its process runs, by any user', () => {
		const folder = join(root, 'running')
		mkdirSync(folder)
		writeFileSync(join(folder, '1'), '1')
		writeFileSync(join(folder, '2'), '99999999')
		writeFileSync(join(folder, '3'), 'not a process')
		expect(new UntitledNumbers(folder).take(process.pid)).toBe(2)
	})

	// two windows opening at once: the other takes number 2 between this one's look and its write, so this takes 3
	test('a number another window takes meanwhile makes this one take the next', () => {
		const folder = join(root, 'race')
		mkdirSync(folder)
		writeFileSync(join(folder, '1'), '10')
		let raced = false
		const numbers = new UntitledNumbers(folder, (pid) => {
			if (!raced) {
				raced = true
				writeFileSync(join(folder, '2'), '30')
			}
			return pid === 10 || pid === 30
		})
		expect(numbers.take(20)).toBe(3)
	})

	// an Untitled window must open even when the support folder cannot be written
	test('a folder that refuses new files gives the first number', () => {
		const folder = join(root, 'read-only')
		mkdirSync(folder)
		chmodSync(folder, 0o500)
		try {
			expect(new UntitledNumbers(folder, () => true).take(1)).toBe(1)
		} finally {
			chmodSync(folder, 0o700)
		}
	})

	// an Untitled window must open even when the support folder cannot be written
	test('a folder that cannot be kept gives the first number', () => {
		const blocked = join(root, 'a-file')
		writeFileSync(blocked, '')
		expect(new UntitledNumbers(join(blocked, 'untitled')).take(1)).toBe(1)
	})

	test('the first is Untitled, the rest carry their number', () => {
		expect([untitledName(1), untitledName(2)]).toEqual(['Untitled', 'Untitled 2'])
	})
})
