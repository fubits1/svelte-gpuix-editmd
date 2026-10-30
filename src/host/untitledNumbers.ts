import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** whether process `pid` runs: signal 0 checks without sending, EPERM means it runs as another user */
function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM'
	}
}

/** the title of the untitled window numbered `number`, as NSDocument names them: Untitled, Untitled 2, … */
export const untitledName = (number: number) => (number === 1 ? 'Untitled' : `Untitled ${number}`)

/**
 * the numbers untitled windows hold, shared by every window's process through one file per number in `folder`,
 * holding its process id. NSDocument (run in Swift) gives a new untitled document one past the highest number still
 * open, and starts at Untitled again once none is; a number whose process is gone is free
 */
export class UntitledNumbers {
	#folder: string
	#isAlive: (pid: number) => boolean

	constructor(folder: string, isAlive: (pid: number) => boolean = isRunning) {
		this.#folder = folder
		this.#isAlive = isAlive
	}

	/** the number for process `pid`'s new untitled window; 1 when the folder cannot be kept, as a first window has */
	take(pid: number): number {
		try {
			mkdirSync(this.#folder, { recursive: true })
			for (;;) {
				const number = Math.max(0, ...this.#held().map((held) => held.number)) + 1
				try {
					// another window taking the same number at once makes this one try the next
					writeFileSync(join(this.#folder, String(number)), String(pid), { flag: 'wx' })
					return number
				} catch (error) {
					if (!(typeof error === 'object' && error !== null && 'code' in error)) throw error
					if (error.code !== 'EEXIST') throw error
				}
			}
		} catch {
			return 1
		}
	}

	/** frees the number process `pid` holds, once its window closes or its document gets a file */
	release(pid: number): void {
		for (const held of this.#held()) {
			if (held.pid === pid) rmSync(join(this.#folder, String(held.number)), { force: true })
		}
	}

	/** the numbers held by running processes; a gone process's number is removed */
	#held(): { number: number; pid: number }[] {
		let names: string[]
		try {
			names = readdirSync(this.#folder)
		} catch {
			return []
		}
		return names.flatMap((name) => {
			const path = join(this.#folder, name)
			let pid = Number.NaN
			try {
				pid = Number(readFileSync(path, 'utf8'))
			} catch {
				// taken away by another window meanwhile
			}
			if (Number.isInteger(pid) && this.#isAlive(pid)) return [{ number: Number(name), pid }]
			rmSync(path, { force: true })
			return []
		})
	}
}
