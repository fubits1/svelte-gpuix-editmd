/// <reference types="bun" />
// `bun build.ts` (pnpm build): dist/editmd-gpuix.app through gpuix-svelte's build(), which reads the name,
// identifier, copyright and icon from standalone.ts's render() call. macOS only, as editmd: its icon is drawn in Swift.

import { build } from 'gpuix-svelte/build'
import { spawnSync } from 'node:child_process'
import { copyFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { SATTERI_ADDON } from './src/host/satteriAddon.ts'

function run(command: string, args: string[]): void {
	const step = spawnSync(command, args, { encoding: 'utf8' })
	if (step.status !== 0) {
		console.error(`${command} failed:\n${step.stderr}`)
		process.exit(1)
	}
}

if (process.platform !== 'darwin') {
	console.error('pnpm build makes the macOS app; editmd-gpuix ships for macOS only')
	process.exit(1)
}

/**
 * the steps after build() change the bundle, which would void a signature it made; Developer ID signing waits for
 * build() to take plugins or extra files (ADR-0013)
 */
if (process.env.CODESIGN_IDENTITY) {
	console.error(
		'CODESIGN_IDENTITY is set, but build.ts changes the .app after signing; unset it to sign ad hoc'
	)
	process.exit(1)
}

// editmd's icon, drawn by its scripts/make-icon.swift (editmd scripts/build.sh:28-34); build() takes the 1024 px PNG
const iconset = 'dist/AppIcon.iconset'
run('swift', ['scripts/make-icon.swift', iconset])
copyFileSync(join(iconset, 'icon_512x512@2x.png'), 'dist/AppIcon-1024.png')
rmSync(iconset, { recursive: true, force: true })

const { output } = await build({ entry: './standalone.ts' })

// satteri's addon, where src/host/satteriAddon.ts points its loader (ADR-0013)
const addon = Bun.resolveSync(
	`@bruits/satteri-${process.platform}-${process.arch}`,
	dirname(Bun.resolveSync('satteri', process.cwd()))
)
copyFileSync(addon, join(output, 'Contents', 'Resources', SATTERI_ADDON))
// editmd's Info.plist keys build() writes otherwise or not at all
const plist = join(output, 'Contents', 'Info.plist')
for (const [key, value] of [
	['LSMinimumSystemVersion', '14.0'],
	['LSApplicationCategoryType', 'public.app-category.productivity']
])
	run('plutil', ['-replace', key, '-string', value, plist])
// signed ad hoc, as editmd's scripts/build.sh does
run('codesign', ['--force', '--sign', '-', output])
console.log(`built ${output}`)
