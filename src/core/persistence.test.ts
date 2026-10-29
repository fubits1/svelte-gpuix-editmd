import { describe, expect, test } from 'vitest'
import {
	type Decision,
	DEFAULT_POLICY,
	labelDetail,
	labelText,
	Persistence,
	type PersistenceEvent,
	type SaveLabel
} from './persistence.ts'
import { SplitMix64 } from './splitMix64.ts'

type Action =
	| { type: 'edit' }
	| { type: 'revertEdits' }
	| { type: 'agentWrite' }
	| { type: 'saveFinish'; version: number; fails: boolean }
	| { type: 'checkFinish' }
	| { type: 'wake' }

/**
 * Runs `Persistence` against a simulated editor, file and clock, the way
 * `Document` drives it, and records what happened.
 */
class Simulation {
	readonly policy = DEFAULT_POLICY
	machine = new Persistence()
	rng: SplitMix64
	failureRate: number

	now = 0
	queue: { at: number; seq: number; action: Action }[] = []
	seq = 0
	wakeAt: number | null = null

	/** Edits are numbered; the file holds `saved`, the editor `version`. */
	version = 0
	saved = 0
	saving = false
	checking = false
	editTimes = new Map<number, number>()
	saveStarts: { at: number; version: number }[] = []
	diskChanges: number[] = []
	diskChecks: number[] = []
	failedSaves = 0
	lastLabel: SaveLabel = { kind: 'none' }
	violations: string[] = []

	constructor(seed: number, { failureRate = 0, autosaves = true } = {}) {
		this.rng = new SplitMix64(seed)
		this.failureRate = failureRate
		this.send({ type: 'autosaves', enabled: autosaves })
	}

	get dirty(): boolean {
		return this.version !== this.saved
	}

	schedule(at: number, action: Action) {
		this.seq += 1
		this.queue.push({ at, seq: this.seq, action })
	}

	/** Typing in bursts, an occasional undo back to the saved text, and agent writes. */
	plan(duration: number) {
		let t = 0
		while (t < duration) {
			const burst = this.rng.int(1, 20)
			for (let i = 0; i < burst; i++) {
				t += this.rng.double(0.02, 0.4)
				this.schedule(t, { type: 'edit' })
			}
			if (this.rng.double(0, 1) < 0.1) this.schedule(t + 0.05, { type: 'revertEdits' })
			t += this.rng.double(0, 8)
		}
		const writes = this.rng.int(0, 6)
		for (let i = 0; i < writes; i++)
			this.schedule(this.rng.double(0, duration), { type: 'agentWrite' })
	}

	run() {
		while (this.queue.length > 0) {
			let nextIndex = 0
			for (let i = 1; i < this.queue.length; i++) {
				const candidate = this.queue[i]!
				const best = this.queue[nextIndex]!
				if (candidate.at < best.at || (candidate.at === best.at && candidate.seq < best.seq))
					nextIndex = i
			}
			const [next] = this.queue.splice(nextIndex, 1)
			this.now = Math.max(this.now, next!.at)
			this.perform(next!.action)
		}
	}

	perform(action: Action) {
		switch (action.type) {
			case 'edit':
				this.version += 1
				this.editTimes.set(this.version, this.now)
				this.send({ type: 'changed', dirty: this.dirty })
				break
			case 'revertEdits':
				// Undo back to the saved text, which the editor reports as clean.
				if (!this.saving) {
					this.version = this.saved
					this.send({ type: 'changed', dirty: false })
				}
				break
			case 'agentWrite':
				this.diskChanges.push(this.now)
				this.send({ type: 'diskChanged' })
				break
			case 'saveFinish':
				this.saving = false
				if (action.fails) {
					this.failedSaves += 1
					this.send({ type: 'saveFinished', error: 'disk full' })
				} else {
					this.saved = action.version
					this.send({ type: 'saveFinished', error: null })
					// The page then reports whether edits arrived during the save.
					this.send({ type: 'changed', dirty: this.dirty })
				}
				break
			case 'checkFinish':
				this.checking = false
				this.diskChecks.push(this.now)
				this.send({ type: 'diskChecked' })
				break
			case 'wake':
				if (this.wakeAt !== null && this.wakeAt <= this.now + 1e-9) this.send({ type: 'tick' })
				break
		}
	}

	send(event: PersistenceEvent) {
		const decision: Decision = this.machine.handle(event, this.now)
		this.lastLabel = decision.label

		if (decision.save) {
			if (this.saving)
				this.violations.push(`save started at ${this.now} while another was in flight`)
			if (this.checking) this.violations.push(`save started at ${this.now} during a disk check`)
			if (!this.dirty) this.violations.push(`saved a clean document at ${this.now}`)
			this.saveStarts.push({ at: this.now, version: this.version })
			this.saving = true
			const fails = this.rng.double(0, 1) < this.failureRate
			const finish = this.now + this.rng.double(0.01, 0.5)
			this.machine.handle({ type: 'saveStarted' }, this.now)
			this.schedule(finish, { type: 'saveFinish', version: this.version, fails })
		}

		if (decision.checkDisk) {
			if (this.saving) this.violations.push(`disk check at ${this.now} during a save`)
			if (this.checking) this.violations.push(`disk check at ${this.now} during another check`)
			this.checking = true
			this.schedule(this.now + this.rng.double(0.001, 0.2), { type: 'checkFinish' })
		}

		if (this.dirty && decision.label.kind === 'none')
			this.violations.push(`unsaved changes at ${this.now} but no label`)

		this.wakeAt = decision.wake
		if (decision.wake !== null) {
			if (decision.wake < this.now - 1e-9) this.violations.push(`wake in the past at ${this.now}`)
			this.schedule(decision.wake, { type: 'wake' })
		}
	}
}

const seeds = (count: number) => Array.from({ length: count }, (_value, index) => index + 1)

describe('Persistence simulation', () => {
	test.each(seeds(400))('seed %i saves everything safely and promptly', (seed) => {
		const sim = new Simulation(seed)
		sim.plan(60)
		sim.run()
		expect(sim.violations).toEqual([])

		// Everything typed reaches the file, and the label settles.
		expect(sim.saved).toBe(sim.version)
		expect(sim.lastLabel).toEqual({ kind: 'none' })

		// Each edit is on disk within maxWait, plus a save and a check in the way.
		const bound = sim.policy.maxWait + 0.5 + 0.2 + 0.5 + 1e-6
		for (const [version, at] of sim.editTimes) {
			const save = sim.saveStarts.find((start) => start.version >= version)
			if (save) expect(save.at - at).toBeLessThanOrEqual(bound)
		}

		// Saves wait for a pause in typing, unless changes have waited maxWait.
		for (const save of sim.saveStarts) {
			const lastEdit = Math.max(0, ...[...sim.editTimes.values()].filter((at) => at <= save.at))
			const previousVersion = sim.saveStarts.findLast((start) => start.at < save.at)?.version ?? 0
			const unsavedTimes = [...sim.editTimes]
				.filter(([version]) => version > previousVersion)
				.map(([, at]) => at)
			const oldestUnsaved = unsavedTimes.length > 0 ? Math.min(...unsavedTimes) : 0
			const paused = save.at - lastEdit >= sim.policy.idle - 1e-9
			const overdue = save.at - oldestUnsaved >= sim.policy.maxWait - 1e-9
			expect(paused || overdue).toBe(true)
		}

		// Every write by someone else is followed by a check of the file.
		if (sim.diskChanges.length > 0) {
			const lastChange = Math.max(...sim.diskChanges)
			expect(sim.diskChecks.some((at) => at >= lastChange)).toBe(true)
		}
	})

	test.each(seeds(150))('seed %i shows failures and recovers', (seed) => {
		const sim = new Simulation(seed, { failureRate: 0.3 })
		sim.plan(60)
		sim.run()
		expect(sim.violations).toEqual([])
		// The label always ends saying whether the last save worked.
		expect(sim.lastLabel).toEqual(
			sim.saved !== sim.version ? { kind: 'failed', message: 'disk full' } : { kind: 'none' }
		)
	})

	test.each(seeds(50))('seed %i: untitled documents never autosave', (seed) => {
		const sim = new Simulation(seed, { autosaves: false })
		sim.plan(30)
		sim.run()
		expect(sim.saveStarts).toEqual([])
		expect(sim.lastLabel).toEqual({ kind: 'none' })
	})
})

describe('Persistence examples', () => {
	test('typing then pausing saves after the idle delay', () => {
		const p = new Persistence()
		p.handle({ type: 'autosaves', enabled: true }, 0)
		expect(p.handle({ type: 'changed', dirty: true }, 10)).toEqual({
			save: false,
			checkDisk: false,
			wake: 11,
			label: { kind: 'saving' }
		})
		expect(p.handle({ type: 'tick' }, 11).save).toBe(true)
		p.handle({ type: 'saveStarted' }, 11)
		p.handle({ type: 'saveFinished', error: null }, 11.1)
		const clean = p.handle({ type: 'changed', dirty: false }, 11.1)
		expect(clean.label).toEqual({ kind: 'saved' })
		expect(clean.wake).toBe(13.1)
		expect(p.handle({ type: 'tick' }, 13.1).label).toEqual({ kind: 'none' })
	})

	test('typing without a pause still saves 5s after the first unsaved change (editmd’s maxWait)', () => {
		const p = new Persistence()
		p.handle({ type: 'autosaves', enabled: true }, 0)
		let last = p.handle({ type: 'changed', dirty: true }, 10)
		for (let at = 10.5; at < 15; at += 0.5) last = p.handle({ type: 'changed', dirty: true }, at)

		// the idle delay alone would wait until 15.5, a second after the last keystroke
		expect(last.wake).toBe(15)
		expect(p.handle({ type: 'tick' }, 14.9).save).toBe(false)
		expect(p.handle({ type: 'tick' }, 15).save).toBe(true)
	})

	test('a disk change during a save waits for it', () => {
		const p = new Persistence()
		p.handle({ type: 'autosaves', enabled: true }, 0)
		p.handle({ type: 'saveStarted' }, 0)
		expect(p.handle({ type: 'diskChanged' }, 0.1).checkDisk).toBe(false)
		expect(p.handle({ type: 'saveFinished', error: null }, 0.2).checkDisk).toBe(true)
	})

	test('a failed save waits for the next edit', () => {
		const p = new Persistence()
		p.handle({ type: 'autosaves', enabled: true }, 0)
		p.handle({ type: 'changed', dirty: true }, 0)
		expect(p.handle({ type: 'tick' }, 1).save).toBe(true)
		p.handle({ type: 'saveStarted' }, 1)
		const failed = p.handle({ type: 'saveFinished', error: 'nope' }, 1.1)
		expect(failed.label).toEqual({ kind: 'failed', message: 'nope' })
		expect(failed.wake).toBeNull()
		expect(p.handle({ type: 'changed', dirty: true }, 3).wake).toBe(4)
	})

	test('undoing back to the file clears a failure', () => {
		const p = new Persistence()
		p.handle({ type: 'autosaves', enabled: true }, 0)
		p.handle({ type: 'changed', dirty: true }, 0)
		p.handle({ type: 'tick' }, 1)
		p.handle({ type: 'saveStarted' }, 1)
		p.handle({ type: 'saveFinished', error: 'nope' }, 1.1)
		expect(p.handle({ type: 'changed', dirty: false }, 2).label).toEqual({ kind: 'none' })
	})

	test('a retry shows saving, not the old failure', () => {
		const p = new Persistence()
		p.handle({ type: 'autosaves', enabled: true }, 0)
		p.handle({ type: 'changed', dirty: true }, 0)
		p.handle({ type: 'tick' }, 1)
		p.handle({ type: 'saveStarted' }, 1)
		p.handle({ type: 'saveFinished', error: 'nope' }, 1.1)
		expect(p.handle({ type: 'saveStarted' }, 2).label).toEqual({ kind: 'saving' })
	})

	test('label text', () => {
		expect(labelText({ kind: 'saving' })).toBe('Saving…')
		expect(labelText({ kind: 'saved' })).toBe('Saved')
		expect(labelDetail({ kind: 'failed', message: 'x' })).toBe('x')
		expect(labelText({ kind: 'none' })).toBe('')
	})
})
