import { writeErrorOf } from '../core/writeErrors.ts'
import type { OpenFailure } from './openFailure.ts'

/**
 * what NSDocument's alert says when File > Save could not write the document `name`, in AppKit's words
 * (Document.loctable "The document “%1$@” could not be saved. %2$@", Foundation's failure reason filled in, and its
 * recovery suggestion as informative text, core/writeErrors.ts; NSFileWriteUnknownError has neither); an error with no
 * errno code, such as editmd's own "The file kept changing on disk while saving.", gives its message as the reason
 */
export function saveFailure(name: string, error: Error): OpenFailure {
	const known = writeErrorOf(error)
	const reason =
		error.name === 'ChangedOnDiskError'
			? 'The file kept changing on disk while saving.'
			: (known?.reason ?? error.message)
	return {
		title: `The document “${name}” could not be saved.${reason ? ` ${reason}` : ''}`,
		message: known?.suggestion ?? ''
	}
}
