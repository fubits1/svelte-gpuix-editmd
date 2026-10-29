/**
 * extension tables standing in for macOS UTType conformance, which editmd's Swift
 * LinkPolicy and ImageLink use (`conforms(to: .text)`, `conforms(to: .image)`); Node has no UTType
 *
 * an allowlist, so an unknown extension is neither text nor image: links to it are revealed, never opened
 */

/** editmd's document types (Info.plist CFBundleDocumentTypes) */
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd', 'mkdn'])

/** extensions whose UTType conforms to public.text on macOS: plain text, markup, source, scripts */
const TEXT_EXTENSIONS = new Set([
	...MARKDOWN_EXTENSIONS,
	'txt',
	'text',
	'html',
	'htm',
	'xml',
	'json',
	'yaml',
	'yml',
	'toml',
	'csv',
	'tsv',
	'log',
	'ini',
	'rtf',
	'css',
	'js',
	'mjs',
	'cjs',
	'ts',
	'tsx',
	'jsx',
	'svelte',
	'py',
	'rb',
	'swift',
	'c',
	'h',
	'cpp',
	'go',
	'rs',
	'java',
	'sh',
	'bash',
	'zsh',
	'command'
])

/** extensions whose UTType conforms to public.image on macOS */
const IMAGE_EXTENSIONS = new Set([
	'png',
	'jpg',
	'jpeg',
	'gif',
	'webp',
	'heic',
	'heif',
	'tif',
	'tiff',
	'bmp',
	'ico',
	'svg',
	'avif'
])

function extensionOf(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1)
	const dot = name.lastIndexOf('.')
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isTextPath(path: string): boolean {
	return TEXT_EXTENSIONS.has(extensionOf(path))
}

export function isMarkdownPath(path: string): boolean {
	return MARKDOWN_EXTENSIONS.has(extensionOf(path))
}

export function isImagePath(path: string): boolean {
	return IMAGE_EXTENSIONS.has(extensionOf(path))
}
