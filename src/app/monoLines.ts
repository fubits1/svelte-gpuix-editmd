import type { GpuixTheme } from 'gpuix-svelte'
import { NO_FILL } from './palette.ts'

/**
 * read-only mono text (front matter, definition and HTML lines, diagram messages) as native <markdown> paints it: SF
 * Mono, which only native text takes (`fontMono: .AppleSystemUIFontMonospaced`; a <text> refuses it), and
 * wrapping as editmd's `white-space: pre-wrap` and `overflow-wrap: anywhere` do, which native <code> cannot (measured
 * headless: a 200-character URL wraps, the advance is SF Mono's, `  - item` keeps its two spaces)
 */

/** CSS `tab-size`, which editmd's `white-space: pre-wrap` lines stop a tab at; native inline code paints a tab as nothing */
const TAB_SIZE = 8

/** `line` with each tab turned into the spaces to the next stop of TAB_SIZE columns */
function expandTabs(line: string): string {
	let out = ''
	for (const character of line) {
		out += character === '\t' ? ' '.repeat(TAB_SIZE - ([...out].length % TAB_SIZE)) : character
	}
	return out
}

/**
 * `text` as markdown that paints each of its lines as written: a paragraph of one code span per line, whose fence is
 * longer than any run of backticks in it. a code span drops one space from each end when both ends have one, or to
 * keep a backtick at an end from joining the fence, so such a line gets a space at each end to give; an empty line
 * is a code span of one space, so it keeps its row
 */
export function monoLinesSource(text: string): string {
	return text
		.split('\n')
		.map(expandTabs)
		.map((line) => {
			if (line === '') return '` `'
			const longest = Math.max(0, ...[...line.matchAll(/`+/g)].map(([run]) => run.length))
			const fence = '`'.repeat(longest + 1)
			const padded =
				line.startsWith('`') ||
				line.endsWith('`') ||
				(line.startsWith(' ') && line.endsWith(' ') && line.trim() !== '')
			return padded ? `${fence} ${line} ${fence}` : `${fence}${line}${fence}`
		})
		.join('\n\n')
}

/** SF Mono's advance per px of text size: ten `i`s 98.90625px wide at 16px (measured headless) */
const SF_MONO_ADVANCE = 98.90625 / 160

/**
 * how wide `text`'s longest line paints in SF Mono at `size` px, rounded up to a whole pixel and one more, so the
 * rounding of the glyphs never wraps the last one: native <markdown> fills its box's width, so a message that should
 * sit centred as editmd's flex child does (`.diagram`, style.css:421-431) is given this width, a mono face's text
 * being as wide as its characters
 */
export function monoLinesWidth(text: string, size: number): number {
	const longest = Math.max(0, ...text.split('\n').map((line) => [...expandTabs(line)].length))
	return Math.ceil(longest * size * SF_MONO_ADVANCE) + 1
}

/**
 * `theme` for `monoLinesSource`'s markdown: the code spans in `colour` on no fill, at `size` in a `lineHeight` line
 * (px, already zoomed), the paragraphs with no gap between them, so the lines sit as one block of text does
 */
export function monoLinesTheme(
	theme: GpuixTheme,
	colour: string,
	size: number,
	lineHeight: number
): GpuixTheme {
	return {
		...theme,
		codeWash: NO_FILL,
		codeText: colour,
		metrics: { ...theme.metrics, mdTextSize: size, mdLineHeight: lineHeight, mdBlockGap: 0 }
	}
}
