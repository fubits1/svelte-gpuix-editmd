/**
 * editmd's scripted modes (`Headless.swift`) that need no window: the bytes Save writes for an
 * untouched file, and the text the port saves for an edited one
 */

import { readFileSync } from 'node:fs'
import { TextFile } from '../core/textFile.ts'
import type { Launch } from './launch.ts'

/** `editmd --roundtrip FILE`: what Save writes if nothing was changed */
export function roundtrip(path: string): Uint8Array {
	return TextFile.fromData(readFileSync(path)).data
}

/**
 * `editmd --normalize FILE` prints editmd's serializer output; the port edits Slices of the source and
 * has no serializer (ADR-0003), so this is the text as loaded, line endings as LF
 */
export function normalize(path: string): string {
	return TextFile.fromData(readFileSync(path)).text
}

export type HeadlessIo = {
	stdout(chunk: string | Uint8Array): void
	stderr(line: string): void
}

export const HEADLESS_IO: HeadlessIo = {
	stdout: (chunk) => process.stdout.write(chunk),
	stderr: (line) => process.stderr.write(line)
}

/**
 * runs a launch that needs no window and resolves to its exit code, or null for one that opens a window.
 * `--snapshot` and `--selftest` render through GPUI's headless renderer, loaded only for them
 */
export async function runHeadless(launch: Launch, io: HeadlessIo): Promise<number | null> {
	if (launch.kind === 'open' || launch.kind === 'untitled' || launch.kind === 'report-edit') {
		return null
	}
	try {
		if (launch.kind === 'roundtrip') io.stdout(roundtrip(launch.path))
		else if (launch.kind === 'normalize') io.stdout(normalize(launch.path))
		else if (launch.kind === 'snapshot') {
			const { snapshot } = await import('./snapshot.ts')
			io.stdout(`${await snapshot(launch)}\n`)
		} else {
			const { selfTest } = await import('./selftest.ts')
			return (await selfTest(launch.path, (line) => io.stdout(`${line}\n`))) ? 0 : 1
		}
		return 0
	} catch (error) {
		io.stderr(`editmd-gpuix: ${error instanceof Error ? error.message : String(error)}\n`)
		return 1
	}
}
