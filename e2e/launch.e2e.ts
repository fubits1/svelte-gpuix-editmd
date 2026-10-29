/**
 * launching: editmd opens an untitled window when it starts with no file (AppDelegate.swift:13-15), and its
 * scripted modes run without one (Headless.swift)
 *
 * run: pnpm --dir . exec gpuix-svelte e2e/launch.e2e.ts (unsandboxed: it opens a real window)
 * the app's support folder lives in a temp folder, so nothing reaches the real one
 */

import { spawnSync } from 'node:child_process'
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { launch } from 'gpuix-svelte/automation'
import { paletteFor } from '../src/app/palette.ts'
import { decodePng, type Pixels } from '../src/host/png.ts'
import {
	check,
	finish,
	agentsIn,
	GPUIX_BIN,
	openEditor,
	painted,
	pause,
	reaches
} from './support.ts'

const folder = mkdtempSync('/tmp/eg-launch-')
const support = join(folder, 'support')
const app = await launch({
	entry: 'standalone.ts',
	args: [],
	env: { EDITMD_GPUIX_SUPPORT: support }
})
try {
	// its field is open from the load, as editmd focuses its editor (main.ts:80-84), and paints no text of its own yet
	let fields = -1
	let shownLines = ''
	const startsWriting = await reaches(async () => {
		fields = await app.getByTestId('block-editor').count()
		shownLines = (await painted(app))
			.split('\n')
			.filter((line) => line !== '')
			.join('\n')
		return fields === 1 && shownLines === 'Start writing…'
	}, 10_000)
	check(
		`no file argument opens a window on an empty untitled document, its field open and showing “Start writing…” (field ${fields}, painted ${JSON.stringify(shownLines)})`,
		startsWriting
	)
} finally {
	await app.close()
}

/**
 * a window on a file with front matter: editmd's box becomes editable in place (frontmatter.ts:20-23), so opening it
 * leaves the page where it was. headlessly no field takes focus, so only a window shows the scroll its focus caused
 * (the e-frontmatter-edit target: the page about 16px up, 32 in the 2x shot)
 */
// render.md, as the target shot: a page taller than the window, which can scroll
const frontmatterFile = join(folder, 'render.md')
copyFileSync('test/fixtures/parity/render.md', frontmatterFile)
copyFileSync('test/fixtures/parity/pic.png', join(folder, 'pic.png'))
copyFileSync('test/fixtures/parity/badge.png', join(folder, 'badge.png'))
const frontmatterApp = await openEditor(frontmatterFile, folder)
try {
	// the images and the diagram size themselves over the first frames
	await pause(800)
	const closedTop = (await frontmatterApp.getByTestId('frontmatter-box-0').bounds()).y
	await frontmatterApp.getByTestId('block-0').click()
	await frontmatterApp.getByTestId('block-editor-card').waitFor()
	// a scroll the focus starts lands over the next frames
	await pause(500)
	const openTop = (await frontmatterApp.getByTestId('block-editor-card').bounds()).y
	check(
		`opening the front matter leaves its box where it was (top closed ${closedTop}, open ${openTop})`,
		Math.abs(openTop - closedTop) < 0.5
	)
} finally {
	await frontmatterApp.close()
}

/**
 * `editmd-gpuix ARGS` as a shell runs it, the support folder kept in the temp folder, and only the coding agents working
 * in the temp folder count (`agentsIn`), so `--selftest`'s attribution checks hold on any machine
 */
function cli(args: string[]) {
	return spawnSync(process.execPath, [GPUIX_BIN, 'standalone.ts', ...args], {
		encoding: 'utf8',
		timeout: 120_000,
		env: { ...process.env, EDITMD_GPUIX_SUPPORT: support, ...agentsIn(folder) }
	})
}

/** a pixel's colour as `#rrggbb`, its coordinates in the picture's own pixels */
function colourAt({ width, data }: Pixels, x: number, y: number): string {
	const at = (y * width + x) * 4
	return `#${[data[at]!, data[at + 1]!, data[at + 2]!].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/**
 * `--snapshot FILE OUT.png [--dark] [--width N]` (Headless.swift:116-135): the page as the window shows it, N wide
 * (860 by default), as tall as the page, in one PNG at OUT, whose path it prints. 2x, as editmd's on a Retina screen.
 * a page taller than the headless renderer's 538px still comes out whole, light or dark, its corner the page's
 * background
 */
const tall = join(folder, 'tall.md')
writeFileSync(
	tall,
	Array.from({ length: 40 }, (_, n) => `Paragraph ${n + 1} of the tall page.`).join('\n\n') + '\n'
)
const lightOut = join(folder, 'light.png')
const darkOut = join(folder, 'dark.png')
const light = cli(['--snapshot', tall, lightOut, '--width', '700'])
const dark = cli(['--snapshot', tall, darkOut, '--dark'])
const shot = (path: string) => (existsSync(path) ? decodePng(readFileSync(path)) : null)
const lightShot = shot(lightOut)
const darkShot = shot(darkOut)
check(
	`--snapshot exits 0 and prints the PNG's path (light: exit ${light.status} ${JSON.stringify(light.stdout.trim())} ${JSON.stringify(light.stderr.trim().split('\n').at(-1))}; dark: exit ${dark.status} ${JSON.stringify(dark.stdout.trim())})`,
	light.status === 0 &&
		light.stdout.trim() === lightOut &&
		dark.status === 0 &&
		dark.stdout.trim() === darkOut &&
		!`${light.stderr}${dark.stderr}`.includes('not available in this port')
)
check(
	`--snapshot is N wide at 2x (860 by default) and taller than the 538px headless viewport (light ${lightShot?.width}×${lightShot?.height}, dark ${darkShot?.width}×${darkShot?.height})`,
	lightShot?.width === 1400 &&
		darkShot?.width === 1720 &&
		(lightShot?.height ?? 0) > 2 * 538 &&
		(darkShot?.height ?? 0) > 2 * 538
)
const lightCorner = lightShot && colourAt(lightShot, 4, lightShot.height - 4)
const darkCorner = darkShot && colourAt(darkShot, 4, darkShot.height - 4)
check(
	`--snapshot paints the page's background, light by default and dark with --dark (${lightCorner}, ${darkCorner})`,
	lightCorner === paletteFor('light').background && darkCorner === paletteFor('dark').background
)

/** the last paragraph sits below the first viewport: its ink is in the picture, on rows only a scrolled shot covers */
function inkRows(pixels: Pixels, background: string): number[] {
	const rows: number[] = []
	for (let y = 0; y < pixels.height; y++) {
		for (let x = 0; x < pixels.width; x += 2) {
			if (colourAt(pixels, x, y) !== background) {
				rows.push(y)
				break
			}
		}
	}
	return rows
}
const lastInk = lightShot ? Math.max(...inkRows(lightShot, paletteFor('light').background)) : 0
check(
	`--snapshot holds the whole page: text paints below the first 538px viewport (last ink row ${lastInk} at 2x)`,
	lastInk > 2 * 538
)

const missing = cli(['--snapshot', join(folder, 'missing.md'), join(folder, 'missing.png')])
check(
	`--snapshot of a file that is not there says why on stderr and exits 1 (${JSON.stringify(missing.stderr.trim().split('\n').at(-1))})`,
	missing.status === 1 &&
		/^editmd-gpuix: ENOENT/m.test(missing.stderr) &&
		!existsSync(join(folder, 'missing.png'))
)

/**
 * `--selftest FILE` (Headless.swift:11, SelfTest.swift): FILE opened, edited and saved through the app, one
 * `ok`/`FAIL` line per check, exit 1 on any failure. FILE is overwritten, so it runs on a scratch copy of editmd's
 * own fixture, whose text its first checks expect (SelfTest.swift:48-50); its scratch folders go next to FILE and are
 * removed afterwards
 */
const selftestFolder = join(folder, 'selftest')
mkdirSync(selftestFolder)
const sample = join(selftestFolder, 'sample.md')
copyFileSync('test/fixtures/editmd/sample.md', sample)
const selftest = cli(['--selftest', sample])
const lines = selftest.stdout.split('\n').filter((line) => line !== '')
const failing = lines.filter((line) => !line.startsWith('ok   '))
check(
	`--selftest on a copy of editmd's sample.md exits 0 with every line ok (exit ${selftest.status}, ${lines.length} lines${failing.length > 0 ? `; not ok: ${failing.join(' / ')}` : ''}${selftest.status === 0 ? '' : `; stderr ${JSON.stringify(selftest.stderr.trim().split('\n').at(-1))}`})`,
	selftest.status === 0 && lines.length >= 40 && failing.length === 0
)
check(
	`--selftest leaves no scratch folder or file behind next to FILE (${readdirSync(selftestFolder).join(', ')})`,
	readdirSync(selftestFolder).join(',') === 'sample.md'
)

// a FILE that is not editmd's sample breaks its expectations: those checks say FAIL, and the run exits 1
const plain = join(selftestFolder, 'plain.md')
writeFileSync(plain, '# Heading one\n\nNo front matter here.\n')
const broken = cli(['--selftest', plain])
check(
	`--selftest prints FAIL for a broken expectation and exits 1 (exit ${broken.status}; ${broken.stdout
		.split('\n')
		.filter((line) => line.startsWith('FAIL'))
		.join(' / ')})`,
	broken.status === 1 && broken.stdout.includes('FAIL front matter survives the save\n')
)

/**
 * a second launch on a file a window already has: that window comes forward, and the second process exits 0 with no
 * window of its own, as editmd brings a document's window forward instead of opening it twice
 */
const twiceFile = join(folder, 'twice.md')
writeFileSync(twiceFile, '# Twice\n')
const first = await openEditor(twiceFile, folder)
try {
	// the first window listens on its socket a moment after its Block paints
	await pause(500)
	const second = spawnSync(process.execPath, [GPUIX_BIN, 'standalone.ts', twiceFile], {
		env: { ...process.env, EDITMD_GPUIX_SUPPORT: support },
		encoding: 'utf8',
		timeout: 20_000
	})
	const firstStillThere = (await first.getByTestId('block-0').count()) === 1
	check(
		`a second launch on a file a window has exits 0 without a window, and the first window stays (exit ${second.status}${second.error ? `, ${second.error.message}` : ''})`,
		second.status === 0 && second.error === undefined && firstStillThere
	)
} finally {
	await first.close().catch(() => {})
}

rmSync(folder, { recursive: true, force: true })
finish('launch')
