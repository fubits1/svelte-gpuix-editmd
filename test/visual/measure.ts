/**
 * the measured half of the migration check: every rendering fixture, light and dark, mounted headless at 860 wide as
 * `--snapshot` mounts it, and every element with a test id written out with its box, padding, border and text
 *
 * run: node node_modules/gpuix-svelte/bin/gpuix-svelte.js test/visual/measure.ts OUT.json
 */

import { readFileSync, writeFileSync } from 'node:fs'
import {
	automation_tree,
	find_test_id,
	MAX_HEADLESS_HEIGHT,
	mount_headless,
	painted,
	pump,
	wait
} from 'gpuix-svelte/test'
import HeadlessPage from '../../src/app/HeadlessPage.svelte'
import { ThemeController } from '../../src/app/theme.svelte.ts'
import { documentController } from '../../src/ui/DocumentView/controller.svelte.ts'
import { FIXTURES, FIXTURE_FOLDER, fixtureFile } from './fixtures.ts'

const out = process.argv[2]
if (!out) throw new Error('usage: test/visual/measure.ts OUT.json')

const WIDTH = 860
const STYLE_KEYS = [
	'paddingTop',
	'paddingRight',
	'paddingBottom',
	'paddingLeft',
	'borderTopWidth',
	'borderRightWidth',
	'borderBottomWidth',
	'borderLeftWidth'
] as const

type AutomationNode = {
	testId?: string
	type: string
	text?: string
	bounds?: { x: number; y: number; width: number; height: number }
	children?: AutomationNode[]
}

/** waits until the page's height holds still for 300ms, as `--snapshot` does before its first picture */
async function settle(): Promise<void> {
	const heightNow = () => {
		const tree = automation_tree() as AutomationNode | null
		return JSON.stringify(tree)
	}
	let last = heightNow()
	let stillSince = Date.now()
	const started = Date.now()
	while (Date.now() - started < 3000) {
		await wait(50)
		pump()
		const next = heightNow()
		if (next !== last) {
			last = next
			stillSince = Date.now()
		} else if (Date.now() - stillSince >= 300) return
	}
}

function elements(
	node: AutomationNode | null,
	found: Record<string, unknown>[] = []
): Record<string, unknown>[] {
	if (!node) return found
	if (node.testId && node.bounds) {
		const style = find_test_id(node.testId)?.style ?? {}
		const box = Object.fromEntries(STYLE_KEYS.map((key) => [key, style[key] ?? 0]))
		found.push({
			testId: node.testId,
			type: node.type,
			...node.bounds,
			...box,
			text: node.text ?? null
		})
	}
	for (const child of node.children ?? []) elements(child, found)
	return found
}

const results: Record<string, Record<string, unknown>> = {}
for (const appearance of ['light', 'dark'] as const) {
	const theme = new ThemeController({
		readAppearance: () => appearance,
		initialAppearance: () => appearance
	})
	const mounted = mount_headless(HeadlessPage, {
		width: WIDTH,
		height: MAX_HEADLESS_HEIGHT,
		props: { theme }
	})
	for (const id of FIXTURES) {
		documentController.load(readFileSync(fixtureFile(id), 'utf8'), { onExit: () => {} })
		documentController.folder = FIXTURE_FOLDER
		await settle()
		results[id] ??= {}
		results[id][appearance] = {
			painted: painted().split('\n'),
			elements: elements(automation_tree() as AutomationNode | null)
		}
	}
	mounted.unmount()
}

writeFileSync(out, `${JSON.stringify(results, null, '\t')}\n`)
console.log(out)
process.exit(0)
