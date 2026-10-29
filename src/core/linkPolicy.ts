/**
 * What a link does when it is opened from a document. Markdown files come
 * from anywhere (a cloned repository has no quarantine flag, so Gatekeeper
 * never asks), so following a link must never launch anything: local files
 * either open in the editor as text or are shown in Finder.
 */

import { realpathSync, statSync } from 'node:fs'
import { isTextPath } from './fileTypes.ts'

export type LinkAction =
	/** A web page or mail address, for the default browser or mail app. */
	| { kind: 'openExternally'; url: string }
	/** A local text file, opened as a document in the editor. */
	| { kind: 'openInEditor'; path: string }
	/** Any other local file, folder, package or bundle, selected in Finder. */
	| { kind: 'reveal'; path: string }
	/** Another scheme, which could start any app: ask before opening it. */
	| { kind: 'confirm'; url: string }
	/** Nothing to open, such as a relative link in a document with no folder. */
	| { kind: 'ignore' }

/** What is known about a local file a link points at. */
export type LinkTarget = { isDirectory: boolean; isText: boolean }

/**
 * Reads what is on disk at `path`, following symlinks so that a link
 * named like a text file cannot stand in for an app. Null if nothing is there.
 * Packages and bundles are directories on disk, so `isDirectory` covers them.
 */
export function describeOnDisk(path: string): LinkTarget | null {
	try {
		const resolved = realpathSync(path)
		return { isDirectory: statSync(resolved).isDirectory(), isText: isTextPath(resolved) }
	} catch {
		return null
	}
}

/** Schemes opened without asking. */
const EXTERNAL = new Set(['http:', 'https:', 'mailto:'])
/** Schemes that only mean something inside the app, never worth opening; `editmd:` is editmd's own page (LinkPolicy.swift:50-53) */
const PAGE_ONLY = new Set(['editmd:', 'about:', 'data:', 'blob:', 'javascript:'])

/**
 * a URL's path with its percent-escapes decoded, but `%00` and `%2F` kept as written, as Foundation's `URL.path` keeps
 * them: a NUL makes no path, and a decoded slash names another file. throws on a broken escape
 */
function pathOf(pathname: string): string {
	return pathname
		.split(/(%00|%2f)/i)
		.map((part, index) => (index % 2 === 1 ? part : decodeURIComponent(part)))
		.join('')
}

/**
 * The action for `href`, an absolute URL (relative links are resolved against
 * the document's folder before this). File URLs are described by `describe`,
 * which returns null for a file that does not exist; such a file is judged by
 * its name with `isTextName` (the app passes macOS's type for its extension,
 * host/fileKinds.ts).
 */
export function linkAction(
	href: string,
	describe: (path: string) => LinkTarget | null = describeOnDisk,
	isTextName: (path: string) => boolean = isTextPath
): LinkAction {
	let url: URL
	try {
		url = new URL(href)
	} catch {
		return { kind: 'ignore' }
	}

	// editmd's page scheme names a file as `editmd://file/<path>`, which editmd turns back into a file URL
	// before deciding (EditorBridge.swift `AssetSchemeHandler.fileURL`)
	const pageFile = url.protocol === 'editmd:' && url.host === 'file'
	if (url.protocol === 'file:' || pageFile) {
		// Foundation's `URL.path` leaves out a file URL's host and keeps a broken percent-escape as written; editmd's
		// page scheme names no file with a broken one
		let path: string
		try {
			path = pathOf(url.pathname)
		} catch {
			if (pageFile) return { kind: 'ignore' }
			path = url.pathname
		}
		const target = describe(path) ?? { isDirectory: false, isText: isTextName(path) }
		return target.isDirectory || !target.isText
			? { kind: 'reveal', path }
			: { kind: 'openInEditor', path }
	}
	if (EXTERNAL.has(url.protocol)) return { kind: 'openExternally', url: href }
	if (PAGE_ONLY.has(url.protocol)) return { kind: 'ignore' }

	return { kind: 'confirm', url: href }
}
