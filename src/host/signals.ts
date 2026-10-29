/** the signals that end an editor from outside: `kill`, Ctrl-C in its terminal, the terminal closing */
const SIGNALS = { SIGTERM: 15, SIGINT: 2, SIGHUP: 1 } as const

type SignalTarget = { on(signal: keyof typeof SIGNALS, listener: () => void): unknown }

/**
 * ends the process through `exit` on SIGTERM, SIGINT and SIGHUP, with the shell's code (128 + the signal), so the
 * exit save of a file's edits runs: a signal's default action ends the process without Node's `exit` event
 */
export function exitOnSignals(
	target: SignalTarget = process,
	exit: (code: number) => void = (code) => process.exit(code)
): void {
	for (const [signal, number] of Object.entries(SIGNALS) as [keyof typeof SIGNALS, number][]) {
		target.on(signal, () => exit(128 + number))
	}
}
