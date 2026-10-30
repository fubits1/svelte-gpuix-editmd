/**
 * editmd resolves images against its own `editmd:` scheme; here a document's base is a `file:` URL of its
 * folder, and GPUI's <img> takes file paths and `data:` URLs. so a path the document gives (relative or
 * absolute) is local, while a URL with a scheme of its own is local only for `data:`: a written `file:` URL
 * is blocked like any other, as editmd blocks every scheme but its own, `data:` and `blob:` (web/src/remote.ts:15)
 */

/** Schemes that never touch the network once a path has resolved against the document's folder. */
const localProtocols = new Set(['file:', 'data:'])

/** a URL that names its own scheme (`https:`, `file:`), as opposed to a path */
const OWN_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * Whether loading `src`, resolved against `base`, would go to the network.
 * Anything that doesn't resolve counts as remote, so it is never fetched.
 */
export function isRemote(src: string, base: string): boolean {
	try {
		const { protocol } = new URL(src, base)
		if (OWN_SCHEME.test(src)) return protocol !== 'data:'
		return !localProtocols.has(protocol)
	} catch {
		return true
	}
}
