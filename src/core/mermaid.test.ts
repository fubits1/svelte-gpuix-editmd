import { describe, expect, test } from 'vitest'
import { renderMermaid } from './mermaid.ts'

const palette = { 'pele-bg': '#1e1e2e', 'pele-fg': '#cdd6f4', 'pele-font': 'Helvetica' }

describe('renderMermaid', () => {
	test('renders a diagram to an SVG with every CSS variable resolved, since GPUI decodes no var()', () => {
		const result = renderMermaid('flowchart LR\n  A --> B', palette)

		expect(result.kind).toBe('diagram')
		if (result.kind !== 'diagram') return
		expect(result.svg.startsWith('<svg')).toBe(true)
		expect(result.svg.includes('var(')).toBe(false)
		expect(result.svg.includes('#cdd6f4')).toBe(true)
		expect(result.width).toBeGreaterThan(0)
	})

	test('labels name the palette font only: no generic sans-serif left for the decoder to fall back on', () => {
		const result = renderMermaid('flowchart LR\n  A --> B', palette)

		expect(result.kind).toBe('diagram')
		if (result.kind !== 'diagram') return
		expect(result.svg.replace(/<text[^>]*>[\s\S]*?<\/text>/g, '').includes('sans-serif')).toBe(
			false
		)
		expect(result.svg).toMatch(/<svg[^>]* font-family="Helvetica"/)
	})

	// the font rewrite touched every match in the SVG, labels included: a label reading `sans-serif`
	// became `Helvetica`, and one reading `font: 12px sans-serif` lost its text
	test('labels keep their text, whatever font names they spell', () => {
		const result = renderMermaid(
			'flowchart LR\n  A["sans-serif"] --> B["font: 12px sans-serif"]',
			palette
		)

		expect(result.kind).toBe('diagram')
		if (result.kind !== 'diagram') return
		const labels = [...result.svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(
			(match) => match[1]
		)
		expect(labels).toEqual(expect.arrayContaining(['sans-serif', 'font: 12px sans-serif']))
	})

	// the variable rewrite ran over label text too: `var(--pele-fg)` became a colour, `--_s:red` was read as
	// a declaration and broke the SVG
	test('labels that spell CSS variables keep their text', () => {
		const result = renderMermaid('flowchart LR\n  A["var(--pele-fg)"] --> B["--_s:red"]', palette)

		expect(result.kind).toBe('diagram')
		if (result.kind !== 'diagram') return
		const labels = [...result.svg.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(
			(match) => match[1]
		)
		expect(labels).toEqual(expect.arrayContaining(['var(--pele-fg)', '--_s:red']))
		expect(result.svg.replace(/<text[^>]*>[\s\S]*?<\/text>/g, '').includes('var(')).toBe(false)
	})

	test('a diagram with a syntax error reports its message instead of throwing', () => {
		const result = renderMermaid('flowchart LR\n  A -->', palette)

		expect(result.kind).toBe('error')
		if (result.kind !== 'error') return
		expect(result.message.length).toBeGreaterThan(0)
	})
})
