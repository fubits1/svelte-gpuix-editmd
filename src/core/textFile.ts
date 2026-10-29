/**
 * A text file: its bytes, and the text they hold with LF line endings.
 *
 * The file's format (encoding, byte order mark, line endings) belongs here,
 * not to the editor: the text handed out always uses LF, and new text is
 * written back in the format the file was read in. Text that equals what
 * was read is written back as the original bytes, so an untouched save
 * leaves the file exactly as it was.
 */

export type Encoding = 'utf8' | 'utf8BOM' | 'utf16LittleEndian' | 'utf16BigEndian' | 'windows1252'

export const ENCODINGS: readonly Encoding[] = [
	'utf8',
	'utf8BOM',
	'utf16LittleEndian',
	'utf16BigEndian',
	'windows1252'
]

export const ENCODING_NAMES: Record<Encoding, string> = {
	utf8: 'UTF-8',
	utf8BOM: 'UTF-8 with a byte order mark',
	utf16LittleEndian: 'UTF-16 (little endian)',
	utf16BigEndian: 'UTF-16 (big endian)',
	windows1252: 'Windows-1252'
}

export type LineEnding = '\n' | '\r\n' | '\r'

/** In tie-break order: ties go to LF, then CRLF. */
export const LINE_ENDINGS: readonly LineEnding[] = ['\n', '\r\n', '\r']

export type Format = { encoding: Encoding; lineEnding: LineEnding }

export type ReadErrorReason = 'binary' | 'unknownEncoding'

const FAILURE_REASONS: Record<ReadErrorReason, string> = {
	binary: 'It contains binary data, not text.',
	unknownEncoding: "Its text encoding isn't one editmd can read."
}

const RECOVERY_SUGGESTIONS: Record<ReadErrorReason, string> = {
	binary: 'editmd opens markdown and other plain text files.',
	unknownEncoding: 'editmd reads UTF-8, UTF-16 with a byte order mark, and Windows-1252.'
}

/** Why a file can't be opened as text. */
export class TextFileReadError extends Error {
	readonly reason: ReadErrorReason
	readonly failureReason: string
	readonly recoverySuggestion: string

	constructor(reason: ReadErrorReason) {
		super("The file can't be opened. " + FAILURE_REASONS[reason])
		this.name = 'TextFileReadError'
		this.reason = reason
		this.failureReason = FAILURE_REASONS[reason]
		this.recoverySuggestion = RECOVERY_SUGGESTIONS[reason]
	}
}

const DEFAULT_FORMAT: Format = { encoding: 'utf8', lineEnding: '\n' }

export class TextFile {
	/** The text, with LF line endings. */
	readonly text: string
	readonly format: Format
	/** The bytes on disk. */
	readonly data: Uint8Array

	private constructor(text: string, format: Format, data: Uint8Array) {
		this.text = text
		this.format = format
		this.data = data
	}

	/**
	 * `text` written in `format`. If the encoding can't represent the text,
	 * it is written as UTF-8 instead, which `format` then says.
	 */
	static fromText(text = '', format: Format = DEFAULT_FORMAT): TextFile {
		const normalized = normalizingLineEndings(text)
		const lines =
			format.lineEnding === '\n' ? normalized : normalized.replaceAll('\n', format.lineEnding)
		const data = encode(lines, format.encoding)
		if (data) return new TextFile(normalized, { ...format }, data)
		return new TextFile(normalized, { ...format, encoding: 'utf8' }, encode(lines, 'utf8')!)
	}

	/**
	 * Reads UTF-8 (with or without a byte order mark), UTF-16 with a byte
	 * order mark, and Windows-1252 for anything that isn't valid UTF-8.
	 */
	static fromData(data: Uint8Array): TextFile {
		const raw = decode(data)
		return new TextFile(
			normalizingLineEndings(raw.text),
			{ encoding: raw.encoding, lineEnding: dominantLineEnding(raw.text) },
			data
		)
	}

	/** The file with `text` as its contents, in the same format. Unchanged text keeps the original bytes. */
	replacingText(text: string): TextFile {
		return text === this.text ? this : TextFile.fromText(text, this.format)
	}

	/**
	 * What to tell the user when saving `this` over `previous` changed the
	 * file's encoding, which happens when an edit can't be represented in it.
	 */
	conversionNotice(previous: TextFile): string | null {
		if (this.format.encoding === previous.format.encoding) return null
		return `The file was saved as ${ENCODING_NAMES[this.format.encoding]}, because it now contains characters ${ENCODING_NAMES[previous.format.encoding]} can't represent.`
	}

	/** Same text, format and bytes: what Swift's synthesized `Equatable` compared. */
	equals(other: TextFile): boolean {
		return (
			this.text === other.text &&
			this.format.encoding === other.format.encoding &&
			this.format.lineEnding === other.format.lineEnding &&
			sameBytes(this.data, other.data)
		)
	}
}

// MARK: Encodings

const UTF8_BOM = [0xef, 0xbb, 0xbf]
const UTF16_LITTLE_ENDIAN_BOM = [0xff, 0xfe]
const UTF16_BIG_ENDIAN_BOM = [0xfe, 0xff]

/** Windows-1252 0x80-0x9F; `null` marks the five bytes the code page leaves undefined. */
const WINDOWS_1252_HIGH: readonly (number | null)[] = [
	0x20ac,
	null,
	0x201a,
	0x0192,
	0x201e,
	0x2026,
	0x2020,
	0x2021,
	0x02c6,
	0x2030,
	0x0160,
	0x2039,
	0x0152,
	null,
	0x017d,
	null,
	null,
	0x2018,
	0x2019,
	0x201c,
	0x201d,
	0x2022,
	0x2013,
	0x2014,
	0x02dc,
	0x2122,
	0x0161,
	0x203a,
	0x0153,
	null,
	0x017e,
	0x0178
]

const WINDOWS_1252_ENCODE = new Map<number, number>(
	WINDOWS_1252_HIGH.flatMap((codePoint, index) =>
		codePoint === null ? [] : [[codePoint, 0x80 + index] as [number, number]]
	)
)

const UTF8_FATAL = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const UTF16_LITTLE_ENDIAN = new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true })
const UTF16_BIG_ENDIAN = new TextDecoder('utf-16be', { fatal: true, ignoreBOM: true })
const UTF8_ENCODER = new TextEncoder()

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
	return prefix.every((byte, index) => bytes[index] === byte)
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((byte, index) => byte === b[index])
}

function decode(data: Uint8Array): { text: string; encoding: Encoding } {
	if (startsWith(data, UTF16_LITTLE_ENDIAN_BOM) || startsWith(data, UTF16_BIG_ENDIAN_BOM)) {
		const bigEndian = data[0] === 0xfe
		const body = data.subarray(2)
		if (body.length % 2 !== 0) throw new TextFileReadError('binary')

		const units = new Uint16Array(body.length / 2)
		for (let i = 0; i < units.length; i++) {
			const first = body[i * 2]!
			const second = body[i * 2 + 1]!
			units[i] = bigEndian ? (first << 8) | second : (second << 8) | first
		}

		if (units.includes(0) || !wellFormedUtf16(units)) throw new TextFileReadError('binary')

		return {
			text: (bigEndian ? UTF16_BIG_ENDIAN : UTF16_LITTLE_ENDIAN).decode(body),
			encoding: bigEndian ? 'utf16BigEndian' : 'utf16LittleEndian'
		}
	}

	// NUL never appears in text outside UTF-16.
	if (data.includes(0)) throw new TextFileReadError('binary')

	const hasBOM = startsWith(data, UTF8_BOM)
	const body = hasBOM ? data.subarray(UTF8_BOM.length) : data
	try {
		return { text: UTF8_FATAL.decode(body), encoding: hasBOM ? 'utf8BOM' : 'utf8' }
	} catch {
		// Not UTF-8.
	}

	// Control characters other than whitespace and escape mean binary data rather than a legacy text file.
	if (data.some((byte) => byte < 0x20 && ![0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1b].includes(byte))) {
		throw new TextFileReadError('binary')
	}

	const text = decodeWindows1252(data)
	if (text === null) throw new TextFileReadError('unknownEncoding')

	return { text, encoding: 'windows1252' }
}

/** Unpaired surrogates mean the bytes are not valid UTF-16. */
function wellFormedUtf16(units: Uint16Array): boolean {
	for (let i = 0; i < units.length; i++) {
		const unit = units[i]!
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = units[i + 1]
			if (next === undefined || next < 0xdc00 || next > 0xdfff) return false
			i++
		} else if (unit >= 0xdc00 && unit <= 0xdfff) {
			return false
		}
	}

	return true
}

function decodeWindows1252(data: Uint8Array): string | null {
	let text = ''
	for (const byte of data) {
		if (byte < 0x80 || byte > 0x9f) {
			text += String.fromCharCode(byte)
			continue
		}
		const codePoint = WINDOWS_1252_HIGH[byte - 0x80]
		if (codePoint === null || codePoint === undefined) return null
		text += String.fromCharCode(codePoint)
	}

	return text
}

/**
 * `text` in Windows-1252, or null when it holds a character the encoding cannot; a letter written decomposed (`e` and
 * U+0301) goes in precomposed, as Foundation's `data(using: .windowsCP1252)` writes it
 */
function encodeWindows1252(text: string): Uint8Array | null {
	return encodeWindows1252As(text) ?? encodeWindows1252As(text.normalize('NFC'))
}

function encodeWindows1252As(text: string): Uint8Array | null {
	const bytes: number[] = []
	for (const character of text) {
		const codePoint = character.codePointAt(0)!
		if (codePoint < 0x80 || (codePoint >= 0xa0 && codePoint <= 0xff)) {
			bytes.push(codePoint)
			continue
		}
		const byte = WINDOWS_1252_ENCODE.get(codePoint)
		if (byte === undefined) return null
		bytes.push(byte)
	}

	return Uint8Array.from(bytes)
}

function encodeUtf16(text: string, bigEndian: boolean): Uint8Array {
	const bytes = new Uint8Array(2 + text.length * 2)
	bytes.set(bigEndian ? UTF16_BIG_ENDIAN_BOM : UTF16_LITTLE_ENDIAN_BOM)
	for (let i = 0; i < text.length; i++) {
		const unit = text.charCodeAt(i)
		const high = unit >> 8
		const low = unit & 0xff
		bytes[2 + i * 2] = bigEndian ? high : low
		bytes[3 + i * 2] = bigEndian ? low : high
	}

	return bytes
}

function encode(text: string, encoding: Encoding): Uint8Array | null {
	switch (encoding) {
		case 'utf8':
			return UTF8_ENCODER.encode(text)
		case 'utf8BOM':
			return Uint8Array.from([...UTF8_BOM, ...UTF8_ENCODER.encode(text)])
		case 'utf16LittleEndian':
			return encodeUtf16(text, false)
		case 'utf16BigEndian':
			return encodeUtf16(text, true)
		case 'windows1252':
			return encodeWindows1252(text)
	}
}

// MARK: Line endings

/** `text` with every CRLF and lone CR turned into LF. */
export function normalizingLineEndings(text: string): string {
	if (!text.includes('\r')) return text
	return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

/** The most common line ending in `text`, LF if it has none. Ties go to LF, then CRLF. */
export function dominantLineEnding(text: string): LineEnding {
	const counts = new Map<LineEnding, number>()
	const count = (ending: LineEnding) => counts.set(ending, (counts.get(ending) ?? 0) + 1)
	let previousCR = false

	for (const character of text) {
		if (character === '\n') {
			count(previousCR ? '\r\n' : '\n')
		} else if (previousCR) {
			count('\r')
		}
		previousCR = character === '\r'
	}
	if (previousCR) count('\r')

	// first maximum wins, matching Swift's `max(by:)` over `allCases`
	let dominant: LineEnding = '\n'
	for (const ending of LINE_ENDINGS) {
		if ((counts.get(ending) ?? 0) > (counts.get(dominant) ?? 0)) dominant = ending
	}

	return dominant
}
