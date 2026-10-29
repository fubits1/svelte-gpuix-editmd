import { describe, expect, test } from 'vitest'
import { parseLaunch } from './launch.ts'

describe('parseLaunch', () => {
	test('a file argument opens that file, resolved against the working directory', () => {
		expect(parseLaunch(['notes.md'], '/Users/me')).toEqual({
			kind: 'open',
			path: '/Users/me/notes.md',
			title: 'notes.md'
		})
	})

	test('no argument starts an untitled document', () => {
		expect(parseLaunch([], '/Users/me')).toEqual({ kind: 'untitled', title: 'Untitled' })
	})

	test('--report-edit runs the agent hook instead of opening a window', () => {
		expect(parseLaunch(['--report-edit'], '/Users/me')).toEqual({ kind: 'report-edit' })
	})

	// editmd main.swift:4 reads the flag only as the first argument; anywhere else the app starts as usual
	test('--report-edit after another argument opens the file as usual', () => {
		expect(parseLaunch(['notes.md', '--report-edit'], '/Users/me')).toEqual({
			kind: 'open',
			path: '/Users/me/notes.md',
			title: 'notes.md'
		})
	})

	// editmd `Headless.swift:20-40`: each mode takes exactly its arguments, else the app opens as usual
	test('--roundtrip, --normalize and --selftest take one file', () => {
		for (const mode of ['roundtrip', 'normalize', 'selftest'] as const) {
			expect(parseLaunch([`--${mode}`, 'notes.md'], '/Users/me')).toEqual({
				kind: mode,
				path: '/Users/me/notes.md'
			})
		}
	})

	test('--snapshot takes a file and an output, with --dark and --width N (860 by default)', () => {
		expect(parseLaunch(['--snapshot', 'notes.md', 'out.png'], '/Users/me')).toEqual({
			kind: 'snapshot',
			path: '/Users/me/notes.md',
			out: '/Users/me/out.png',
			dark: false,
			width: 860
		})
		expect(
			parseLaunch(['--snapshot', 'notes.md', 'out.png', '--width', '500', '--dark'], '/Users/me')
		).toMatchObject({ dark: true, width: 500 })
	})
})
