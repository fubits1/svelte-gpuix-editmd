import { describe, expect, test } from 'vitest'
import { stableRead } from './stableRead.ts'

describe('stableRead', () => {
	// an agent writing a file in place (truncate, then write) was read half written, and the empty or
	// cut text merged into the open field; a read is taken only once two reads in a row agree
	test('reads again until two reads in a row agree, waiting between them', () => {
		const reads = ['', 'half', 'the whole file', 'the whole file']
		const waits: number[] = []
		const text = stableRead(
			() => reads.shift()!,
			(ms) => waits.push(ms)
		)
		expect([text, waits.length]).toEqual(['the whole file', 3])
	})

	test('a file that keeps changing is taken as it last read after a few tries, never waiting long', () => {
		let n = 0
		const waits: number[] = []
		const text = stableRead(
			() => `write ${n++}`,
			(ms) => waits.push(ms)
		)
		expect([text, waits.reduce((sum, ms) => sum + ms, 0) <= 250]).toEqual(['write 5', true])
	})
})
