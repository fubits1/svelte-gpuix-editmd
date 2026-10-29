/** the user's locale and time zone unless a test pins them */
export type TimeFormat = { locale?: string; timeZone?: string }

/**
 * a highlight's tooltip as editmd writes it (web/src/highlights.ts:214-216): the agent's name, then the time of
 * the change as `toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })`
 */
export function highlightTooltip(
	name: string,
	at: number,
	{ locale, timeZone }: TimeFormat = {}
): string {
	const time = new Date(at).toLocaleTimeString(locale ?? [], {
		hour: 'numeric',
		minute: '2-digit',
		timeZone
	})
	return `${name}, ${time}`
}

/** editmd cuts a deletion's text in its tooltip after this many characters */
const DELETED_TEXT_LIMIT = 300

/**
 * a Deletion marker's tooltip as editmd writes it (web/src/highlights.ts:217-218): who deleted it and when, then
 * the deleted text on the lines after, cut after 300 characters with an ellipsis
 */
export function deletionTooltip(
	name: string,
	at: number,
	text: string,
	format: TimeFormat = {}
): string {
	const shown = text.length > DELETED_TEXT_LIMIT ? `${text.slice(0, DELETED_TEXT_LIMIT)}…` : text
	return `Deleted by ${highlightTooltip(name, at, format)}:\n${shown}`
}
