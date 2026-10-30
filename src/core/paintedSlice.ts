import type { Block } from '../engine/blocks.ts'
import { footnoteMark } from './footnotes.ts'

type Rewrite = { start: number; end: number; text: string }

/** inline code holding `text`, its fence one backtick longer than any run of them inside */
function inlineCode(text: string): string {
	const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
	const fence = '`'.repeat(longest + 1)
	return longest === 0 ? `${fence}${text}${fence}` : `${fence} ${text} ${fence}`
}

/**
 * `source` struck through, as editmd paints a ticked task's text (style.css:268-272): each paragraph trimmed and
 * wrapped in `~~`, since a strike cannot span a blank line; nothing for an empty item, where `~~~~` would open a
 * code fence
 */
export function struckThrough(source: string): string {
	return source
		.split(/\n[ \t]*\n/)
		.map((paragraph) => paragraph.trim())
		.filter((paragraph) => paragraph !== '')
		.map((paragraph) => `~~${withoutOwnStrikes(paragraph)}~~`)
		.join('\n\n')
}

/** a code span, its fence a run of backticks closed by the same run */
const CODE_SPAN = /(`+)[\s\S]*?\1/g

/**
 * `text` with its own strikes taken off (the whole is struck anyway) and every other tilde escaped, outside code
 * spans: `~~` at its start would otherwise open a code fence, and a lone `~` at its end would show as a mark
 */
function withoutOwnStrikes(text: string): string {
	const plain = (part: string) =>
		part.replace(/(~~?)(?=\S)([\s\S]*?\S)\1(?!~)/g, '$2').replace(/(?<!\\)~/g, '\\~')
	let result = ''
	let at = 0
	for (const code of text.matchAll(CODE_SPAN)) {
		result += plain(text.slice(at, code.index)) + code[0]
		at = code.index + code[0].length
	}
	return result + plain(text.slice(at))
}

/**
 * a fenced code Block's `source` without the info string after its opening fence: native <markdown> draws a header
 * bar for a fence with one and none without (probed), and editmd shows the language as a small label, which the
 * view paints itself. an indented code block, four spaces in, has no fence and stays as written
 */
export function withoutInfoString(source: string): string {
	return source.replace(/^( {0,3})(`{3,}|~{3,})[^\n]*/, '$1$2')
}

/**
 * what native <markdown> paints for `source`, the part of `block` that starts at Document offset `start`:
 * each footnote reference as its raised label (native paints `[^label]` literally), each inline HTML tag as a code
 * span of its source, as editmd shows a tag in mono (style.css:346-349), and each link with
 * no text as a link whose text is its own source in code, as editmd shows it (style.css:363-366), since
 * native paints it as nothing. untouched text stays as written
 */
export function paintedSlice(source: string, start: number, block: Block): string {
	const end = start + source.length
	const rewrites: Rewrite[] = [
		...(block.footnoteReferences ?? []).map((reference) => ({
			start: reference.start,
			end: reference.end,
			text: footnoteMark(reference)
		})),
		...(block.inlineHtml ?? []).map((tag) => ({
			start: tag.start,
			end: tag.end,
			text: inlineCode(source.slice(tag.start - start, tag.end - start))
		})),
		...(block.emptyLinks ?? []).map((link) => {
			const written = source.slice(link.start - start, link.end - start)
			// `[` + the source in code + `]`, then the destination as written, `(url)` after the empty `[]`
			return {
				start: link.start,
				end: link.end,
				text: `[${inlineCode(written)}]${written.slice(2)}`
			}
		})
	]
		// a part of a Block (one task item) holds only some of them
		.filter((rewrite) => rewrite.start >= start && rewrite.end <= end)
		.sort((a, b) => a.start - b.start)

	let result = ''
	let at = start
	for (const rewrite of rewrites) {
		result += source.slice(at - start, rewrite.start - start) + rewrite.text
		at = rewrite.end
	}
	result += source.slice(at - start)
	// a Block inside a quote or a list item paints as its own markdown, without what its container puts on its lines
	if (block.prefix === undefined) return result
	const prefix = new RegExp(`^${block.prefix}`)
	return result
		.split('\n')
		.map((line, index) => (index === 0 ? line : line.replace(prefix, '')))
		.join('\n')
}
