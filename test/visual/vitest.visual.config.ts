import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import type { BrowserCommand } from 'vitest/node'

const OUT = join(import.meta.dirname, 'out')

/** every captured picture as a data URL, named `<set>-<file>`, read in Node for the browser test */
const pictures: BrowserCommand<[]> = () =>
	['pages', 'window'].flatMap((set) =>
		readdirSync(join(OUT, set))
			.filter((file) => file.endsWith('.png'))
			.sort()
			.map((file) => ({
				name: `${set}-${file.replace(/\.png$/, '')}`,
				url: `data:image/png;base64,${readFileSync(join(OUT, set, file)).toString('base64')}`
			}))
	)

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: 'measurements',
					environment: 'node',
					include: ['test/visual/measurements.test.ts']
				}
			},
			{
				test: {
					name: 'pictures',
					include: ['test/browser/visual/pictures.test.ts'],
					browser: {
						enabled: true,
						headless: true,
						// one CSS pixel per image pixel
						provider: playwright({ contextOptions: { deviceScaleFactor: 1 } }),
						instances: [{ browser: 'chromium' }],
						commands: { pictures },
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
