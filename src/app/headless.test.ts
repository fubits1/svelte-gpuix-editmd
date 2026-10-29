import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { normalize, roundtrip, runHeadless } from './headless.ts'

const fileWith = (bytes: Uint8Array) => {
	const path = join(mkdtempSync(join(tmpdir(), 'eg-headless-')), 'note.md')
	writeFileSync(path, bytes)
	return path
}

// Windows-1252 é (0xE9) and CRLF, so a decode-and-encode that loses the format shows
const WINDOWS_1252_CRLF = Uint8Array.from([
	0x43, 0x61, 0x66, 0xe9, 0x0d, 0x0a, 0x2a, 0x20, 0x61, 0x0d, 0x0a
])

describe('headless modes', () => {
	// editmd `Headless.swift:105-106`: what Save writes for the untouched file
	test('roundtrip gives the untouched file back byte for byte', () => {
		expect(Buffer.from(roundtrip(fileWith(WINDOWS_1252_CRLF)))).toEqual(
			Buffer.from(WINDOWS_1252_CRLF)
		)
	})

	// editmd prints its serializer's markdown; the port has no serializer, so it prints the text it would save
	test('normalize prints the document text, with LF line endings', () => {
		expect(normalize(fileWith(WINDOWS_1252_CRLF))).toBe('Café\n* a\n')
	})

	// editmd `Headless.swift:64-73`: the result on stdout and exit 0, or "editmd: <error>" on stderr and exit 1
	test('a headless launch writes its result to stdout, or the error to stderr, and says how to exit', async () => {
		const out: (string | Uint8Array)[] = []
		const err: string[] = []
		const io = {
			stdout: (chunk: string | Uint8Array) => out.push(chunk),
			stderr: (line: string) => err.push(line)
		}
		const path = fileWith(WINDOWS_1252_CRLF)

		expect(await runHeadless({ kind: 'roundtrip', path }, io)).toBe(0)
		expect(Buffer.from(out[0] as Uint8Array)).toEqual(Buffer.from(WINDOWS_1252_CRLF))
		expect(await runHeadless({ kind: 'normalize', path }, io)).toBe(0)
		expect(out[1]).toBe('Café\n* a\n')
		expect(await runHeadless({ kind: 'roundtrip', path: `${path}.missing` }, io)).toBe(1)
		expect(err[0]).toMatch(/^editmd-gpuix: ENOENT: no such file or directory/)
		expect(await runHeadless({ kind: 'open', path, title: 'note.md' }, io)).toBeNull()
	})
})
