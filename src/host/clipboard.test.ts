import { describe, expect, test } from 'vitest'
import {
	clipboardEnvironment,
	readClipboardUrl,
	writeClipboard,
	type WriteInput
} from './clipboard.ts'

describe('writeClipboard', () => {
	test('hands the text to pbcopy on its stdin, and says whether it worked', () => {
		const calls: [string, readonly string[], string][] = []
		const run: WriteInput = (file, args, input) => {
			calls.push([file, args, input])
		}

		expect([writeClipboard('**bold** text', run), calls]).toEqual([
			true,
			[['/usr/bin/pbcopy', [], '**bold** text']]
		])
		expect(
			writeClipboard('x', () => {
				throw new Error('pbcopy: not found')
			})
		).toBe(false)
	})
})

// pbcopy and pbpaste read and write in the locale's encoding, the C encoding when there is none (man pbcopy), and an
// app started from Finder has no LANG: their children always get a UTF-8 locale
describe('clipboardEnvironment', () => {
	test('gives pbcopy and pbpaste a UTF-8 locale whatever the app was started with', () => {
		expect([
			clipboardEnvironment({ PATH: '/usr/bin' }),
			clipboardEnvironment({ PATH: '/usr/bin', LANG: 'de_DE.ISO8859-1', LC_ALL: 'C' })
		]).toEqual([
			{ PATH: '/usr/bin', LC_ALL: 'en_US.UTF-8' },
			{ PATH: '/usr/bin', LANG: 'de_DE.ISO8859-1', LC_ALL: 'en_US.UTF-8' }
		])
	})
})

describe('readClipboardUrl', () => {
	test('reads the pasteboard with pbpaste and keeps a web or mail address, as editmd prefills Add Link', () => {
		const calls: [string, readonly string[]][] = []
		const url = readClipboardUrl((file, args) => {
			calls.push([file, args])
			return '  https://a.example/x\n'
		})

		expect(url).toBe('https://a.example/x')
		expect(calls).toEqual([['/usr/bin/pbpaste', []]])
	})

	test('other text, or a pbpaste that fails, prefills nothing', () => {
		expect(readClipboardUrl(() => 'just words')).toBeNull()
		expect(
			readClipboardUrl(() => {
				throw new Error('pbpaste: not found')
			})
		).toBeNull()
	})
})
