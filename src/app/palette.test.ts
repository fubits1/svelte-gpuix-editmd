import { describe, expect, test } from 'vitest'
import {
	emptyLinkThemeFor,
	headingThemeFor,
	heldLinkThemeFor,
	listItemThemeFor,
	mermaidPaletteFor,
	mutedThemeFor,
	paletteFor,
	plainFieldThemeFor,
	sizeTokensFor,
	tableThemeFor,
	textThemeFor
} from './palette.ts'

/** editmd's `:root` colours (web/src/style.css@9e889e6), `--bg` named `background` here */
const EDITMD = {
	light: {
		text: '#1f2328',
		muted: '#656d76',
		faint: '#8c959f',
		background: '#ffffff',
		surface: '#f6f8fa',
		border: '#d8dee4',
		accent: '#0969da',
		mark: '#fff8c5',
		danger: '#cf222e',
		agents: ['#8250df', '#1a7f37', '#bc4c00', '#bf3989', '#0969da', '#1b7c83']
	},
	dark: {
		text: '#e6edf3',
		muted: '#9198a1',
		faint: '#6e7681',
		background: '#1e1f22',
		surface: '#2a2c30',
		border: '#3d4148',
		accent: '#4493f8',
		mark: '#6b5a1d',
		danger: '#ff7b72',
		agents: ['#ab7df8', '#3fb950', '#f0883e', '#f778ba', '#4493f8', '#39c5cf']
	}
} as const

describe('paletteFor', () => {
	test.each(['light', 'dark'] as const)('%s uses editmd’s colours', (appearance) => {
		const { agents, ...tokens } = EDITMD[appearance]
		const palette = paletteFor(appearance)

		expect(palette).toMatchObject(tokens)
		agents.forEach((colour, slot) => {
			expect(palette[`agent-${slot}`]).toBe(colour)
			// editmd tints a block with color-mix(var(--agent) 13%, transparent): 13% of 255 is 0x21
			expect(palette[`agent-${slot}-tint`]).toBe(`${colour}21`)
		})
	})

	test.each(['light', 'dark'] as const)(
		'%s tints an Outside edit block in editmd’s `agent-unknown`, faded as the Agents’ tints are',
		(appearance) => {
			const palette = paletteFor(appearance)
			expect(palette['agent-unknown-tint']).toBe(`${palette['agent-unknown']}21`)
		}
	)

	// `.agent-deleted.between { border-top: 2px dashed color-mix(var(--agent) 70%, transparent) }`: 70% of 255 is 0xb3
	test.each(['light', 'dark'] as const)(
		'%s draws a Deletion’s line in its Agent’s colour at 70%, Outside edit’s in agent-unknown',
		(appearance) => {
			const palette = paletteFor(appearance)
			EDITMD[appearance].agents.forEach((colour, slot) => {
				expect(palette[`agent-${slot}-deleted`]).toBe(`${colour}b3`)
			})
			expect(palette['agent-unknown-deleted']).toBe(`${palette['agent-unknown']}b3`)
		}
	)

	test.each(['light', 'dark'] as const)(
		'%s washes a hovered legend button in the text colour at 0.08 alpha, as editmd’s `.agent-legend button:hover`',
		(appearance) => {
			// 8% of 255 is 0x14
			expect(paletteFor(appearance)['legend-hover']).toBe(`${EDITMD[appearance].text}14`)
		}
	)

	test.each(['light', 'dark'] as const)(
		'%s has editmd’s `--selection`, the accent at 22% alpha',
		(appearance) => {
			// 22% of 255 is 56, 0x38
			expect(paletteFor(appearance).selection).toBe(`${EDITMD[appearance].accent}38`)
		}
	)

	test.each(['light', 'dark'] as const)(
		'%s paints the scrollbar thumb in `faint` and a hovered one in `muted`, quiet greys like the system’s overlay scroller',
		(appearance) => {
			const palette = paletteFor(appearance)
			// gpuix's Scroller reads these, falling back to its own dark slate `#585b70`
			expect(palette['scroller-thumb']).toBe(EDITMD[appearance].faint)
			expect(palette['scroller-thumb-hover']).toBe(EDITMD[appearance].muted)
		}
	)

	test.each(['light', 'dark'] as const)(
		'%s marks the active find match in the strong `mark` colour, where editmd shows WebKit’s yellow find indicator behind the match (editmd’s screenshot); a wash cannot recolour the text (G4), so not yellow itself',
		(appearance) => {
			expect(paletteFor(appearance)['find-active']).toBe(EDITMD[appearance].mark)
		}
	)
})

describe('textThemeFor', () => {
	test('native text paints in editmd’s colours and its 16px/1.65 body, 1.25 heading scale', () => {
		const palette = paletteFor('light')

		expect(textThemeFor('light')).toEqual({
			appearance: 'light',
			// `bg` is the plane behind code blocks, editmd's `pre` surface
			bg: palette.surface,
			border: palette.border,
			text: palette.text,
			textMuted: palette.muted,
			textFaint: palette.faint,
			// native <markdown> paints list markers and the quote rail in `accent`; editmd's markers are muted
			accent: palette.muted,
			caret: palette.accent,
			codeText: palette.text,
			codeWash: palette.surface,
			// editmd's --font-body is the system font; GPUI resolves `.SystemUIFont` and keeps bold and italic
			fontSans: '.SystemUIFont',
			// editmd's --font-mono is ui-monospace, SF Mono; GPUI resolves `.AppleSystemUIFontMonospaced` in <markdown>
			fontMono: '.AppleSystemUIFontMonospaced',
			// editmd's code blocks have no syntax colours: every token paints in the text colour
			syntax: Object.fromEntries(
				[
					'comment',
					'keyword',
					'string',
					'stringSpecial',
					'escape',
					'number',
					'boolean',
					'typeName',
					'typeBuiltin',
					'constructor',
					'function',
					'functionBuiltin',
					'macroName',
					'property',
					'constant',
					'variable',
					'variableSpecial',
					'parameter',
					'operator',
					'punctuation',
					'tag',
					'attribute',
					'label',
					'invalid'
				].map((kind) => [kind, palette.text])
			),
			metrics: {
				mdTextSize: 16,
				mdLineHeight: 26.4,
				mdBlockGap: 16,
				// h1 2.1em, h2 1.55em, h3 1.25em, h4 1.05em (native has one tier for h4-h6), line-height 1.25
				mdHeadingSizes: [33.6, 24.8, 20, 16.8],
				mdHeadingLineHeights: [42, 31, 25, 21],
				// `pre`: 13.5px/1.55, padding 0.9rem 1.1rem, radius 8px; inline code radius 5px
				codeTextSize: 13.5,
				codeLineHeight: 20.925,
				mdCodePaddingX: 17.6,
				mdCodePaddingY: 14.4,
				mdCodeRadius: 8,
				mdInlineCodeRadius: 5
			}
		})
	})

	test('zoom scales every metric, as editmd’s page zoom scales the whole page', () => {
		const actual = textThemeFor('dark').metrics!
		const zoomed = textThemeFor('dark', 2).metrics!

		// every metric twice its actual size, written out rather than computed
		expect(zoomed).toEqual({
			mdTextSize: 32,
			mdLineHeight: 52.8,
			mdBlockGap: 32,
			mdHeadingSizes: [67.2, 49.6, 40, 33.6],
			mdHeadingLineHeights: [84, 62, 50, 42],
			codeTextSize: 27,
			codeLineHeight: 41.85,
			mdCodePaddingX: 35.2,
			mdCodePaddingY: 28.8,
			mdCodeRadius: 16,
			mdInlineCodeRadius: 10
		})
		expect(Object.keys(zoomed)).toEqual(Object.keys(actual))
	})
})

describe('headingThemeFor', () => {
	// native <markdown> paints h4-h6 in one tier, the fourth; editmd's h5 is 0.95em, h6 0.9em and muted
	test('h5 and h6 take their own size into the fourth tier, line-height 1.25, h6 in the muted colour', () => {
		const theme = textThemeFor('dark')
		const tier = (level: number, zoom = 1) => {
			const { text, metrics } = headingThemeFor(theme, level, zoom)
			return [metrics?.mdHeadingSizes, metrics?.mdHeadingLineHeights, text]
		}

		expect(tier(5)).toEqual([[33.6, 24.8, 20, 15.2], [42, 31, 25, 19], paletteFor('dark').text])
		expect(tier(6)).toEqual([[33.6, 24.8, 20, 14.4], [42, 31, 25, 18], paletteFor('dark').muted])
		// zoomed: the theme handed in is already zoomed, so only the new tier needs the zoom
		expect(headingThemeFor(textThemeFor('dark', 2), 6, 2).metrics?.mdHeadingSizes).toEqual([
			67.2, 49.6, 40, 28.8
		])
	})

	test('every other level paints in the theme as it is', () => {
		const theme = textThemeFor('light')
		for (const level of [1, 2, 3, 4]) expect(headingThemeFor(theme, level)).toBe(theme)
	})
})

describe('mermaidPaletteFor', () => {
	/**
	 * editmd draws diagrams in mermaid's own `default` and `dark` themes (diagrams.ts:30), not its page palette;
	 * colours sampled from its `--snapshot` of test/fixtures/parity/r-mermaid.md: node fill, node border,
	 * edge line, label text, on the page background
	 */
	test.each([
		[
			'light',
			{ surface: '#ececff', border: '#9370db', line: '#333333', fg: '#333333', bg: '#ffffff' }
		],
		[
			'dark',
			{ surface: '#1f2020', border: '#cccccc', line: '#d3d3d3', fg: '#cccccc', bg: '#1e1f22' }
		]
	] as const)('%s: mermaid’s theme as editmd shows it', (appearance, theme) => {
		expect(mermaidPaletteFor(appearance)).toMatchObject({
			'pele-surface': theme.surface,
			'pele-border': theme.border,
			'pele-line': theme.line,
			'pele-fg': theme.fg,
			'pele-bg': theme.bg
		})
	})
})

describe('tableThemeFor', () => {
	test('a table cell paints at editmd’s 0.94em with the body’s 1.65 line-height, zoomed with the page', () => {
		const theme = textThemeFor('light')
		expect(tableThemeFor(theme).metrics).toMatchObject({ mdTextSize: 15.04, mdLineHeight: 24.816 })
		expect(tableThemeFor(theme, 1.1).metrics).toMatchObject({
			mdTextSize: 16.544,
			mdLineHeight: 27.298
		})
	})
})

describe('emptyLinkThemeFor', () => {
	test('a Block with an empty link paints code in the accent with no wash, as editmd’s `a.empty-link::before`', () => {
		const theme = textThemeFor('light')
		expect(emptyLinkThemeFor(theme, false)).toEqual({
			...theme,
			codeWash: '#00000000',
			codeText: EDITMD.light.accent
		})
	})

	test('a Block with inline code of its own keeps the theme, so its code keeps editmd’s pill', () => {
		const theme = textThemeFor('dark')
		expect(emptyLinkThemeFor(theme, true)).toBe(theme)
	})
})

describe('agent change washes', () => {
	test('an Agent’s changed text takes editmd’s `.agent-change` wash, its colour at 18%', () => {
		const palette = paletteFor('dark')
		// 0.18 × 255 rounds to 46, 0x2e
		expect([palette['agent-0-change'], palette['agent-unknown-change']]).toEqual([
			'#ab7df82e',
			'#8b949e2e'
		])
	})
})

describe('heldLinkThemeFor', () => {
	test('while ⌘ is held a link’s underline takes the link’s colour, as editmd’s `body.cmd-down a` currentColor', () => {
		const theme = textThemeFor('dark')
		expect(heldLinkThemeFor(theme)).toEqual({ ...theme, textMuted: EDITMD.dark.text })
	})
})

describe('tooltip tokens', () => {
	test('gpuix Tooltip’s `--tooltip-surface` and `--tooltip-ink` take the surface and the text colour', () => {
		for (const appearance of ['light', 'dark'] as const) {
			const palette = paletteFor(appearance)
			expect([palette['tooltip-surface'], palette['tooltip-ink']]).toEqual([
				EDITMD[appearance].surface,
				EDITMD[appearance].text
			])
		}
	})
})

describe('listItemThemeFor', () => {
	test('an item’s paragraphs stack with no gap, as editmd’s `li > p { margin: 0 }` (style.css:235)', () => {
		const theme = textThemeFor('dark')
		expect(listItemThemeFor(theme)).toEqual({
			...theme,
			metrics: { ...theme.metrics, mdBlockGap: 0 }
		})
	})
})

describe('mutedThemeFor', () => {
	test('muted text paints its inline code muted too, as editmd’s code inherits its colour (style.css:185-191)', () => {
		const theme = textThemeFor('dark')
		expect(mutedThemeFor(theme)).toEqual({
			...theme,
			text: EDITMD.dark.muted,
			codeText: EDITMD.dark.muted,
			textMuted: EDITMD.dark.faint
		})
	})
	test('a link’s underline in muted text is faint, so ⌘ can still turn it to the muted text colour', () => {
		const muted = mutedThemeFor(textThemeFor('light'))
		expect([muted.textMuted, heldLinkThemeFor(muted).textMuted]).toEqual([
			EDITMD.light.faint,
			EDITMD.light.muted
		])
	})
	test('an h6, muted, paints its inline code muted too', () => {
		expect(headingThemeFor(textThemeFor('light'), 6).codeText).toBe(EDITMD.light.muted)
	})
})

describe('plainFieldThemeFor', () => {
	test('Source mode keeps the system caret, in the text colour, where the page’s caret is the accent (style.css:90-112)', () => {
		const theme = textThemeFor('light')
		expect(plainFieldThemeFor(theme)).toEqual({ ...theme, caret: EDITMD.light.text })
	})
	test('front matter paints its text and the system caret in the muted colour (frontmatter.ts:20-22)', () => {
		const theme = textThemeFor('dark')
		expect(plainFieldThemeFor(theme, EDITMD.dark.muted)).toEqual({
			...theme,
			text: EDITMD.dark.muted,
			caret: EDITMD.dark.muted
		})
	})
})

describe('sizeTokensFor', () => {
	test('at actual size each token is the view’s own px length', () => {
		expect(sizeTokensFor(1)).toEqual({
			// editmd's `#editor`: `max-width: 46rem`, `padding: 3rem 2.5rem 40vh`
			'size-page-measure': '736px',
			'size-page-padding-top': '48px',
			'size-page-padding-x': '40px',
			// editmd's block margins: `p, ul, ol, blockquote, pre, table, dl { margin: 0 0 1em }`
			'size-block-bottom': '16px',
			// headings `margin: 1.6em 0 0.6em` in their own em: 2.1, 1.55, 1.25, 1.05, 0.95 and 0.9 of 16px
			'size-heading-1-top': '53.76px',
			'size-heading-1-bottom': '20.16px',
			'size-heading-2-top': '39.68px',
			'size-heading-2-bottom': '14.88px',
			'size-heading-3-top': '32px',
			'size-heading-3-bottom': '12px',
			'size-heading-4-top': '26.88px',
			'size-heading-4-bottom': '10.08px',
			'size-heading-5-top': '24.32px',
			'size-heading-5-bottom': '9.12px',
			'size-heading-6-top': '23.04px',
			'size-heading-6-bottom': '8.64px',
			// h1 `padding-bottom: 0.25em` and h2 `0.2em` above their bottom rule
			'size-heading-1-rule-padding': '8.4px',
			'size-heading-2-rule-padding': '4.96px',
			// `hr { margin: 2em 0 }`, `.frontmatter { margin: 0 0 2rem }`
			'size-rule-margin': '32px',
			'size-frontmatter-bottom': '32px',
			// `blockquote { padding: 0 1em; border-left: 0.25em solid var(--border) }`
			'size-quote-rail': '4px',
			'size-quote-padding': '16px',
			// `pre[data-language]::before`: 11px, `top: 0.35rem; right: 0.6rem`
			'size-code-label': '11px',
			'size-code-label-right': '9.6px',
			// `.agent-block { box-shadow: -6px 0 0 var(--tint), -8px 0 0 var(--agent) }`: an 8px bar, nothing moves
			'size-agent-rail': '8px',
			'size-agent-inset': '0px',
			'size-agent-outset': '-8px',
			// a Deletion's line, `.agent-deleted.between { margin: 0.2rem 0; border-top: 2px }`
			'size-deleted-margin': '3.2px',
			'size-deleted-line': '2px',
			// `.frontmatter { padding: 0.75rem 1rem; font: 12.5px/1.55 mono; border-radius: 8px }`
			'size-frontmatter-padding-y': '12px',
			'size-frontmatter-padding-x': '16px',
			'size-frontmatter-radius': '8px',
			'size-frontmatter-text': '12.5px',
			'size-frontmatter-line-height': '19.375px',
			// open, `.frontmatter:focus`'s 2px ring as a border taken off the padding
			'size-frontmatter-focus-ring': '2px',
			'size-frontmatter-focus-padding-y': '10px',
			'size-frontmatter-focus-padding-x': '14px',
			// Source mode's field, `.source { font: 14px/1.6 mono }`
			'size-source-text': '14px',
			'size-source-line-height': '22.4px',
			// an open code or mermaid Block's field in its `pre` card: 13.5px/1.55, padding 0.9rem 1.1rem, radius 8px
			'size-code-text': '13.5px',
			'size-code-line-height': '20.925px',
			'size-code-padding-y': '14.4px',
			'size-code-padding-x': '17.6px',
			'size-code-radius': '8px',
			// a footnote reference's `sup` makes its line 2px taller
			'size-footnote-sup-rise': '2px',
			// a code block's pre margin of its 13.5px, then the diagram box `hidden` cannot hide
			'size-code-margin': '13.5px',
			'size-hidden-diagram': '32px',
			// a footnote definition's `padding-top: 0.5em`, of its 0.9em
			'size-footnote-inset': '7.2px',
			'size-footnote-label': '14.4px',
			// a task list's rows, editmd's `li + li { margin-top: 0.2em }`
			'size-list-gap': '3.2px',
			// `ul, ol { padding-left: 1.75em }`, and the browser's markers measured in editmd's screenshot
			'size-list-indent': '28px',
			'size-list-line-height': '26.4px',
			'size-list-bullet': '6px',
			'size-list-bullet-left': '10.5px',
			'size-list-bullet-top': '11px',
			'size-list-number-gap': '4.4px',
			// a task's box, `left: -1.55em; top: 0.3em` in the gutter, measured against the text in r-tasks
			'size-checkbox': '16px',
			'size-checkbox-left': '3.2px',
			'size-checkbox-offset': '5.5px',
			'size-checkbox-radius': '4px',
			// GPUI's measured text size for text with no size of its own, so zoom 1 paints as before
			'size-list-marker': '16px',
			'size-images-gap': '8px',
			'size-image-fallback': '240px',
			'size-image-alt': '16px',
			// `img { border-radius: 4px }`
			'size-image-radius': '4px',
			// a blocked image's `.remote-image` box, in its own 0.9em (14.4px): gap 0.35em, padding 0.05em 0.45em
			'size-remote-image-text': '14.4px',
			'size-remote-image-gap': '5.04px',
			'size-remote-image-padding-y': '0.72px',
			'size-remote-image-padding-x': '6.48px',
			// the space between an inline image and the text after it: one space of the 16px system font
			'size-inline-gap': '4.4px',
			// editmd's `.diagram { padding: 1rem; border-radius: 8px }`, `.diagram-error { font: 12.5px }`
			'size-diagram-padding': '16px',
			'size-diagram-radius': '8px',
			// a table's 0.94em text, and its cells' `padding: 0.4em 0.85em` of it
			'size-table-text': '15.04px',
			'size-table-cell-padding-y': '6.016px',
			'size-table-cell-padding-x': '12.784px',
			// editmd's `.agent-legend` rules in style.css, rem at 16px
			'size-legend-inset': '16px',
			'size-legend-gap': '2px',
			'size-legend-width': '288px',
			'size-legend-padding': '5.6px',
			'size-legend-radius': '8px',
			'size-legend-text': '12px',
			'size-legend-line-height': '16.8px',
			'size-legend-header-text': '11px',
			'size-legend-header-padding-top': '0.8px',
			'size-legend-header-padding-bottom': '1.6px',
			'size-legend-header-padding-left': '6.4px',
			'size-legend-button': '22.4px',
			'size-legend-button-radius': '5px',
			'size-legend-minimize-text': '13px',
			'size-legend-name-gap': '7.2px',
			'size-legend-name-padding-y': '3.2px',
			'size-legend-name-padding-x': '6.4px',
			'size-legend-dot': '9.6px',
			'size-legend-dot-radius': '4.8px',
			'size-legend-count-gap': '8px',
			'size-legend-rename-margin': '1.6px',
			'size-legend-rename-padding-y': '2.4px',
			'size-legend-rename-padding-x': '5.6px',
			'size-legend-clear-all-gap': '2px',
			'size-legend-pill-outer': '3.2px',
			'size-legend-pill-gap': '4.8px',
			'size-legend-pill-padding-y': '4px',
			'size-legend-pill-padding-x': '8.8px',
			'size-legend-pill-radius': '999px',
			'size-legend-pill-count-gap': '3.2px',
			'size-find-gap': '8px',
			'size-find-padding-y': '6px',
			'size-find-padding-x': '10px',
			'size-find-separator': '1px',
			'size-find-text': '11px',
			'size-find-control-height': '20px',
			'size-find-control-padding-x': '8px',
			'size-find-control-radius': '5px',
			'size-find-chevron': '12px',
			'size-find-glyph': '12px',
			'size-find-glyph-gap': '5px',
			'size-status-text': '11px'
		})
	})

	// editmd's save status is an NSTextField in the title bar, in `NSFont.smallSystemFontSize` (EditorWindowController.swift:340)
	test('the save-status label is window chrome too: the small system font size, 11px, at every zoom', () => {
		expect([0.5, 1, 1.1, 3].map((zoom) => sizeTokensFor(zoom)['size-status-text'])).toEqual([
			'11px',
			'11px',
			'11px',
			'11px'
		])
	})

	test('the find bar is window chrome, outside editmd’s web page, so its tokens never zoom', () => {
		const chrome = Object.entries(sizeTokensFor(1)).filter(([name]) =>
			name.startsWith('size-find-')
		)

		// with the search field's magnifier and clear glyphs and the space around them
		expect(chrome).toHaveLength(11)
		for (const zoom of [0.5, 1.1, 3]) {
			const zoomed = sizeTokensFor(zoom)
			for (const [name, value] of chrome) expect(zoomed[name]).toBe(value)
		}
	})

	test('zoom scales every token, as editmd’s page zoom scales the whole page', () => {
		const zoomed = sizeTokensFor(1.1)

		// 13.5 × 1.1 (the code card's text)
		expect(zoomed['size-code-text']).toBe('14.85px')
		// float noise from 12 × 1.1 would make 13.200000000000001px
		expect(zoomed['size-heading-3-bottom']).toBe('13.2px')
		expect(sizeTokensFor(0.5)['size-image-fallback']).toBe('120px')
		expect(Object.keys(zoomed)).toEqual(Object.keys(sizeTokensFor(1)))
		// every page length, not only the three above: 1.1 times its actual size, to three decimals; the window
		// chrome (the find bar, the save-status label) stays out
		const page = Object.entries(sizeTokensFor(1)).filter(
			([name]) => !name.startsWith('size-find-') && name !== 'size-status-text'
		)
		expect(page.map(([name]) => [name, zoomed[name]])).toEqual(
			page.map(([name, value]) => [
				name,
				`${Math.round(Number.parseFloat(value) * 1.1 * 1000) / 1000}px`
			])
		)
	})
})
