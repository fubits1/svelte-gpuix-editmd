import { join } from 'node:path'

/** the rendering fixtures the migration check pictures and measures; `r-page` is the whole sample page */
export const FIXTURES = [
	'r-page',
	'r-code',
	'r-definitions',
	'r-empty-doc',
	'r-footnotes',
	'r-frontmatter',
	'r-headings',
	'r-hr',
	'r-html',
	'r-image-linked',
	'r-image-remote',
	'r-image',
	'r-inline',
	'r-lists',
	'r-mermaid-empty',
	'r-mermaid-error',
	'r-mermaid',
	'r-quote',
	'r-table',
	'r-tasks'
] as const

export const FIXTURE_FOLDER = join(import.meta.dirname, '..', 'fixtures', 'parity')

export const fixtureFile = (id: string): string =>
	join(FIXTURE_FOLDER, `${id === 'r-page' ? 'render' : id}.md`)
