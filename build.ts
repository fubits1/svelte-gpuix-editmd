/// <reference types="bun" />
// `bun build.ts` (npm run build): compiles standalone.ts into one executable for the platform it runs on.

import type { BunPlugin } from 'bun'
import { load_module, load_svelte, resolve_native_cjs, resolve_svelte } from 'gpuix-svelte/plugin'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

const conditions = ['custom-renderer', 'production']
const outfile = process.platform === 'win32' ? 'dist/app.exe' : 'dist/app'

// A `.svelte` import that misses the plugin silently becomes a file asset, so count what went through it.
let components = 0
const plugin: BunPlugin = {
	name: 'gpuix-svelte',
	setup(build) {
		build.onResolve({ filter: /^@gpuix\/native$/ }, resolve_native_cjs)
		build.onResolve({ filter: /^svelte(\/|$)/ }, resolve_svelte(conditions))
		build.onLoad({ filter: /\.svelte\.[jt]s$/ }, load_module)
		build.onLoad({ filter: /\.svelte$/ }, (args) => {
			components++
			return load_svelte(args)
		})
	}
}

/**
 * satteri's napi-rs loader picks the addon through `createRequire(import.meta.url)`, which Bun.build
 * cannot trace, so the binary ships without it ("Cannot find module '@bruits/satteri-darwin-arm64'",
 * spike S2). Swapping `requireNative()` for a static import of the host's `.node` file lets Bun embed it
 */
const satteriNative: BunPlugin = {
	name: 'satteri-native',
	setup(build) {
		build.onLoad({ filter: /[\\/]satteri[\\/]index\.js$/ }, async (args) => {
			const addonPackage = `@bruits/satteri-${process.platform}-${process.arch}`
			const manifest = Bun.resolveSync(`${addonPackage}/package.json`, dirname(args.path))
			const { main } = await Bun.file(manifest).json()
			const addonPath = join(dirname(manifest), main)
			const source = await Bun.file(args.path).text()

			if (!source.includes('nativeBinding = requireNative()')) {
				throw new Error('satteri-native: requireNative() call not found, satteri loader changed')
			}

			const contents =
				`import satteriAddon from ${JSON.stringify(addonPath)};\n` +
				source.replace('nativeBinding = requireNative()', 'nativeBinding = satteriAddon')

			return { contents, loader: 'js' }
		})
	}
}

const result = await Bun.build({
	entrypoints: ['./standalone.ts'],
	target: 'bun',
	conditions,
	define: { 'process.env.NODE_ENV': '"production"' },
	minify: true,
	plugins: [plugin, satteriNative],
	throw: false,
	compile: {
		outfile,
		autoloadBunfig: false,
		autoloadDotenv: false,
		...(process.platform === 'win32' && { windows: { hideConsole: true } })
	}
})

if (!result.success || components === 0) {
	for (const log of result.logs) console.error(log)
	if (components === 0) console.error('no .svelte file went through the plugin')
	process.exit(1)
}
console.log(`built ${outfile}`)

/**
 * `bun build.ts --app` (macOS): wraps the binary as dist/editmd-gpuix.app with Resources/Info.plist and signs it ad
 * hoc, as editmd's scripts/build.sh does. the plist leaves editmd's document types out on purpose: Finder hands a
 * `.app` its file through an Apple Event gpuix does not handle (gap G6), so declaring them would offer the app for
 * files it cannot open
 */
if (process.argv.includes('--app') && process.platform === 'darwin') {
	const bundle = 'dist/editmd-gpuix.app'
	const executable = join(bundle, 'Contents', 'MacOS', 'editmd-gpuix')
	rmSync(bundle, { recursive: true, force: true })
	mkdirSync(dirname(executable), { recursive: true })
	copyFileSync(outfile, executable)
	chmodSync(executable, 0o755)
	copyFileSync('Resources/Info.plist', join(bundle, 'Contents', 'Info.plist'))
	// editmd's icon, drawn by its scripts/make-icon.swift and packed by iconutil (editmd scripts/build.sh:28-34)
	const iconset = 'dist/AppIcon.iconset'
	rmSync(iconset, { recursive: true, force: true })
	for (const [command, args] of [
		['swift', ['scripts/make-icon.swift', iconset]],
		[
			'iconutil',
			['-c', 'icns', iconset, '-o', join(bundle, 'Contents', 'Resources', 'AppIcon.icns')]
		]
	] as const) {
		mkdirSync(join(bundle, 'Contents', 'Resources'), { recursive: true })
		const step = spawnSync(command, args, { encoding: 'utf8' })
		if (step.status !== 0) {
			console.error(`${command} failed:\n${step.stderr}`)
			process.exit(1)
		}
	}
	const signing = spawnSync('codesign', ['--force', '--sign', '-', bundle], { encoding: 'utf8' })
	if (signing.status !== 0) {
		console.error(`codesign failed:\n${signing.stderr}`)
		process.exit(1)
	}
	console.log(`built ${bundle}`)
}
