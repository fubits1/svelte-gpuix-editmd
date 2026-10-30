/**
 * editmd's Copy of rendered text writes what Milkdown's clipboardTextSerializer makes of the selection
 * (plugin-clipboard/src/index.ts:135-149): text inside one text node as it reads, anything more as markdown with its
 * open parents and marks. Each expectation below is what editmd's own editor wrote for the same selection, except
 * where a comment names its serializer's rewrite, which the port leaves as written (ADR-0003)
 */

import { describe, expect, test } from 'vitest'
import { copiedText } from './copiedText.ts'

describe('copiedText', () => {
	test('text inside one text node copies as it reads, its marks left behind', () => {
		expect([
			copiedText('One **bold** two.\n', 'bold'),
			copiedText('# Title\n', 'itl'),
			copiedText('- first\n- second\n- third\n', 'second'),
			copiedText('a `code` b\n', 'ode')
		]).toEqual(['bold', 'itl', 'second', 'ode'])
	})

	test('a selection over marked text copies as markdown, a mark cut by either end closed around its part', () => {
		expect([
			copiedText('One **bold** two.\n', 'One bold two.'),
			copiedText('One **bold** two.\n', 'e bo'),
			copiedText('One **bold** two.\n', 'ld tw'),
			copiedText('see [link](u) x\n', 'nk x'),
			copiedText('see [link](u) x\n', 'see li'),
			copiedText('a `code` b\n', 'a co'),
			copiedText('***both*** x\n', 'both x'),
			copiedText('x **a *b* c** y\n', 'b c')
		]).toEqual([
			'One **bold** two.\n',
			'e **bo**\n',
			'**ld** tw\n',
			'[nk](u) x\n',
			'see [li](u)\n',
			'a `co`\n',
			'***both*** x\n',
			'***b* c**\n'
		])
	})

	test('a selection over Blocks keeps each one’s kind, its first line’s markers too where it starts inside', () => {
		expect([
			copiedText('# Title\n\nBody text\n', 'Title\nBo'),
			copiedText('# Title\n\nBody text\n', 'tle\nBody text'),
			copiedText('Para one\n\nPara two\n', 'one\nPara'),
			copiedText('# H\n\n- a\n- b\n', 'H\na'),
			copiedText('one\ntwo\n', 'e tw')
		]).toEqual([
			'# Title\n\nBo\n',
			'# tle\n\nBody text\n',
			'one\n\nPara\n',
			'# H\n\n- a\n',
			'e\ntw\n'
		])
	})

	test('list items and quotes copy with their markers, the open item’s and its parents’ included', () => {
		expect([
			copiedText('- first\n- second\n- third\n', 'rst\nsec'),
			copiedText('- first\n- second\n- third\n', 'first\nsecond\nthird'),
			copiedText('- first\n  - inner\n- third\n', 'inner\nthird'),
			copiedText('1. one\n2. two\n', 'one\ntwo'),
			copiedText('- [ ] task\n- [x] done\n', 'task\ndone'),
			copiedText('> q1\n>\n> q2\n', 'q1\nq2'),
			copiedText('> q1\n>\n> q2\n', '1\nq2')
		]).toEqual([
			'- rst\n- sec\n',
			'- first\n- second\n- third\n',
			'- - inner\n- third\n',
			'1. one\n2. two\n',
			'- [ ] task\n- [x] done\n',
			'> q1\n>\n> q2\n',
			'> 1\n>\n> q2\n'
		])
	})

	// the window cannot select a code card's text, so a drag over one reads the text around it; editmd copies the code
	test('a Block between the selection’s ends that paints no selectable text is copied whole', () => {
		expect(copiedText('a *b* c\n\n```js\nx\n```\n\nd\n', 'a b c\nd')).toBe(
			'a *b* c\n\n```js\nx\n```\n\nd\n'
		)
	})

	test('escapes, footnote references and inline HTML copy as written', () => {
		expect([
			copiedText('a \\* b **c**\n', 'a * b c'),
			copiedText('x[^1] y\n\n[^1]: n\n', 'x¹ y'),
			copiedText('a <b>h</b> c\n', '<b>h</b> c')
		]).toEqual(['a \\* b **c**\n', 'x[^1] y\n', '<b>h</b> c\n'])
	})

	// editmd's serializer writes a hard break as `\` and decodes `&amp;`; the port copies the source as written
	test('a hard break and an entity copy as written, where editmd’s serializer rewrites them', () => {
		expect([
			copiedText('one  \ntwo\n', 'one\ntwo'),
			copiedText('a &amp; b **c**\n', 'a & b c')
		]).toEqual(['one  \ntwo\n', 'a &amp; b **c**\n'])
	})

	// a soft break paints a space and its next line's `>` and indent are no text of the paragraph's
	test('a selection over a soft break in a quote copies both lines with their quote marks', () => {
		expect(copiedText('> a\n> b c\n', 'a b')).toBe('> a\n> b\n')
	})

	test('a code span’s padding and a byte order mark are kept as written', () => {
		expect([
			copiedText('a `` `x` `` b\n', 'a `x`'),
			copiedText('﻿One **b** c\n', 'One b c')
		]).toEqual(['a `` `x` ``\n', 'One **b** c\n'])
	})

	// a code span over two lines paints them as one, which its value no longer traces back to the source
	test('text the port cannot trace back to its source, and a selection of only line breaks, copy as they read', () => {
		expect([copiedText('a `x\ny` b\n', 'a x y b'), copiedText('a\n\nb\n', '\n')]).toEqual([
			'a x y b',
			'\n'
		])
	})

	test('a selection found nowhere, or in more than one place, copies as it reads', () => {
		expect([copiedText('x\n', 'zzz'), copiedText('**a** b\n\n**a** b\n', 'a b')]).toEqual([
			'zzz',
			'a b'
		])
	})
})
