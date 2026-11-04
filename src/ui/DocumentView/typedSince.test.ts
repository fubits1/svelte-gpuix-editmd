import { describe, expect, test } from 'vitest'
import { typedSince } from './typedSince.ts'

const caret = (at: number) => ({ start: at, end: at })

describe('typedSince', () => {
	test('keys typed at a caret are what they inserted there', () => {
		expect(typedSince('one two', 'one twox', caret(8))).toEqual({
			replaced: { start: 7, end: 7 },
			typed: 'x'
		})
		expect(typedSince('one two three', 'one boldtwo three', caret(8))).toEqual({
			replaced: { start: 4, end: 4 },
			typed: 'bold'
		})
	})

	test('a key matching the text before the caret is placed by the caret, not the first difference', () => {
		expect(typedSince('one two', 'one ttwo', caret(5))).toEqual({
			replaced: { start: 4, end: 4 },
			typed: 't'
		})
	})

	test('a key typed over a selection replaced it', () => {
		expect(typedSince('one two three', 'one x three', caret(5))).toEqual({
			replaced: { start: 4, end: 7 },
			typed: 'x'
		})
	})

	test('no typing, a deletion, a selection or a caret before the typing is no typing to place', () => {
		expect([
			typedSince('one two', 'one two', caret(7)),
			typedSince('one two', 'one tw', caret(6)),
			typedSince('one two', 'one twox', { start: 4, end: 7 }),
			typedSince('one two', 'one twox', caret(7)),
			typedSince('ab', 'xyzab', caret(0))
		]).toEqual([null, null, null, null, null])
	})
})
