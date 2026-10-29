import { afterEach, describe, expect, test, vi } from 'vitest'
import { createClockScheduler } from './clock.ts'

afterEach(() => vi.restoreAllMocks())

// editmd's Persistence runs on the system's uptime (ProcessInfo.systemUptime), so a wall clock set back does not hold
// an autosave off
describe('createClockScheduler', () => {
	test('its time does not follow the wall clock when it is set back an hour', () => {
		const scheduler = createClockScheduler()
		const before = scheduler.now
		const wall = Date.now()
		vi.spyOn(Date, 'now').mockReturnValue(wall - 3_600_000)

		expect(scheduler.now - before).toBeGreaterThanOrEqual(0)
		expect(scheduler.now - before).toBeLessThan(1)
	})
})
