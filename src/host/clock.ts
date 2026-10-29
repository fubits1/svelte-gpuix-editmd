import type { Scheduler } from './documentFile.ts'

/**
 * a steady clock in seconds (the process's uptime, as editmd's Persistence runs on the system's uptime), with one
 * pending wake-up that each new request replaces: setting the wall clock back never holds off an autosave
 */
export function createClockScheduler(): Scheduler {
	let timer: ReturnType<typeof setTimeout> | undefined
	const seconds = () => performance.now() / 1000

	return {
		get now() {
			return seconds()
		},
		at(time, callback) {
			clearTimeout(timer)
			timer = setTimeout(callback, Math.max(0, (time - seconds()) * 1000))
		},
		cancel() {
			clearTimeout(timer)
		}
	}
}
