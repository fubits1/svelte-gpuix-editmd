import { EventEmitter } from 'node:events'
import { describe, expect, test } from 'vitest'
import { exitOnSignals } from './signals.ts'

// a signal's default action ends the process without Node's `exit` event, so the exit save would not run:
// Ctrl-C in the terminal, `kill`, or the terminal closing
describe('exitOnSignals', () => {
	test('SIGTERM, SIGINT and SIGHUP end the process through exit, with the shell’s code for each', () => {
		const target = new EventEmitter()
		const codes: number[] = []
		exitOnSignals(target, (code) => codes.push(code))

		for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) target.emit(signal)

		expect(codes).toEqual([143, 130, 129])
	})
})
