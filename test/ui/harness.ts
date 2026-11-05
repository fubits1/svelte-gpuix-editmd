/**
 * the bindings more than one area of the headless UI suite shares: helpers, recorders, folders, the mounted window.
 * a value made by a side effect or read from earlier state is an `export let`; each `init*` runs from the section that
 * needs it
 */
import './testIsolation.ts'
import {
	bounds,
	click_at,
	click_test_id,
	find_all,
	find_test_id,
	mount_headless,
	mouse_move,
	painted_highlights,
	press,
	pump,
	screenshot,
	settle,
	type,
	type TreeNode,
	wait,
	wait_for
} from 'gpuix-svelte/test'
import { window_size } from 'gpuix-svelte'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import App from '../../App.svelte'
import { diagramOf } from '../../src/app/diagrams.ts'
import { findController } from '../../src/app/find.svelte.ts'
import { reportEdit } from '../../src/app/reportEdit.ts'
import { type ThemeController, themeController } from '../../src/app/theme.svelte.ts'
import { LegendPreference } from '../../src/host/legendPreference.ts'
import { decodePng, type Pixels } from '../../src/host/png.ts'
import { RecentFiles } from '../../src/host/recent.ts'
import DocumentView from '../../src/ui/DocumentView.svelte'
import { diagramImageSrc } from '../../src/ui/DocumentView/Views/diagramImage.svelte.ts'
import {
	documentController,
	type OpenOptions
} from '../../src/ui/DocumentView/controller.svelte.ts'
import type { ListItem } from '../../src/engine/blocks.ts'

type Mounted = ReturnType<typeof mount_headless>

/**
 * what every window in this suite is given instead of the machine's own: no network for image sizes, a size fetch
 * that never answers, as one still on its way when a check reads the window
 */
export const isolated = {
	fetchImage: () => new Promise<Uint8Array>(() => {})
}

export let remoteServer: Server
export let remote: string

export function initRemoteServer(): void {
	remoteServer = createServer((_request, response) => void response.writeHead(404).end())
}

export function initRemote(): void {
	const remoteAddress = remoteServer.address()
	remote = `http://127.0.0.1:${typeof remoteAddress === 'object' && remoteAddress ? remoteAddress.port : 0}`
}

export let stopTheme: () => void
export let view: Mounted

export function initView(): void {
	stopTheme = themeController.start()
	view = mount_headless(DocumentView, { width: 800, height: 538 })
}

export let directory: string

export function initDirectory(): void {
	directory = mkdtempSync(join(tmpdir(), 'editmd-gpuix-ui-'))
}

export let namingDirectory: string

export function initNamingDirectory(): void {
	namingDirectory = mkdtempSync(join(tmpdir(), 'eg-naming-'))
}

/**
 * the `src` a diagram drawn from `source` in `palette` paints with: its SVG as a base64 data: URL, null when it
 * cannot be drawn
 */
export function getDiagramSrc(
	source: string,
	palette = themeController.mermaidPalette
): string | null {
	const diagram = diagramOf(source, palette)
	if (diagram.kind !== 'diagram') return null

	return diagramImageSrc(diagram)
}

/** a native element's prop (e.g. an <img>'s src): the tree JSON carries them as `customProps`, typed in gpuix-test.d.ts */
export function getProp(testId: string, name: string) {
	return find_test_id(testId)?.customProps?.[name]
}

/** what a <markdown> of mono lines paints its code spans in (`monoLinesTheme`): colour, text size and line height */
export function getMonoLook(testId: string) {
	const theme = getProp(testId, 'theme')
	const metrics = getField(theme, 'metrics')
	return [
		getField(theme, 'codeText'),
		getField(metrics, 'mdTextSize'),
		getField(metrics, 'mdLineHeight')
	]
}

/** one PNG chunk: length, type, data and the CRC over type and data */
function createPngChunk(chunkType: string, data: Uint8Array): Buffer {
	const typeAndData = Buffer.concat([Buffer.from(chunkType, 'latin1'), data])
	const chunk = Buffer.alloc(typeAndData.length + 8)
	chunk.writeUInt32BE(data.length, 0)
	typeAndData.copy(chunk, 4)
	chunk.writeUInt32BE(crc32(typeAndData), typeAndData.length + 4)
	return chunk
}

/** a real, decodable black PNG, so GPUI paints and hit-tests it as it would a user's image */
export function createPng(width: number, height: number): Buffer {
	const header = Buffer.alloc(13)
	header.writeUInt32BE(width, 0)
	header.writeUInt32BE(height, 4)
	// 8-bit RGB, default compression, filter and interlace
	header.set([8, 2, 0, 0, 0], 8)
	// each row is a filter byte (0, none) and three zero bytes per pixel
	const pixels = deflateSync(Buffer.alloc(height * (1 + width * 3)))
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		createPngChunk('IHDR', header),
		createPngChunk('IDAT', pixels),
		createPngChunk('IEND', new Uint8Array())
	])
}

export let saveDirectory: string

export function initSaveDirectory(): void {
	saveDirectory = mkdtempSync(join(tmpdir(), 'eg-save-'))
}

export let fileImageDirectory: string

export function initFileImageDirectory(): void {
	fileImageDirectory = mkdtempSync(join(tmpdir(), 'eg-file-image-'))
}

/**
 * a click on a Block's first characters, where its leading link run paints: <markdown> gives its runs no test
 * ids, so the click lands by position and GPUI's hit testing finds the run
 */
export function clickLinkIn(testId: string, modifiers?: string): void {
	const box = bounds(find_test_id(testId) ?? 0)
	if (!box) throw new Error(`no painted ${testId}`)

	// 4px in, so even a one-letter link run is under the pointer
	click_at(box.x + 4, box.y + box.height / 2, { modifiers })
}

export let app: Mounted

export function setApp(value: Mounted): void {
	app = value
}

/** unmounts the window and mounts App again, 538px high, in `theme` when given */
export async function remount({
	theme,
	width = 800
}: { theme?: ThemeController; width?: number } = {}): Promise<void> {
	await app.unmount()
	app = mount_headless(App, { width, height: 538, ...(theme && { props: { theme } }) })
}

/** writes `content` to the file `name` in `folder` and opens it in the window, returning its path */
export function openFixture(
	folder: string,
	name: string,
	content: string | Uint8Array,
	options?: OpenOptions
): string {
	const path = join(folder, name)
	writeFileSync(path, content)
	documentController.open(path, options)
	return path
}

export const linkRuns: [string, string[]][] = []
export let linkDirectory: string
export let linkOptions: OpenOptions

export function initLinkRecorder(): void {
	linkDirectory = mkdtempSync(join(tmpdir(), 'eg-link-'))
	// the File menu's effects too, so nothing a link test could reach opens a window or writes the real Open Recent
	linkOptions = {
		...isolated,
		run: (command: string, args: string[]) => void linkRuns.push([command, args]),
		openInEditor: (linkPath: string) => void linkRuns.push(['openInEditor', [linkPath]]),
		openWindow: (windowPath: string | null) =>
			void linkRuns.push(['openWindow', [windowPath ?? '']]),
		choosePaths: () => Promise.resolve(null),
		recentFiles: new RecentFiles(join(linkDirectory, 'recent.json'))
	}
}

/** clicks `testId` only when it is in the tree, so a dialog that never opened fails its checks, not the run */
export function clickIfPresent(testId: string): void {
	if (find_test_id(testId)) click_test_id(testId)
}

export let badgeDirectory: string

export function initBadgeDirectory(): void {
	badgeDirectory = mkdtempSync(join(tmpdir(), 'eg-badge-'))
}

/** a native prop's value as the tree carries it, e.g. the `theme` object a <markdown> holds */
type PropValue = NonNullable<TreeNode['customProps']>[string]

/** one key of a native prop object (`theme.metrics`), undefined when the value is no object or lacks it */
export function getField(value: PropValue | undefined, key: string): PropValue | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined

	return value[key]
}

// GPUI lays out on the 2x display's half-pixel grid, so 26.4px paints at 26.5 and 13.2px at 13
export const toHalfPixels = (length: number) => Math.round(length * 2) / 2

// thirty numbered paragraphs, enough to push what follows them below the 538px window's fold
export const filler = Array.from(
	{ length: 30 },
	(_value, index) => `Filler paragraph ${index + 1}.`
)

/** waits `milliseconds`, then settles what the window did meanwhile */
export async function settleAfter(milliseconds: number): Promise<void> {
	await wait(milliseconds)
	settle()
}

/**
 * what Find reports and what native paints: the match count, the active match (0-based, like `activeIndex`)
 * and which painted wash is the active one. the counts come from the paint, a 100ms poll behind it, and a
 * query with no match turns the field red only on the second empty read, so a stale frame does not flash it
 */
export async function loadFindState() {
	await settleAfter(350)
	return [
		findController.total,
		findController.active,
		painted_highlights().findIndex(({ active }) => active)
	]
}

/** opens Find and, once its field has the keys, types `query` over the query cmd-f selects there */
export async function findQuery(query: string) {
	press('cmd-f')
	await wait(100)
	pump()
	typeQuery(query)
	return loadFindState()
}

/** a `#rrggbb` colour's red, green and blue, 0-255 */
export const toChannels = (hex: string) =>
	[1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))

/** whether two `#rrggbb` colours are within `tolerance` on every channel */
export function isNear(colour: string, other: string, tolerance = 16): boolean {
	const [colourChannels, otherChannels] = [toChannels(colour), toChannels(other)]
	return colourChannels.every(
		(value, index) => Math.abs(value - otherChannels[index]!) <= tolerance
	)
}

/** the string a <text> element paints: it lives on its child text node, not on the node carrying the test id */
export function getText(testId: string) {
	return find_test_id(testId)?.children?.[0]?.text
}

/** `wait_for` that gives up without throwing, so a condition that never holds fails its check rather than the run */
export async function waitUntil(condition: () => boolean, label: string): Promise<void> {
	await wait_for(condition, { label }).catch(() => null)
}

/** clears a field's text key by key: the field has no selection API (gap G1), so its prefill cannot be selected */
export function retype(previous: string, next: string): void {
	for (let index = 0; index < previous.length; index++) type('backspace')
	for (const key of next) type(key)
}

export let openDirectory: string

export function initOpenDirectory(): void {
	openDirectory = mkdtempSync(join(tmpdir(), 'eg-open-'))
}

export let menuDirectory: string
export const menuRuns: [string, string[]][] = []
export const menuWindows: (string | null)[] = []
export const menuPicks: string[][] = []
export let menuRecent: RecentFiles
/** what Add Link's sheet reads as the pasteboard's URL: this test's, so the real clipboard is never read */
let menuClipboardUrl: string | null = null
export let menuOptions: OpenOptions & { socketsDirectory: string }

export function setMenuClipboardUrl(value: string | null): void {
	menuClipboardUrl = value
}

export function initMenuRecorders(): void {
	menuDirectory = mkdtempSync(join(tmpdir(), 'eg-menu-'))
	menuRecent = new RecentFiles(join(menuDirectory, 'recent.json'))
	menuOptions = {
		...isolated,
		socketsDirectory: join(menuDirectory, 's'),
		run: (command: string, args: string[]) => void menuRuns.push([command, args]),
		openInEditor: (linkPath: string) => void menuRuns.push(['openInEditor', [linkPath]]),
		chooseFolder: () => Promise.resolve(menuDirectory),
		closeWindow: () => void menuRuns.push(['closeWindow', []]),
		setWindowTitle: (title: string) => void menuRuns.push(['setWindowTitle', [title]]),
		writePrintable: (_text: string, title: string) => join(menuDirectory, `${title}.html`),
		openWindow: (windowPath: string | null) => void menuWindows.push(windowPath),
		choosePaths: () => Promise.resolve(menuPicks.shift() ?? null),
		recentFiles: menuRecent,
		// Window > Minimize, Zoom and Bring All to Front record instead of touching the test window
		minimizeWindow: () => void menuRuns.push(['minimize', []]),
		zoomWindow: () => void menuRuns.push(['zoomWindow', []]),
		activateWindow: () => void menuRuns.push(['activateWindow', []]),
		// View > Enter Full Screen records instead of taking the test window full screen
		toggleFullScreen: () => void menuRuns.push(['toggleFullScreen', []]),
		readClipboardUrl: () => menuClipboardUrl,
		// the legend's minimized state lives in this test's folder, never the real support folder
		legendPreference: new LegendPreference(join(menuDirectory, 'legend.json')),
		// a highlight's time in one locale and zone, so its tooltip reads the same on any machine
		timeFormat: { locale: 'en-US', timeZone: 'UTC' }
	}
}

/** `read(index)` for each row `${prefix}-${index}` in the tree, top to bottom */
export function getRows<Row>(prefix: string, read: (index: number) => Row): Row[] {
	const rows: Row[] = []
	for (let index = 0; find_test_id(`${prefix}-${index}`); index++) rows.push(read(index))
	return rows
}

/** the titles the command palette lists, in order */
export const getPaletteTitles = () =>
	getRows('palette-title', (index) => getText(`palette-title-${index}`) ?? '')

/** types `query` into the focused field one key per `type`, so it stays literal */
export function typeQuery(query: string): void {
	for (const key of query) type(key === ' ' ? 'space' : key)
}

export let untitledFolder: string

export function initUntitledFolder(): void {
	untitledFolder = mkdtempSync(join(tmpdir(), 'eg-untitled-'))
}

/**
 * every file in `folder` with its modification time; the sockets folder is left out, since the previous file's
 * listener closing changes it, not a save
 */
export const snapshotFolder = (folder: string) =>
	readdirSync(folder)
		.sort()
		.filter((name) => statSync(join(folder, name)).isFile())
		.map((name) => [name, statSync(join(folder, name)).mtimeMs])

export let menuFolderBefore: ReturnType<typeof snapshotFolder>

export function initMenuFolderBefore(): void {
	menuFolderBefore = snapshotFolder(menuDirectory)
}

/** the text of the tip `tipId` once the pointer has rested on `testId` past the tip's delay, null when none shows */
export async function loadTipAfterHover(testId: string, tipId: string): Promise<string | null> {
	const node = find_test_id(testId)
	if (!node) return `no ${testId}`

	// a node scrolled out of the window cannot be hovered, which fails the check rather than the run
	try {
		mouse_move(node)
	} catch (error) {
		return error instanceof Error ? error.message : String(error)
	}
	await settleAfter(400)
	return getText(tipId) ?? null
}

/** the text of the tip `tipId` once the pointer has rested at the window point `point`, null when none shows */
export async function loadTipAt(
	point: { x: number; y: number },
	tipId: string
): Promise<string | null> {
	mouse_move(point)
	await settleAfter(400)
	return getText(tipId) ?? null
}

/** the window point at the centre of `testId`, where `mouse_move` puts the pointer; off the window when unpainted */
export function getCentre(testId: string): { x: number; y: number } {
	const box = bounds(find_test_id(testId) ?? 0)
	return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : { x: -1, y: -1 }
}

/**
 * how far the tip `tipId` starts from where a native tip starts for the pointer at `point`: below-right of it, past
 * the arrow cursor's body (NSCursor.arrow paints 9.3pt right of and 15.7pt below its hot spot, measured on this
 * macOS), moved back inside a 4px margin at the window's edges; [0, 0] when it starts there, within a pixel
 */
export function getTipOffset(
	point: { x: number; y: number },
	tipId: string
): [number, number] | null {
	const box = bounds(find_test_id(tipId) ?? 0)
	if (!box) return null

	const startX = Math.min(point.x + 9, window_size.width - 4 - box.width)
	const startY = Math.min(point.y + 16, window_size.height - 4 - box.height)
	const miss = (value: number) => (Math.abs(value) <= 1 ? 0 : Math.round(value))
	return [miss(box.x - startX), miss(box.y - startY)]
}

/**
 * the window point at the middle of the first painted box of the washed run `text` inside `testId`, or of its first
 * washed run when `text` is left out; null for none
 */
export function getWashPoint(testId: string, text?: string): { x: number; y: number } | null {
	const block = bounds(find_test_id(testId) ?? 0)
	if (!block) return null

	const rect = painted_highlights()
		.filter(
			(wash) =>
				wash.active && (text === undefined || wash.text.slice(wash.start, wash.end) === text)
		)
		.flatMap((wash) => wash.rects)
		.find(
			(each) =>
				each.x >= block.x &&
				each.y >= block.y &&
				each.x + each.width <= block.x + block.width + 1 &&
				each.y + each.height <= block.y + block.height + 1
		)
	return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null
}

export const MENU_TITLES = ['File', 'Edit', 'Format', 'View', 'Window', 'Help']

/** what a panel paints, row by row: an item's title and key glyphs, or `separator` */
export function getPanelRows(prefix: 'menu' | 'submenu' = 'menu'): (string | [string, string])[] {
	return getRows(`${prefix}-row`, (index) => {
		const title = getText(`${prefix}-item-title-${index}`)
		return title === undefined
			? 'separator'
			: [title, getText(`${prefix}-item-keys-${index}`) ?? '']
	})
}

/** the row of the open panel titled `title`, -1 when there is none */
export function getRowIndex(title: string, prefix: 'menu' | 'submenu' = 'menu'): number {
	return getPanelRows(prefix).findIndex((row) => Array.isArray(row) && row[0] === title)
}

/** clicks the open panel's item titled `title`, if it paints */
export function clickRow(title: string, prefix: 'menu' | 'submenu' = 'menu'): void {
	const index = getRowIndex(title, prefix)
	if (index !== -1) clickIfPresent(`${prefix}-row-${index}`)

	settle()
}

/** opens menu `title` by clicking it in the bar */
export function openMenu(title: string): void {
	clickIfPresent(`menu-title-${MENU_TITLES.indexOf(title)}`)
	settle()
}

export let parityDirectory: string
export let parityOptions: OpenOptions

export function initParityFolder(): void {
	parityDirectory = mkdtempSync(join(tmpdir(), 'eg-parity-'))
	parityOptions = {
		...isolated,
		recentFiles: new RecentFiles(join(parityDirectory, 'recent.json'))
	}
}

/** a parity row's fixture text */
export function readFixture(id: string): string {
	return readFileSync(join(import.meta.dirname, '..', 'fixtures', 'parity', `${id}.md`), 'utf8')
}

/** each measured gap, shown as the wanted one where GPUI's half-pixel grid keeps it within half a pixel of it */
export function snapToWanted(measured: number[], wanted: number[]): number[] {
	return measured.map((gap, index) => {
		const want = wanted[index] ?? Number.NaN
		return Math.abs(gap - want) <= 0.5 ? want : gap
	})
}

/** the window's paint as decoded pixels, with its device pixels per logical pixel over the 800px window */
export function captureWindow(): { shot: Pixels; scale: number } {
	const shotPath = join(tmpdir(), `eg-look-${process.pid}.png`)
	screenshot(shotPath)
	const shot = decodePng(readFileSync(shotPath))
	rmSync(shotPath, { force: true })
	return { shot, scale: shot.width / 800 }
}

/** `#rrggbb` of device pixel (`x`, `y`) */
export function getDevicePixel({ shot }: { shot: Pixels }, x: number, y: number): string {
	if (x < 0 || y < 0 || x >= shot.width || y >= shot.height) return '#000000'

	const at = (y * shot.width + x) * 4
	return `#${[shot.data[at]!, shot.data[at + 1]!, shot.data[at + 2]!].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/** `foreground` laid over `background` at `alpha`, as a translucent fill paints */
export function mixColour(foreground: string, background: string, alpha: number): string {
	const [front, back] = [toChannels(foreground), toChannels(background)]
	return `#${front
		.map((value, index) => Math.round(value * alpha + back[index]! * (1 - alpha)))
		.map((value) => value.toString(16).padStart(2, '0'))
		.join('')}`
}

export type Box = { x: number; y: number; width: number; height: number }

/**
 * the colour that fills the most pixels of any one device row inside `box` (logical px), leaving out the colours within
 * 8 of `except`: a strike or underline line crosses the whole run, under or over its glyphs, so its row holds more of
 * its colour than any row of glyphs holds of theirs
 */
export function getLongestRunColour(
	capture: { shot: Pixels; scale: number },
	box: Box,
	except: string[]
) {
	const { scale } = capture
	let best: [string, number] | null = null
	for (let y = Math.ceil(box.y * scale); y < Math.floor((box.y + box.height) * scale); y++) {
		const counts = new Map<string, number>()
		for (let x = Math.ceil(box.x * scale); x < Math.floor((box.x + box.width) * scale); x++) {
			const colour = getDevicePixel(capture, x, y)
			if (except.some((left) => isNear(colour, left, 8))) continue

			const count = (counts.get(colour) ?? 0) + 1
			counts.set(colour, count)
			if (!best || count > best[1]) best = [colour, count]
		}
	}
	return best?.[0] ?? null
}

/** the most frequent colour inside `box` (logical px), leaving out the colours within 8 of `except` */
export function getInkColour(capture: { shot: Pixels; scale: number }, box: Box, except: string[]) {
	const { scale } = capture
	const counts = new Map<string, number>()
	for (let y = Math.ceil(box.y * scale); y < Math.floor((box.y + box.height) * scale); y++)
		for (let x = Math.ceil(box.x * scale); x < Math.floor((box.x + box.width) * scale); x++) {
			const colour = getDevicePixel(capture, x, y)
			if (!except.some((left) => isNear(colour, left, 8))) {
				counts.set(colour, (counts.get(colour) ?? 0) + 1)
			}
		}
	return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/**
 * how many separate runs of colours within 24 of `colour` lie along device row `y` from device x `x0` to `x1`: one
 * for a solid line, one per dash for a dashed one
 */
export function countRunsAlong(
	capture: { shot: Pixels; scale: number },
	y: number,
	x0: number,
	x1: number,
	colour: string
): number {
	let runs = 0
	let inRun = false
	for (let x = x0; x <= x1; x++) {
		const on = isNear(getDevicePixel(capture, x, y), colour, 24)
		if (on && !inRun) runs++

		inRun = on
	}
	return runs
}

/** the first device row from `y0` down column `x` whose pixel is within `tolerance` of `colour`, -1 for none by `y1` */
export function findFirstRowNear(
	capture: { shot: Pixels; scale: number },
	x: number,
	y0: number,
	y1: number,
	colour: string,
	tolerance: number
): number {
	for (let y = y0; y <= y1; y++)
		if (isNear(getDevicePixel(capture, x, y), colour, tolerance)) return y

	return -1
}

export const getPalette = () => themeController.palette

export let lookDirectory: string

export function initLookDirectory(): void {
	lookDirectory = mkdtempSync(join(tmpdir(), 'eg-look-'))
}

export let runDirectory: string

export function initRunDirectory(): void {
	runDirectory = mkdtempSync(join(tmpdir(), 'eg-runs-'))
}

export let sandboxDirectory: string
export let sandboxOptions: OpenOptions & { socketsDirectory: string; recentFiles: RecentFiles }

export function initSandboxFolder(): void {
	sandboxDirectory = mkdtempSync(join(tmpdir(), 'eg-r9-'))
	sandboxOptions = {
		...menuOptions,
		socketsDirectory: join(sandboxDirectory, 's'),
		recentFiles: new RecentFiles(join(sandboxDirectory, 'recent.json')),
		legendPreference: new LegendPreference(join(sandboxDirectory, 'legend.json'))
	}
}

/** waits out the field work a command started (a probe and the keys it sends), then delivers what the field reported */
export async function waitForFieldIdle(): Promise<void> {
	await waitUntil(() => !documentController.fieldBusy, 'the field work')
	for (let round = 0; round < 3; round++) {
		await wait(20)
		pump()
	}
}

/** loads lines `line 1` to `line 80` joined by `separator`, then turns Source mode on and waits for its field */
export async function loadNumberedLinesInSource(separator: string): Promise<void> {
	documentController.load(
		`${Array.from({ length: 80 }, (_line, index) => `line ${index + 1}`).join(separator)}\n`,
		sandboxOptions
	)
	settle()
	press('cmd-/')
	await wait(150)
	pump()
}

/** an Agent hook's Report from `folder`, through the sockets under it, that it is about to edit `filePath` */
export async function reportAgentEdit(
	filePath: string,
	session: string,
	environment: Record<string, string>,
	folder = sandboxDirectory
) {
	await reportEdit(
		JSON.stringify({
			session_id: session,
			cwd: folder,
			hook_event_name: 'PreToolUse',
			tool_input: { file_path: filePath }
		}),
		environment,
		join(folder, 's')
	)
}

export let continuationRow: ListItem | undefined
export let firstItemText: ReturnType<typeof bounds>
export let continuationText: ReturnType<typeof bounds>

export function initContinuationRows(): void {
	const listItems = documentController.blocks[0]?.items ?? []
	continuationRow = listItems.find((item) => item.continuation)
	firstItemText = bounds(find_test_id(`list-text-${listItems[0]?.contentStart}`) ?? 0)
	continuationText = bounds(find_test_id(`list-text-${continuationRow?.contentStart ?? -1}`) ?? 0)
}

export let movedPath: string

export function initMovedPath(): void {
	movedPath = join(sandboxDirectory, 'moved.md')
}

export async function mergeByEta(name: string, before: string, after: string): Promise<void> {
	const path = openFixture(sandboxDirectory, `${name}.md`, before, sandboxOptions)
	await wait(100)
	await reportAgentEdit(path, 'eta', { EDITMD_AGENT_NAME: 'Eta' })
	writeFileSync(path, after)
	await waitUntil(() => documentController.highlights.length === 1, `Eta’s ${name}`)
	settle()
}

/** the dashed lines between a container's rows */
export const getGapLines = () => find_all((node) => /^gap-(end-)?\d+-\d+$/.test(node.testId ?? ''))
