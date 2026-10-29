import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { supportFolder } from './supportFolder.ts'

describe('supportFolder', () => {
	test('the app keeps its sockets and recent files in Application Support', () => {
		expect(supportFolder({})).toBe(
			join(homedir(), 'Library', 'Application Support', 'editmd-gpuix')
		)
	})

	test('EDITMD_GPUIX_SUPPORT moves all of it, so end-to-end runs never touch the user’s', () => {
		expect(supportFolder({ EDITMD_GPUIX_SUPPORT: '/tmp/e2e-support' })).toBe('/tmp/e2e-support')
		expect(supportFolder({ EDITMD_GPUIX_SUPPORT: '' })).toBe(
			join(homedir(), 'Library', 'Application Support', 'editmd-gpuix')
		)
	})
})
