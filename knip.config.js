export default {
	entry: ['app.ts', 'standalone.ts', 'test.ts', 'e2e/*.e2e.ts', 'svelte.config.js'],
	project: ['**/*.{js,ts,svelte}'],
	ignoreBinaries: ['xattr'],
	compilers: {
		// `svelte: true` leaves the imports of .svelte files unread here, since svelte is not a dependency.
		svelte: (source) =>
			[...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
				.map((match) => match[1])
				.join('\n')
	}
}
