import { describe, expect, test } from 'vitest'
import { bundledSatteri } from './satteriAddon.ts'

describe('bundledSatteri', () => {
	test('satteri’s addon in the Resources of the .app holding the executable, null where there is none', () => {
		const executable = '/Apps/editmd-gpuix.app/Contents/MacOS/editmd-gpuix'
		const inBundle = '/Apps/editmd-gpuix.app/Contents/Resources/satteri.node'
		expect([
			bundledSatteri(executable, (path) => path === inBundle),
			bundledSatteri(executable, () => false),
			bundledSatteri('/usr/local/bin/node', (path) => path === inBundle)
		]).toEqual([inBundle, null, null])
	})
})
