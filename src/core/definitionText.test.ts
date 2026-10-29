import { describe, expect, test } from 'vitest'
import { definitionText } from './definitionText.ts'

// what editmd's editor paints for a definition line (links.ts:133-136), run in its own editor:
// the label as written, the destination with its escapes and entities decoded, the title in double quotes
describe('definitionText', () => {
	test.each([
		['[docs]: https://example.com/docs "Docs"', '[docs]: https://example.com/docs "Docs"'],
		["[Docs]:   <https://example.com/a b>   'Single'", '[Docs]: https://example.com/a b "Single"'],
		['[d]: https://example.com/x\n  (Paren title)', '[d]: https://example.com/x "Paren title"'],
		['[e]: https://example.com/a\\_b&amp;c', '[e]: https://example.com/a_b&c'],
		['[x]: <>', '[x]: <>']
	])('%j paints as %j', (source, painted) => {
		expect(definitionText(source)).toBe(painted)
	})
})
