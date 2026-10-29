const OPENING_FENCE = /^( {0,3})(`{3,}|~{3,})/

/**
 * the code a code Block's source holds, as editmd's `pre` shows it: a fenced block's lines between its fences, each
 * with the opening fence's indent taken off (CommonMark 4.5); an indented block's lines with their four spaces or tab
 * taken off (CommonMark 4.4). a fence left open runs to the end
 */
export function codeText(source: string): string {
	const lines = source.split('\n')
	const opening = OPENING_FENCE.exec(lines[0] ?? '')
	if (!opening) return lines.map((line) => line.replace(/^(?: {1,4}|\t)/, '')).join('\n')
	const [, indent = '', fence = '```'] = opening
	const closing = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`)
	const body = lines.slice(1)
	const end = body.findIndex((line) => closing.test(line))
	const strip = new RegExp(`^ {0,${indent.length}}`)
	return (end < 0 ? body : body.slice(0, end)).map((line) => line.replace(strip, '')).join('\n')
}
