import { execFileSync } from 'node:child_process'
import { urlFromClipboard } from '../core/linkInsert.ts'
import { withUtf8Locale } from './locale.ts'
import type { RunSync } from './screen.ts'

/** the environment pbcopy and pbpaste run in: the app's, with a UTF-8 locale (src/host/locale.ts) */
export const clipboardEnvironment = withUtf8Locale

const runPbpaste: RunSync = (file, args) =>
	execFileSync(file, args, {
		encoding: 'utf8',
		timeout: 2000,
		env: clipboardEnvironment(process.env)
	})

/** runs `file` with `args`, `input` on its stdin; throws when it fails */
export type WriteInput = (file: string, args: readonly string[], input: string) => void

const runPbcopy: WriteInput = (file, args, input) => {
	execFileSync(file, args, { input, timeout: 2000, env: clipboardEnvironment(process.env) })
}

/** puts `text` on the general pasteboard through pbcopy (gpuix has no clipboard API); false when it fails */
export function writeClipboard(text: string, run: WriteInput = runPbcopy): boolean {
	try {
		run('/usr/bin/pbcopy', [], text)
		return true
	} catch {
		return false
	}
}

/**
 * the pasteboard's text when it is a web or mail address, as editmd's Add Link sheet prefills its field
 * (EditorWindowController.swift:124,144-150); gpuix has no clipboard API, so it asks pbpaste. null when
 * there is none or pbpaste fails
 */
export function readClipboardUrl(run: RunSync = runPbpaste): string | null {
	try {
		return urlFromClipboard(run('/usr/bin/pbpaste', []))
	} catch {
		return null
	}
}
