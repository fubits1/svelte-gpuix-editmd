import { describe, expect, test, vi } from 'vitest'
import { openWindow, selfOf, spawnDetached } from './windows.ts'

describe('openWindow', () => {
	test('starts another editor process the way this one started, with the file to open', () => {
		const spawn = vi.fn()
		const self = {
			execPath: '/usr/bin/node',
			execArgv: ['--conditions', 'custom-renderer'],
			entry: '/app/app.ts'
		}

		openWindow('/notes/other.md', spawn, self)
		openWindow(null, spawn, self)

		expect(spawn.mock.calls).toEqual([
			['/usr/bin/node', ['--conditions', 'custom-renderer', '/app/app.ts', '/notes/other.md']],
			['/usr/bin/node', ['--conditions', 'custom-renderer', '/app/app.ts']]
		])
	})

	// a window that cannot be started (the binary moved by an update, too many open files, a NUL in a path) must not end
	// this one, which may hold an untitled document's edits
	test('a new window that fails to start leaves this process running', async () => {
		expect(() => {
			spawnDetached('/nonexistent/editmd-gpuix', [])
			spawnDetached('/bin/echo', ['a\0b'])
		}).not.toThrow()
		await new Promise((done) => setTimeout(done, 200))
	})

	// Bun's compiled binary reports its own embedded entry as argv[1]: passing it on made every new window open the
	// bundle as its document
	test('a compiled binary starts itself with no entry, and a source run with its script', () => {
		expect([
			selfOf({ execPath: '/A/app', execArgv: [], argv: ['bun', '/$bunfs/root/app', '/n.md'] }),
			selfOf({ execPath: '/usr/bin/node', execArgv: ['-C', 'x'], argv: ['node', '/p/app.ts'] })
		]).toEqual([
			{ execPath: '/A/app', execArgv: [], entry: null },
			{ execPath: '/usr/bin/node', execArgv: ['-C', 'x'], entry: '/p/app.ts' }
		])
	})
})
