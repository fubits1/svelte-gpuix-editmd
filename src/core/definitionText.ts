import { markdownToMdast } from 'satteri'

type DefinitionNode = {
	type: string
	label?: string | null
	identifier?: string
	url?: string
	title?: string | null
}

/**
 * a link reference definition as editmd paints it, rebuilt from what it defines rather than its source line
 * (links.ts:133-136): `[label]: url "title"`, the label as written, the destination with its escapes and entities
 * decoded and `<>` for an empty one, the title in double quotes. `source` as written when it holds no definition
 */
export function definitionText(source: string): string {
	const root = markdownToMdast(source) as { children?: DefinitionNode[] }
	const definition = root.children?.find((node) => node.type === 'definition')
	if (!definition) return source
	const label = definition.label ?? definition.identifier ?? ''
	const url = definition.url || '<>'
	return `[${label}]: ${url}${definition.title ? ` "${definition.title}"` : ''}`
}
