import { describe, expect, test } from 'vitest'
import { deletionTooltip, highlightTooltip } from './highlightTooltip.ts'

describe('highlightTooltip', () => {
	// editmd's `tooltip` (web/src/highlights.ts:214-216): the agent's name, then the time as `toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })`
	test('names the agent and the time of the change, in the given locale and time zone', () => {
		const at = Date.UTC(2026, 9, 26, 14, 5)

		expect(highlightTooltip('Claude · notes', at, { locale: 'en-US', timeZone: 'UTC' })).toBe(
			'Claude · notes, 2:05 PM'
		)
		expect(highlightTooltip('Codex', at, { locale: 'de-DE', timeZone: 'Europe/Berlin' })).toBe(
			'Codex, 15:05'
		)
	})
})

describe('deletionTooltip', () => {
	const at = Date.UTC(2026, 9, 26, 14, 5)
	const format = { locale: 'en-US', timeZone: 'UTC' }

	// editmd's `tooltip` for a `deleted` highlight (web/src/highlights.ts:217-218)
	test('says who deleted what and when, the text on the lines after', () => {
		expect(deletionTooltip('Claude · notes', at, 'one\ntwo', format)).toBe(
			'Deleted by Claude · notes, 2:05 PM:\none\ntwo'
		)
	})

	test('cuts the text after 300 characters and ends it with an ellipsis', () => {
		const long = 'x'.repeat(301)

		expect(deletionTooltip('Codex', at, long, format)).toBe(
			`Deleted by Codex, 2:05 PM:\n${'x'.repeat(300)}…`
		)
		expect(deletionTooltip('Codex', at, long.slice(1), format)).toBe(
			`Deleted by Codex, 2:05 PM:\n${'x'.repeat(300)}`
		)
	})
})
