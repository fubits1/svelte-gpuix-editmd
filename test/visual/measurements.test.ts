import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

type Element = Record<string, string | number | null> & { testId: string }
type Page = { painted: string[]; elements: Element[] }
type Measurements = Record<string, Record<string, Page>>

const BEFORE = join(import.meta.dirname, 'measurements-before.json')
const AFTER = join(import.meta.dirname, 'out', 'measurements.json')
const read = (path: string): Measurements => JSON.parse(readFileSync(path, 'utf8'))

test('every measured element has the same box, padding, border and text as before the migration', () => {
	expect([existsSync(BEFORE), existsSync(AFTER)]).toEqual([true, true])
	const before = read(BEFORE)
	const after = read(AFTER)
	const rows: Record<string, string | number | null>[] = []
	for (const [fixture, appearances] of Object.entries(before)) {
		for (const [appearance, page] of Object.entries(appearances)) {
			const now = after[fixture]?.[appearance]
			if (!now) {
				rows.push({
					fixture,
					appearance,
					element: '(page)',
					metric: 'measured',
					before: 'yes',
					after: 'no'
				})
				continue
			}
			if (page.painted.join('\n') !== now.painted.join('\n')) {
				rows.push({
					fixture,
					appearance,
					element: '(page)',
					metric: 'painted text',
					before: 'see JSON',
					after: 'differs'
				})
			}
			const nowById = new Map(now.elements.map((element) => [element.testId, element]))
			for (const element of page.elements) {
				const current = nowById.get(element.testId)
				for (const [metric, value] of Object.entries(element)) {
					if (metric === 'testId' || current?.[metric] === value) continue
					const was = typeof value === 'number' ? value : String(value)
					const is = current ? current[metric] : 'missing'
					rows.push({
						fixture,
						appearance,
						element: element.testId,
						metric,
						before: was,
						after: is,
						difference: typeof value === 'number' && typeof is === 'number' ? is - value : null
					})
				}
				nowById.delete(element.testId)
			}
			for (const added of nowById.keys()) {
				rows.push({
					fixture,
					appearance,
					element: added,
					metric: 'present',
					before: 'no',
					after: 'yes'
				})
			}
		}
	}
	if (rows.length > 0) console.table(rows)
	expect(rows).toEqual([])
})
