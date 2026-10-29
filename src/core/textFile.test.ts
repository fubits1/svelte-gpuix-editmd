// editmd's seeded SplitMix64 loops become fast-check properties with the same 300 runs

import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { type Encoding, ENCODINGS, TextFile, TextFileReadError } from './textFile.ts'

/** `text` in `encoding` as bytes, line endings untouched, through Node's codecs rather than the code under test. */
function bytes(text: string, encoding: Encoding): Uint8Array {
	switch (encoding) {
		case 'utf8':
			return new TextEncoder().encode(text)
		case 'utf8BOM':
			return Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)])
		case 'utf16LittleEndian':
			return Uint8Array.from([0xff, 0xfe, ...Buffer.from(text, 'utf16le')])
		case 'utf16BigEndian':
			return Uint8Array.from([0xfe, 0xff, ...Buffer.from(text, 'utf16le').swap16()])
		case 'windows1252':
			// the random alphabet holds only Latin-1 letters plus €, which Windows-1252 puts at 0x80
			return Uint8Array.from(
				[...text].map((character) => (character === '€' ? 0x80 : character.charCodeAt(0)))
			)
	}
}

/** Random text with any mix of line endings, in characters `encoding` can hold. */
const randomText = (encoding: Encoding) =>
	fc
		.array(
			fc.constantFrom(
				...'ab \t\r\néü€#*-',
				'\r\n',
				...(encoding === 'windows1252' ? [] : ['😀', '日'])
			),
			{ maxLength: 40 }
		)
		.map((characters) => characters.join(''))

const encodingAndText = fc
	.constantFrom(...ENCODINGS)
	.chain((encoding) => randomText(encoding).map((text) => ({ encoding, text })))

function isValidNonAsciiUtf8(data: Uint8Array): boolean {
	if (data.every((byte) => byte < 0x80)) return false
	try {
		new TextDecoder('utf-8', { fatal: true }).decode(data)
		return true
	} catch {
		return false
	}
}

function readError(data: number[]): TextFileReadError['reason'] | null {
	try {
		TextFile.fromData(Uint8Array.from(data))
		return null
	} catch (error) {
		return error instanceof TextFileReadError ? error.reason : null
	}
}

describe('TextFile', () => {
	test.each([
		[[0x63, 0x61, 0x66, 0xc3, 0xa9], 'utf8'],
		[[0xef, 0xbb, 0xbf, 0x63, 0x61, 0x66, 0xc3, 0xa9], 'utf8BOM'],
		[[0xff, 0xfe, 0x63, 0x00, 0x61, 0x00, 0x66, 0x00, 0xe9, 0x00], 'utf16LittleEndian'],
		[[0xfe, 0xff, 0x00, 0x63, 0x00, 0x61, 0x00, 0x66, 0x00, 0xe9], 'utf16BigEndian'],
		[[0x63, 0x61, 0x66, 0xe9], 'windows1252']
	] as [number[], Encoding][])('detects %s as %s', (data, encoding) => {
		const file = TextFile.fromData(Uint8Array.from(data))
		expect(file.text).toBe('café')
		expect(file.format.encoding).toBe(encoding)
	})

	// Foundation's `data(using: .windowsCP1252)` precomposes `e` + U+0301 into é (0xE9); editmd's file stays Windows-1252
	// (swift), where the port turned it into UTF-8 with a notice
	test('a decomposed letter Windows-1252 holds precomposed is written in Windows-1252', () => {
		const file = TextFile.fromData(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]))
		const edited = file.replacingText('café ok')
		expect([edited.format.encoding, [...edited.data]]).toEqual([
			'windows1252',
			[0x63, 0x61, 0x66, 0xe9, 0x20, 0x6f, 0x6b]
		])
	})

	test('keeps a character that looks like a second BOM', () => {
		const file = TextFile.fromData(Uint8Array.from([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x61]))
		expect(file.text.codePointAt(0)).toBe(0xfeff)
		expect([...file.replacingText(file.text + 'b').data]).toEqual([
			0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x61, 0x62
		])
	})

	test.each([
		[[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d], 'PNG header'],
		[[0x61, 0x00, 0x62], 'NUL in UTF-8'],
		[[0x01, 0x02, 0xff, 0x80], 'control bytes, not UTF-8'],
		[[0xff, 0xfe, 0x61], 'odd-length UTF-16'],
		[[0xff, 0xfe, 0x00, 0xd8, 0x61, 0x00], 'unpaired surrogate'],
		[[0xff, 0xfe, 0x00, 0x00, 0x61, 0x00], 'NUL in UTF-16']
	])('refuses binary: %j (%s)', (data) => {
		expect(readError(data)).toBe('binary')
	})

	test('refuses encodings it cannot read', () => {
		// Shift JIS: not UTF-8, and 0x81 is undefined in Windows-1252.
		expect(readError([0x82, 0xa0, 0x81, 0x40])).toBe('unknownEncoding')
		expect(new TextFileReadError('binary').message).toBe(
			"The file can't be opened. It contains binary data, not text."
		)
	})

	// 300 runs per encoding, so none rests on how a shared run count happens to split
	test.each(ENCODINGS)('untouched saves keep the bytes in %s', (encoding) => {
		fc.assert(
			fc.property(randomText(encoding), (text) => {
				const data = bytes(text, encoding)
				const file = TextFile.fromData(data)
				expect(file.text.includes('\r')).toBe(false)
				expect([...file.replacingText(file.text).data]).toEqual([...data])
			}),
			{ numRuns: 300 }
		)
	})

	test('edits keep the format', () => {
		const original = encodingAndText.chain(({ encoding, text }) =>
			randomText(encoding).map((edit) => ({ encoding, text, edit }))
		)
		fc.assert(
			fc.property(original, ({ encoding, text, edit }) => {
				const file = TextFile.fromData(bytes(text, encoding))
				const edited = file.replacingText(edit)
				expect(edited.format.encoding).toBe(file.format.encoding)
				expect(edited.conversionNotice(file)).toBeNull()

				/**
				 * Windows-1252 bytes that also form valid non-ASCII UTF-8 (é€€ is E9 80 80, UTF-8 for 退)
				 * read back as UTF-8: decode tries UTF-8 first, as editmd's Swift does; editmd's seeds 1-300
				 * never generated such a run, fast-check does, so it is carved out here and pinned below
				 */
				fc.pre(!(edited.format.encoding === 'windows1252' && isValidNonAsciiUtf8(edited.data)))

				const reread = TextFile.fromData(edited.data)
				expect(reread.text).toBe(edited.text)
				// Windows-1252 that is all ASCII reads as UTF-8, which writes the same bytes.
				const ascii = edited.data.every((byte) => byte < 0x80)
				expect(reread.format.encoding).toBe(
					ascii && edited.format.encoding === 'windows1252' ? 'utf8' : edited.format.encoding
				)
				if (reread.text.includes('\n'))
					expect(reread.format.lineEnding).toBe(file.format.lineEnding)
			}),
			{ numRuns: 300 }
		)
	})

	test('Windows-1252 bytes that are also valid UTF-8 read back as UTF-8 (inherited from editmd)', () => {
		const file = TextFile.fromData(Uint8Array.from([0x63, 0x61, 0x66, 0xe9])).replacingText('é€€')
		expect([...file.data]).toEqual([0xe9, 0x80, 0x80])
		expect(TextFile.fromData(file.data).text).toBe('退')
	})

	test('line endings come out as LF and go back in', () => {
		const encoder = new TextEncoder()
		const file = TextFile.fromData(encoder.encode('a\r\nb\r\nc\n'))
		expect(file.text).toBe('a\nb\nc\n')
		expect(file.format.lineEnding).toBe('\r\n')
		expect(new TextDecoder().decode(file.replacingText('a\nB\nc\n').data)).toBe('a\r\nB\r\nc\r\n')

		const mac = TextFile.fromData(encoder.encode('a\rb\r'))
		expect(mac.text).toBe('a\nb\n')
		expect(mac.format.lineEnding).toBe('\r')
		expect(new TextDecoder().decode(mac.replacingText('a\nB\n').data)).toBe('a\rB\r')

		expect(TextFile.fromData(encoder.encode('a\nb\r\n')).format.lineEnding).toBe('\n')
		expect(TextFile.fromData(encoder.encode('a\r\r\n')).text).toBe('a\n\n')
		expect(TextFile.fromData(encoder.encode('no breaks')).format.lineEnding).toBe('\n')
	})

	test('the most common line ending wins, not the first', () => {
		const encoder = new TextEncoder()
		expect(TextFile.fromData(encoder.encode('a\nb\r\nc\r\nd\r\n')).format.lineEnding).toBe('\r\n')
		expect(TextFile.fromData(encoder.encode('a\r\nb\nc\nd\n')).format.lineEnding).toBe('\n')
		expect(TextFile.fromData(encoder.encode('a\nb\rc\rd\r')).format.lineEnding).toBe('\r')
	})

	test('a change to line endings alone is a change', () => {
		const crlf = TextFile.fromData(new TextEncoder().encode('a\r\nb\r\n'))
		const lf = TextFile.fromData(new TextEncoder().encode('a\nb\n'))
		expect(crlf.text).toBe(lf.text)
		expect(crlf.equals(lf)).toBe(false)
	})

	test('text the encoding cannot hold is saved as UTF-8', () => {
		const file = TextFile.fromData(Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x0d, 0x0a]))
		const edited = file.replacingText('café 😀\n')
		expect(edited.format).toEqual({ encoding: 'utf8', lineEnding: '\r\n' })
		expect(new TextDecoder().decode(edited.data)).toBe('café 😀\r\n')

		const notice = edited.conversionNotice(file)
		expect(notice).toBe(
			"The file was saved as UTF-8, because it now contains characters Windows-1252 can't represent."
		)
		// Once converted, later saves stay UTF-8 and say nothing.
		expect(edited.replacingText('café\n').conversionNotice(edited)).toBeNull()
		expect(edited.replacingText('café\n').format.encoding).toBe('utf8')
	})

	test('new files are UTF-8 with LF', () => {
		const file = TextFile.fromText('a\r\nb\rc\n')
		expect(file.text).toBe('a\nb\nc\n')
		expect(new TextDecoder().decode(file.data)).toBe('a\nb\nc\n')
		expect(file.format).toEqual({ encoding: 'utf8', lineEnding: '\n' })
	})
})
