import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		expect: { requireAssertions: true },
		coverage: {
			provider: 'v8',
			include: ['src/**'],
			// .svelte files run only in the headless UI suite (test.ts); vitest here has no Svelte plugin to load them
			exclude: ['**/*.test.ts', '**/*.svelte'],
			reporter: ['text-summary', 'json-summary'],
			reportsDirectory: 'coverage',
			thresholds: { lines: 61.99, branches: 64.59, functions: 59.9, statements: 61.09 }
		},
		projects: [
			{
				extends: './vite.config.js',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
})
