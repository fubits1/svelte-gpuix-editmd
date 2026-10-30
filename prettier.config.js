/** @type {import("prettier").Config} */
const config = {
	useTabs: true,
	singleQuote: true,
	semi: false,
	trailingComma: 'none',
	printWidth: 100,
	plugins: ['prettier-plugin-svelte'],
	overrides: [
		{ files: '*.svelte', options: { parser: 'svelte' } },
		// the parity tables' rows are longer than any width: Prettier prints a table compact, one space each side of a
		// pipe, only when proseWrap is never
		{ files: 'docs/parity.md', options: { proseWrap: 'never' } }
	]
}

export default config
