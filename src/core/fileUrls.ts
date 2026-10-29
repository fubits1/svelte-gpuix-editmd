import { pathToFileURL } from 'node:url'

/** the `file:` URL that links and images written in a document in `folder` resolve against */
export function folderUrl(folder: string): string {
	const href = pathToFileURL(folder).href
	return href.endsWith('/') ? href : `${href}/`
}

/**
 * what an untitled Document (`folder` null) resolves against differs on purpose: a relative link goes
 * nowhere (editmd's LinkPolicy ignores it), while a relative image resolves against the file system
 * root, so it still reads as a local path to show blocked or broken
 */
export function linkBase(folder: string | null): string | undefined {
	return folder === null ? undefined : folderUrl(folder)
}

export function imageBase(folder: string | null): string {
	return folder === null ? 'file:///' : folderUrl(folder)
}
