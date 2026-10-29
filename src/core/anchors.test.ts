import { describe, expect, test } from 'vitest'
import { findHeading, headingSlugs, slug } from './anchors.ts'

describe('slug', () => {
	test("matches GitHub's anchors", () => {
		expect(slug("What's new")).toBe('whats-new')
		expect(slug('Hello, World!')).toBe('hello-world')
		expect(slug('  Leading and trailing  ')).toBe('--leading-and-trailing--')
		expect(slug('snake_case and kebab-case')).toBe('snake_case-and-kebab-case')
		expect(slug('C++ & Rust (2024)')).toBe('c--rust-2024')
		expect(slug('Ελληνικά Café')).toBe('ελληνικά-café')
		expect(slug('Emoji 🎉 here')).toBe('emoji--here')
		expect(slug('x² ½')).toBe('x-')
		expect(slug('`code` *em*')).toBe('code-em')
	})

	test('repeats are numbered in document order', () => {
		expect(headingSlugs(['A', 'A', 'A'])).toEqual(['a', 'a-1', 'a-2'])
		expect(headingSlugs(['A', 'A', 'A-1'])).toEqual(['a', 'a-1', 'a-1-1'])
		expect(headingSlugs(['A-1', 'A', 'A'])).toEqual(['a-1', 'a', 'a-2'])
		expect(headingSlugs(['', ''])).toEqual(['', '-1'])
	})
})

describe('findHeading', () => {
	const texts = ['Intro', "What's new", 'Setup', 'Setup', 'Über uns']

	test('finds the heading a fragment names', () => {
		expect(findHeading('#whats-new', texts)).toBe(1)
		expect(findHeading('#setup-1', texts)).toBe(3)
		expect(findHeading('#%C3%BCber-uns', texts)).toBe(4)
		expect(findHeading('#über-uns', texts)).toBe(4)
		expect(findHeading('#Intro', texts)).toBe(0)
	})

	test('returns -1 for unknown or malformed fragments instead of throwing', () => {
		expect(findHeading('#nope', texts)).toBe(-1)
		expect(findHeading('#%', texts)).toBe(-1)
		expect(findHeading('#%E0%A4%A', texts)).toBe(-1)
	})
})
