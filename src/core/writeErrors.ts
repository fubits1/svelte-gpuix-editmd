import { basename, dirname } from 'node:path'

/**
 * Foundation's words for a write error (FoundationErrors.loctable), by the errno node:fs reports: the failure
 * reason (`-C`), the recovery suggestion (`-R`), and the description of a save of one file (`.df` / `.f`)
 */
export type WriteError = {
	reason: string
	suggestion: string
	describe: (file: string, folder: string) => string
}

/** Err513, NSFileWriteNoPermissionError */
const NO_PERMISSION: WriteError = {
	reason: 'You don’t have permission.',
	suggestion:
		'To view or change permissions, select the item in the Finder and choose File > Get Info.',
	describe: (file, folder) =>
		`You don’t have permission to save the file “${file}” in the folder “${folder}”.`
}

const WRITE_ERRORS: Record<string, WriteError> = {
	EACCES: NO_PERMISSION,
	EPERM: NO_PERMISSION,
	// Err642, NSFileWriteVolumeReadOnlyError
	EROFS: {
		reason: 'The volume is read only.',
		suggestion: 'Try saving the file to another volume.',
		describe: (file) => `You can’t save the file “${file}” because the volume is read only.`
	},
	// Err640, NSFileWriteOutOfSpaceError
	ENOSPC: {
		reason: 'There isn’t enough space.',
		suggestion: 'Remove some files from the volume, and then try again.',
		describe: (file) => `You can’t save the file “${file}” because there isn’t enough space.`
	}
}

/** the Foundation words for `error`, by the errno code node:fs puts on it; undefined for any other error */
export function writeErrorOf(error: Error): WriteError | undefined {
	const code = 'code' in error && typeof error.code === 'string' ? error.code : ''
	return WRITE_ERRORS[code]
}

/**
 * what a failed save of `path` says, as editmd shows the save error's `localizedDescription` (Not Saved's tooltip,
 * EditorWindowController.swift:358-360): Foundation's sentence for a write error, editmd's own for a file that kept
 * changing (Document.swift:152-154), else the error's message
 */
export function saveErrorDescription(path: string, error: Error): string {
	if (error.name === 'ChangedOnDiskError') return 'The file kept changing on disk while saving.'
	return writeErrorOf(error)?.describe(basename(path), basename(dirname(path))) ?? error.message
}
