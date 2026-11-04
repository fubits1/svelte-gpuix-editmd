import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** the name build.ts gives satteri's native addon in the .app's Resources */
export const SATTERI_ADDON = 'satteri.node'

/**
 * satteri's native addon in the Resources of the .app holding `executable`, null outside one: gpuix-svelte's
 * build() embeds no addon its bundler cannot trace, and satteri's napi-rs loader looks for its own through
 * createRequire, so the build ships it there (ADR-0013)
 */
export function bundledSatteri(
	executable: string,
	exists: (path: string) => boolean
): string | null {
	const addon = join(dirname(executable), '..', 'Resources', SATTERI_ADDON)
	return exists(addon) ? addon : null
}

/**
 * satteri's loader reads NAPI_RS_NATIVE_LIBRARY_PATH when it is first imported, so standalone.ts imports this first.
 * every napi-rs loader reads that variable, @gpuix/native's too, so it is set only while satteri loads here
 */
const addon = bundledSatteri(process.execPath, existsSync)
if (addon && !process.env.NAPI_RS_NATIVE_LIBRARY_PATH) {
	process.env.NAPI_RS_NATIVE_LIBRARY_PATH = addon
	await import('satteri')
	delete process.env.NAPI_RS_NATIVE_LIBRARY_PATH
}
