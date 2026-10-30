/**
 * what macOS says a file is, as editmd asks it: a linked file's type read from disk with symlinks resolved, and
 * whether it conforms to public.text (LinkPolicy.swift:36-44, 69-75); a name's type from its extension, and whether
 * it conforms to public.text or public.image (LinkPolicy.swift:61, ImageLink.swift:20). Node has no UTType, so
 * JavaScript for Automation asks Foundation and AppKit; when that fails the extension tables in core/fileTypes.ts
 * answer instead
 */

import { execFileSync } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import { extensionOf, isImagePath, isMarkdownPath, isTextPath } from '../core/fileTypes.ts'
import { describeOnDisk, type LinkTarget } from '../core/linkPolicy.ts'
import { withUtf8Locale } from './locale.ts'

type Kind = { onDisk: boolean; directory: boolean; text: boolean; image: boolean }

const SCRIPT = `
ObjC.import('AppKit')
ObjC.import('CoreServices')
function run(argv) {
	const [mode, path] = argv
	const workspace = $.NSWorkspace.sharedWorkspace
	const url = $.NSURL.fileURLWithPath(path).URLByResolvingSymlinksInPath
	const onDisk = mode === 'disk' && $.NSFileManager.defaultManager.fileExistsAtPath(url.path)
	const value = (key) => {
		const out = $()
		url.getResourceValueForKeyError(out, key, null)
		return out.isNil() ? null : ObjC.unwrap(out)
	}
	let type = onDisk ? value($.NSURLTypeIdentifierKey) : null
	if (type === null) {
		const made = $.UTTypeCreatePreferredIdentifierForTag(
			$.kUTTagClassFilenameExtension,
			$(path).pathExtension,
			$()
		)
		const identifier = typeof made === 'string' ? made : ObjC.unwrap(ObjC.castRefToObject(made))
		type = typeof identifier === 'string' && identifier !== '' ? identifier : null
	}
	return JSON.stringify({
		onDisk,
		directory: onDisk && (value($.NSURLIsDirectoryKey) === true || value($.NSURLIsPackageKey) === true),
		text: type !== null && workspace.typeConformsToType(type, 'public.text'),
		image: type !== null && workspace.typeConformsToType(type, 'public.image')
	})
}`

/** asks macOS about `path`: from disk, or (`name`) from its extension alone; null when the question cannot be put */
function ask(mode: 'disk' | 'name', path: string): Kind | null {
	try {
		return JSON.parse(
			execFileSync('osascript', ['-l', 'JavaScript', '-e', SCRIPT, mode, path], {
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
				env: withUtf8Locale(process.env)
			})
		) as Kind
	} catch {
		return null
	}
}

/** a type's conformance follows from its extension alone, so each extension is asked about once */
const byExtension = new Map<string, Kind | null>()

function nameKind(path: string): Kind | null {
	const extension = extensionOf(path)
	if (!byExtension.has(extension)) byExtension.set(extension, ask('name', path))
	return byExtension.get(extension) ?? null
}

/**
 * what is on disk at `path`, following symlinks so a link named like a text file cannot stand in for an app;
 * folders, packages and bundles are directories. null when nothing is there
 */
export function describeFile(path: string): LinkTarget | null {
	const kind = ask('disk', path)
	// macOS could not be asked: the file system and the extension tables decide
	if (kind === null) return describeOnDisk(path)
	if (!kind.onDisk) return null
	return { isDirectory: kind.directory, isText: kind.text || isMarkdownFile(path) }
}

/**
 * what `path` points to is a regular file with one of editmd's markdown extensions: the target's own name and kind
 * count, as editmd reads the type of the resolved file, so a link named `.md` to a FIFO, a device or a program is not
 */
function isMarkdownFile(path: string): boolean {
	try {
		const target = realpathSync(path)
		return statSync(target).isFile() && isMarkdownPath(target)
	} catch {
		return false
	}
}

/** whether a file named `path` is text by its extension's type */
export function isTextName(path: string): boolean {
	if (isMarkdownPath(path)) return true
	return nameKind(path)?.text ?? isTextPath(path)
}

/** whether a file named `path` is an image by its extension's type */
export function isImageName(path: string): boolean {
	return nameKind(path)?.image ?? isImagePath(path)
}
