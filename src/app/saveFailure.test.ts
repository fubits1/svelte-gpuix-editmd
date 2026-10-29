import { describe, expect, test } from 'vitest'
import { saveFailure } from './saveFailure.ts'

/** an error as node:fs throws it, with its errno code */
function fsError(code: string): Error {
	return Object.assign(new Error(`${code}: write failed`), { code })
}

describe('saveFailure', () => {
	test('a file it may not write, in Foundation’s words for NSFileWriteNoPermissionError', () => {
		const expected = {
			title: 'The document “locked.md” could not be saved. You don’t have permission.',
			message:
				'To view or change permissions, select the item in the Finder and choose File > Get Info.'
		}
		expect(saveFailure('locked.md', fsError('EACCES'))).toEqual(expected)
		expect(saveFailure('locked.md', fsError('EPERM'))).toEqual(expected)
	})

	test('a read-only volume and a full one, in Foundation’s words for NSFileWriteVolumeReadOnlyError and NSFileWriteOutOfSpaceError', () => {
		expect(saveFailure('notes.md', fsError('EROFS'))).toEqual({
			title: 'The document “notes.md” could not be saved. The volume is read only.',
			message: 'Try saving the file to another volume.'
		})
		expect(saveFailure('notes.md', fsError('ENOSPC'))).toEqual({
			title: 'The document “notes.md” could not be saved. There isn’t enough space.',
			message: 'Remove some files from the volume, and then try again.'
		})
	})

	// the port's ChangedOnDiskError names the path; editmd's error says this (Document.swift:152-154)
	test('a file that kept changing under 3 attempts, in editmd’s words', () => {
		const changing = Object.assign(new Error('/x/busy.md changed on disk since it was last read'), {
			name: 'ChangedOnDiskError'
		})
		expect(saveFailure('busy.md', changing).title).toBe(
			'The document “busy.md” could not be saved. The file kept changing on disk while saving.'
		)
	})

	test('any other error gives its own message as the reason, with nothing below', () => {
		expect(
			saveFailure('busy.md', new Error('The file kept changing on disk while saving.'))
		).toEqual({
			title:
				'The document “busy.md” could not be saved. The file kept changing on disk while saving.',
			message: ''
		})
	})
})
