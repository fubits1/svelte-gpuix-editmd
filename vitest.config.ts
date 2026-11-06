import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import type { BrowserCommand, InlineConfig } from 'vitest/node'

const VISUAL_OUT = join(import.meta.dirname, 'test/visual/out')

const GPUIX_TEST_OPTIONS = {
	pool: 'forks',
	fileParallelism: false,
	execArgv: [
		'--conditions=custom-renderer',
		'--conditions=development',
		'--import=gpuix-svelte/register'
	],
	experimental: { viteModuleRunner: false },
	expect: { requireAssertions: true },
	// one run of each check: a retry would run checks again on a window already changed
	retry: 0,
	allowOnly: false,
	testTimeout: 0
} satisfies InlineConfig

/** every captured picture as a data URL, named `<set>-<file>`, read in Node for the browser test */
const getPictures: BrowserCommand<[]> = () =>
	['pages', 'window'].flatMap((set) =>
		readdirSync(join(VISUAL_OUT, set))
			.filter((file) => file.endsWith('.png'))
			.sort()
			.map((file) => ({
				name: `${set}-${file.replace(/\.png$/, '')}`,
				url: `data:image/png;base64,${readFileSync(join(VISUAL_OUT, set, file)).toString('base64')}`
			}))
	)

export default defineConfig({
	test: {
		coverage: {
			provider: 'v8',
			include: ['src/**'],
			// .svelte files run only in the headless ui project; v8 coverage here cannot map them to their source
			exclude: ['**/*.test.ts', '**/*.svelte'],
			reporter: ['text-summary', 'json-summary'],
			reportsDirectory: 'coverage',
			thresholds: { lines: 62, branches: 65, functions: 60, statements: 61 }
		},
		projects: [
			{
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					expect: { requireAssertions: true }
				}
			},
			{
				test: {
					/**
					 * the headless UI suite through gpuix-svelte/test: Node runs it as the gpuix-svelte bin does, with
					 * the custom renderer's conditions and its .svelte loader, so Vite transforms nothing
					 */
					name: 'ui',
					include: ['test/ui/**/*.test.ts'],
					...GPUIX_TEST_OPTIONS,
					sequence: { groupOrder: 1 }
				}
			},
			{
				test: {
					/**
					 * the end-to-end suites, each driving the app through gpuix's automation protocol: headless by
					 * default, real windows with EDITMD_E2E_ENTRY=standalone.ts (test:e2e:window)
					 */
					name: 'e2e',
					include: ['e2e/**/*.e2e.test.ts'],
					...GPUIX_TEST_OPTIONS,
					sequence: { groupOrder: 2 }
				}
			},
			// the visual before/after check for upgrades and refactors (test:visual), never part of test
			{
				test: {
					name: 'visual-measurements',
					environment: 'node',
					include: ['test/visual/measurements.test.ts']
				}
			},
			{
				test: {
					name: 'visual-pictures',
					include: ['test/browser/visual/pictures.test.ts'],
					browser: {
						enabled: true,
						headless: true,
						// one CSS pixel per image pixel
						provider: playwright({ contextOptions: { deviceScaleFactor: 1 } }),
						instances: [{ browser: 'chromium' }],
						commands: { getPictures },
						expect: {
							toMatchScreenshot: {
								comparatorName: 'pixelmatch',
								comparatorOptions: { threshold: 0, allowedMismatchedPixels: 0 }
							}
						}
					}
				}
			}
		]
	}
})
