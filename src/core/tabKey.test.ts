import { describe, expect, test } from 'vitest'
import { pressTab, type TabEffects, tabAction } from './tabKey.ts'

const plain = { cmd: false, ctrl: false, alt: false, shift: false }

describe('tabAction', () => {
	test.each(['paragraph', 'heading', 'code', 'mermaid', 'table', 'blockquote'] as const)(
		'Tab in a %s types 2 spaces',
		(kind) => {
			expect(tabAction('tab', plain, kind)).toBe('spaces')
		}
	)

	test('Tab in a list item indents it', () => {
		expect(tabAction('tab', plain, 'list')).toBe('indent')
	})

	test('Shift-Tab in a list item outdents it', () => {
		expect(tabAction('tab', { ...plain, shift: true }, 'list')).toBe('outdent')
	})

	test.each(['paragraph', 'heading', 'code', 'table', 'blockquote'] as const)(
		'Shift-Tab in a %s is taken and changes nothing',
		(kind) => {
			expect(tabAction('tab', { ...plain, shift: true }, kind)).toBe('none')
		}
	)

	test.each([false, true])('Tab in front matter is left to gpuix (Shift %s)', (shift) => {
		expect(tabAction('tab', { ...plain, shift }, 'frontmatter')).toBeNull()
	})

	test.each(['cmd', 'ctrl', 'alt'] as const)('Tab with %s held is left to gpuix', (held) => {
		expect(tabAction('tab', { ...plain, [held]: true }, 'paragraph')).toBeNull()
		expect(tabAction('tab', { ...plain, [held]: true, shift: true }, 'list')).toBeNull()
	})

	test('another key is left alone', () => {
		expect(tabAction('escape', plain, 'paragraph')).toBeNull()
		expect(tabAction('space', plain, 'list')).toBeNull()
	})
})

describe('pressTab', () => {
	/** effects that record what a Tab did; `refuses` makes Indent and Outdent give null, `focused` the field's focus */
	function recorder({ refuses = false, focused = true } = {}) {
		const done: string[] = []
		const effects: TabEffects = {
			type: (keys) => void done.push(`type ${keys}`),
			focus: () => focused,
			format: (command, refused) => {
				done.push(command)
				if (refuses) refused?.()
			}
		}
		return { done, effects }
	}

	test('Tab in a paragraph types 2 spaces and is taken', () => {
		const { done, effects } = recorder()
		expect(pressTab('tab', plain, 'paragraph', effects)).toBe(true)
		expect(done).toEqual(['type space space'])
	})

	test('Tab in an empty Document with no Block yet types 2 spaces', () => {
		const { done, effects } = recorder()
		expect(pressTab('tab', plain, undefined, effects)).toBe(true)
		expect(done).toEqual(['type space space'])
	})

	test('Tab in a list item runs Indent', () => {
		const { done, effects } = recorder()
		expect(pressTab('tab', plain, 'list', effects)).toBe(true)
		expect(done).toEqual(['indent'])
	})

	test('Tab where Indent refuses types 2 spaces in the field', () => {
		const { done, effects } = recorder({ refuses: true })
		expect(pressTab('tab', plain, 'list', effects)).toBe(true)
		expect(done).toEqual(['indent', 'type space space'])
	})

	test('Tab where Indent refuses types nothing once the field has lost the keys', () => {
		const { done, effects } = recorder({ refuses: true, focused: false })
		expect(pressTab('tab', plain, 'list', effects)).toBe(true)
		expect(done).toEqual(['indent'])
	})

	test('Shift-Tab in a list item runs Outdent, and types nothing where it refuses', () => {
		const { done, effects } = recorder({ refuses: true })
		expect(pressTab('tab', { ...plain, shift: true }, 'list', effects)).toBe(true)
		expect(done).toEqual(['outdent'])
	})

	test('Shift-Tab in a paragraph is taken and does nothing', () => {
		const { done, effects } = recorder()
		expect(pressTab('tab', { ...plain, shift: true }, 'paragraph', effects)).toBe(true)
		expect(done).toEqual([])
	})

	test('a key left to gpuix is not taken and does nothing', () => {
		const { done, effects } = recorder()
		expect(pressTab('tab', plain, 'frontmatter', effects)).toBe(false)
		expect(pressTab('tab', { ...plain, cmd: true }, 'list', effects)).toBe(false)
		expect(done).toEqual([])
	})
})
