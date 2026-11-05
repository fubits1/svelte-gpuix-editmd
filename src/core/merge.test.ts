import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { mergeText, mergeTextMapping, textEdits } from './merge.ts'

// an edit cut between the two halves of a surrogate pair makes Yjs write U+FFFD for each half, so an
// agent swapping 👍 for 👎 would corrupt the file at the next save
describe('characters outside the BMP', () => {
	test('an emoji swapped for one with the same high surrogate merges whole', () => {
		expect([
			mergeText('Status: 👍\n\nrest\n', 'Status: 👍\n\nrest\n', 'Status: 👎\n\nrest\n').text,
			mergeText('x😀y', 'x😀y, mine', 'x😁y').text,
			mergeText('a🔴b\n', 'a🔴b, mine\n', 'a🟢b\n').text
		]).toEqual(['Status: 👎\n\nrest\n', 'x😁y, mine', 'a🟢b, mine\n'])
	})

	// 😀 is D83D DE00 and 🈀 is D83C DE00, so the common end of the two texts starts inside the pair
	test('an emoji swapped for one with the same low surrogate merges whole', () => {
		expect(mergeText('x😀y', 'x😀y, mine', 'x🈀y').text).toBe('x🈀y, mine')
	})

	test('any text with astral characters merges without U+FFFD', () => {
		const astral = fc.constantFrom('😀', '😁', '👍', '👎', '🔴', '🟢', 'a', ' ', '\n')
		const text = fc.array(astral, { maxLength: 12 }).map((parts) => parts.join(''))
		fc.assert(
			fc.property(text, text, text, (base, mine, theirs) => {
				expect(mergeText(base, mine, theirs).text.includes('�')).toBe(false)
			})
		)
	})
})

/**
 * typing at the end of a line the other side deleted is dropped, as editmd's editor drops it (measured, the kit's
 * f-merge-open "line two" case); typing anywhere else is kept
 */
describe('typing at the end of a line the other side deleted', () => {
	test('typing inside a word the other side deleted is kept', () => {
		expect(mergeText('a bigger house\n', 'a bigXger house\n', 'a house\n').text).toContain('X')
	})

	test('is dropped; typing at a deletion’s edge stays', () => {
		expect([
			mergeText(
				'line one\nline two\nline three\n',
				'line one\nline two typed\nline three\n',
				'line one\nline three\n'
			).text,
			mergeText('a one\n', 'a one two\n', 'a ONE\n').text,
			mergeText('keep cut me keep\n', 'keep cut me keep, mine\n', 'keep keep\n').text
		]).toEqual(['line one\nline three\n', 'a ONE two\n', 'keep keep, mine\n'])
	})

	test('a cursor in the dropped typing lands where the deletion was', () => {
		const mine = 'line one\nline two typed\nline three\n'
		const merged = mergeTextMapping(
			'line one\nline two\nline three\n',
			mine,
			'line one\nline three\n',
			[mine.indexOf(' typed') + 3]
		)
		expect(merged.cursors).toEqual(['line one\n'.length])
	})
})

describe('mergeTextMapping', () => {
	test('maps several offsets of mine into the merged text', () => {
		const mine = 'aa\n\nMINE\n\nzz\n'
		const start = mine.indexOf('MINE')
		const end = start + 'MINE'.length

		const merged = mergeTextMapping('aa\n\nmine\n\nzz\n', mine, 'aa, theirs\n\nmine\n\nzz\n', [
			start,
			end
		])

		expect(merged.text).toBe('aa, theirs\n\nMINE\n\nzz\n')
		expect(merged.text.slice(merged.cursors[0], merged.cursors[1])).toBe('MINE')
	})
})

// A document of distinct lines, so every edit is unambiguous.
const doc = fc
	.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), {
		minLength: 4,
		maxLength: 12
	})
	.map((ws) => ws.map((w) => w + '\n'))
const replacement = fc.array(
	fc.stringMatching(/^[A-Z]{1,6}$/).map((w) => w + '\n'),
	{ maxLength: 3 }
)

/** Two edits to separate parts of `base`: [start, end) replaced, with a kept line between them. */
const disjointEdits = doc.chain((base) =>
	fc
		.tuple(
			fc.nat(base.length),
			fc.nat(base.length),
			fc.nat(base.length),
			fc.nat(base.length),
			replacement,
			replacement
		)
		.map(([w, x, y, z, mine, theirs]) => {
			const [s1, e1, s2, e2] = [w, x, y, z].sort((p, q) => p - q) as [
				number,
				number,
				number,
				number
			]
			return {
				base,
				first: { start: s1, end: e1, lines: mine },
				second: { start: s2, end: e2, lines: theirs }
			}
		})
		.filter(({ first, second }) => second.start > first.end)
)

const edit = (base: string[], e: { start: number; end: number; lines: string[] }) =>
	[...base.slice(0, e.start), ...e.lines, ...base.slice(e.end)].join('')

describe('mergeText', () => {
	const text = fc.string({
		unit: fc.constantFrom('a', 'b', ' ', '\n'),
		maxLength: 40
	})

	// typing right after a word the other side rewrote stays after it: "a ONE two", as editmd's own editor gives,
	// not "a  twoONE"
	test('a word rewritten on one side keeps its place before typing right after it on the other', () => {
		expect([
			mergeText('a one\n', 'a one two\n', 'a ONE\n').text,
			mergeText('a one\n', 'a ONE\n', 'a one two\n').text,
			mergeText('end word\n', 'end word, more\n', 'end WORD\n').text
		]).toEqual(['a ONE two\n', 'a ONE two\n', 'end WORD, more\n'])
	})

	test('one side unchanged takes the other', () => {
		fc.assert(
			fc.property(text, text, (base, other) => {
				expect(mergeText(base, base, other).text).toBe(other)
				expect(mergeText(base, other, base).text).toBe(other)
				expect(mergeText(base, other, other).text).toBe(other)
			})
		)
	})

	test('edits to separate lines both land', () => {
		fc.assert(
			fc.property(disjointEdits, fc.boolean(), ({ base, first, second }, mineFirst) => {
				const [m, t] = mineFirst ? [first, second] : [second, first]
				const expected = [
					...base.slice(0, first.start),
					...first.lines,
					...base.slice(first.end, second.start),
					...second.lines,
					...base.slice(second.end)
				].join('')
				expect(mergeText(base.join(''), edit(base, m), edit(base, t)).text).toBe(expected)
			})
		)
	})

	test('edits to separate words of one line both land', () => {
		expect(
			mergeText('the quick brown fox\n', 'the slow brown fox\n', 'the quick brown cat\n').text
		).toBe('the slow brown cat\n')
	})

	test('nothing typed is lost, even when both sides edit the same spot, but for typing at the end of a line they deleted', () => {
		fc.assert(
			fc.property(text, text, text, (base, mine, theirs) => {
				const merged = mergeText(base, mine, theirs).text
				// mine's edits but typing right before the newline of a line theirs deleted whole, which editmd drops
				const deletedLines = textEdits(base, theirs).filter(
					({ start, end, insert }) =>
						insert === '' && (start === 0 || base[start - 1] === '\n') && base[end - 1] === '\n'
				)
				const atLineEnd = ({
					start,
					end,
					insert
				}: {
					start: number
					end: number
					insert: string
				}) =>
					start === end &&
					insert !== '' &&
					base[start] === '\n' &&
					deletedLines.some((line) => line.start < start && start < line.end)
				const kept = textEdits(base, mine)
					.filter((edit) => !atLineEnd(edit))
					.reduce(
						(text, { start, end, insert }) => text.slice(0, start) + insert + text.slice(end),
						base
					)
				// Every character the user inserted (by multiset) is still there.
				const count = (s: string) =>
					[...s].reduce((m, c) => m.set(c, (m.get(c) ?? 0) + 1), new Map<string, number>())
				const b = count(base),
					m = count(kept),
					r = count(merged)
				for (const [c, n] of m) expect(r.get(c) ?? 0).toBeGreaterThanOrEqual(n - (b.get(c) ?? 0))
			})
		)
	})

	test('the cursor stays with the text around it', () => {
		fc.assert(
			fc.property(disjointEdits, ({ base, first, second }) => {
				// The user edits the second region with the cursor after it; the other side edits the first.
				const mine = edit(base, second)
				const cursor = mine.length - base.slice(second.end).join('').length
				const { text, cursor: mapped } = mergeText(base.join(''), mine, edit(base, first), cursor)
				expect(text.slice(mapped)).toBe(base.slice(second.end).join(''))
			})
		)
	})
})
