/** how long to wait between two reads of a file that is being written */
const SETTLE_MS = 40

/** the most reads of a file that keeps changing, so a busy writer delays a merge by at most 200ms */
const MOST_READS = 6

/**
 * a file's text once two reads in a row agree: a program that writes a file in place (truncate, then write) can be
 * read between the two, empty or cut short, and that text merged in would take the rest of the document with it. a
 * file that keeps changing is taken as it last read
 */
export function stableRead<T>(read: () => T, wait: (ms: number) => void): T {
	let last = read()
	for (let reads = 1; reads < MOST_READS; reads++) {
		wait(SETTLE_MS)
		const next = read()
		if (next === last) return next
		last = next
	}
	return last
}
