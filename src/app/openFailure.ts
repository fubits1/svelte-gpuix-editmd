import { TextFileReadError } from '../core/textFile.ts'

/** an NSAlert's text: `title` its bold message, `message` the informative text below, '' for none */
export type OpenFailure = { title: string; message: string }

/**
 * Foundation's failure reason and recovery suggestion for a read error, by the errno node:fs reports
 * (FoundationErrors.loctable: Err260-C for NSFileReadNoSuchFileError, Err257-C and Err257-R for
 * NSFileReadNoPermissionError; Err260 has no recovery suggestion)
 */
type ReadError = { reason: string; suggestion: string }

const NO_PERMISSION: ReadError = {
	reason: 'You don’t have permission.',
	suggestion:
		'To view or change permissions, select the item in the Finder and choose File > Get Info.'
}

const READ_ERRORS: Record<string, ReadError> = {
	ENOENT: { reason: 'The file doesn’t exist.', suggestion: '' },
	EACCES: NO_PERMISSION,
	EPERM: NO_PERMISSION
}

/** the errno code node:fs puts on its errors, null for any other error */
function codeOf(error: Error): string | null {
	return 'code' in error && typeof error.code === 'string' ? error.code : null
}

/**
 * what NSDocumentController's alert says when the document `name` cannot be opened, in AppKit's words
 * (Document.loctable "The document “%1$@” could not be opened. %2$@", the failure reason filled in, and the
 * recovery suggestion as informative text); editmd's TextFile errors bring their own reason and suggestion
 */
export function openFailure(name: string, error: Error): OpenFailure {
	const known =
		error instanceof TextFileReadError
			? { reason: error.failureReason, suggestion: error.recoverySuggestion }
			: READ_ERRORS[codeOf(error) ?? '']
	if (!known) {
		return {
			title: `The document “${name}” couldn’t be opened because an unknown error occurred.`,
			message: ''
		}
	}
	return {
		title: `The document “${name}” could not be opened. ${known.reason}`,
		message: known.suggestion
	}
}
