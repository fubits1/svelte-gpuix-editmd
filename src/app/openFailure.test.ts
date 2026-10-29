import { describe, expect, test } from 'vitest'
import { TextFileReadError } from '../core/textFile.ts'
import { openFailure } from './openFailure.ts'

/** an error as node:fs throws it, with its errno code */
function fsError(code: string): Error {
	return Object.assign(new Error(`${code}: open failed`), { code })
}

describe('openFailure', () => {
	test('a file TextFile refuses: its failure reason in the title, its recovery suggestion below', () => {
		expect(openFailure('photo.md', new TextFileReadError('binary'))).toEqual({
			title: 'The document “photo.md” could not be opened. It contains binary data, not text.',
			message: 'editmd opens markdown and other plain text files.'
		})
	})

	test('a missing file, in Foundation’s words for NSFileReadNoSuchFileError', () => {
		expect(openFailure('gone.md', fsError('ENOENT'))).toEqual({
			title: 'The document “gone.md” could not be opened. The file doesn’t exist.',
			message: ''
		})
	})

	test('a file it may not read, in Foundation’s words for NSFileReadNoPermissionError', () => {
		const expected = {
			title: 'The document “locked.md” could not be opened. You don’t have permission.',
			message:
				'To view or change permissions, select the item in the Finder and choose File > Get Info.'
		}
		expect(openFailure('locked.md', fsError('EACCES'))).toEqual(expected)
		expect(openFailure('locked.md', fsError('EPERM'))).toEqual(expected)
	})

	test('anything else, in NSDocument’s words for an unknown error', () => {
		expect(openFailure('folder.md', fsError('EISDIR'))).toEqual({
			title: 'The document “folder.md” couldn’t be opened because an unknown error occurred.',
			message: ''
		})
	})
})
