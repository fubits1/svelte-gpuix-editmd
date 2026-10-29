// Heading anchors that match GitHub's, so a table of contents written for
// GitHub (`[What's new](#whats-new)`) scrolls here too.

/**
 * GitHub's anchor for a heading's text, as github-slugger makes it: lower
 * case, punctuation and symbols dropped (but not `-` or `_`), spaces turned
 * into hyphens. github-slugger lists the characters it drops as of Unicode
 * 13; the property classes here follow the engine's newer Unicode instead.
 */
export function slug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{Nd}\p{Nl}\p{Pc}\- ]/gu, '')
		.replace(/ /g, '-')
}

/**
 * The anchors for a document's headings, in document order. A repeated slug
 * gets `-1`, `-2`, ... appended, skipping any that another heading already
 * took, as github-slugger does.
 */
export function headingSlugs(texts: readonly string[]): string[] {
	const seen = new Map<string, number>()
	return texts.map((text) => {
		const base = slug(text)
		let result = base
		while (seen.has(result)) {
			const count = seen.get(base)! + 1
			seen.set(base, count)
			result = `${base}-${count}`
		}
		seen.set(result, 0)
		return result
	})
}

/**
 * Which heading a `#fragment` link points at: an index into `texts`, or -1.
 * The fragment is percent-decoded when it can be, and matched as written
 * when it is malformed (`#%`) rather than throwing.
 */
export function findHeading(fragment: string, texts: readonly string[]): number {
	return findSlug(fragment, headingSlugs(texts))
}

/** `findHeading` against anchors already computed, such as the slugs parsed Blocks carry */
export function findSlug(fragment: string, slugs: readonly string[]): number {
	let id = fragment.replace(/^#/, '')
	try {
		id = decodeURIComponent(id)
	} catch {
		// Not valid percent-encoding: look it up as written.
	}
	const exact = slugs.indexOf(id)
	return exact >= 0 ? exact : slugs.indexOf(id.toLowerCase())
}
