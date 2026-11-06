import { describe, expect, test } from 'vitest'
import { mermaidPaletteFor } from './palette.ts'
import { DIAGRAM_RERENDER_DELAY, diagramOf, diagramSource, errorText } from './diagrams.ts'

const palette = mermaidPaletteFor('light')

describe('diagramSource', () => {
	test('is the text between the fences', () => {
		expect(diagramSource('```mermaid\nflowchart LR\n  A --> B\n```')).toBe(
			'flowchart LR\n  A --> B'
		)
	})

	test('keeps a Block whose closing fence is still missing, as while it is typed', () => {
		expect(diagramSource('```mermaid\nflowchart LR\n  A --> B\n')).toBe('flowchart LR\n  A --> B')
	})

	// a tilde fence closes with tildes, a longer fence with at least as many; a closing `~~~` is no part of the source
	test('a tilde fence and a longer fence close as GFM closes them', () => {
		expect([
			diagramSource('~~~mermaid\nflowchart LR\n  A --> B\n~~~'),
			diagramSource('~~~mermaid\n~~~'),
			diagramSource('````mermaid\nA\n```\n````'),
			diagramSource('```mermaid\nA\n~~~')
		]).toEqual(['flowchart LR\n  A --> B', '', 'A\n```', 'A\n~~~'])
	})
})

describe('diagramOf', () => {
	test('a diagram renders to SVG with its size', () => {
		const diagram = diagramOf('flowchart LR\n  A --> B', palette)
		expect(diagram.kind).toBe('diagram')
		if (diagram.kind === 'diagram') expect(diagram.svg).toContain('<svg')
	})

	test('a blank source is editmd’s Empty diagram, not an error', () => {
		expect(diagramOf(' \n ', palette)).toEqual({ kind: 'empty', message: 'Empty diagram' })
	})

	// editmd shows mermaid's message: the line, its context, a dashed `^` under the failing place, what was expected
	// (editmd's own picture of r-mermaid-error.md). pele's has that shape, with its own line count and wording.
	test('an error at the end of the input gives its line, context and dashed `^` marker', () => {
		expect(diagramOf('flowchart LR\n  A -->', palette)).toEqual({
			kind: 'error',
			message: "Parse error on line 2:\n  A -->\n-------^\nExpecting 'NODE_STRING', got 'EOF'"
		})
		expect(diagramOf('flowchart LR\nA --> B\nB -->> C', palette)).toEqual({
			kind: 'error',
			message: "Parse error on line 3:\nB -->> C\n-----^\nExpecting 'NODE_STRING', got 'TAGEND'"
		})
	})

	test('an error keeps its first four non-blank lines, as editmd’s `errorText`', () => {
		const diagram = diagramOf('flowchart LR\n  A -->', palette)
		expect(diagram.kind).toBe('error')
		if (diagram.kind !== 'error') return
		const lines = diagram.message.split('\n')
		expect(lines.length).toBeLessThanOrEqual(4)
		expect(lines.every((line) => line.trim() !== '')).toBe(true)
	})
})

describe('errorText', () => {
	test('keeps the first four non-blank lines of a longer message, in order', () => {
		expect(errorText('one\n\ntwo\n  \nthree\nfour\nfive\nsix')).toBe('one\ntwo\nthree\nfour')
	})
})

test('re-renders wait for editmd’s 300ms pause in typing', () => {
	expect(DIAGRAM_RERENDER_DELAY).toBe(300)
})
