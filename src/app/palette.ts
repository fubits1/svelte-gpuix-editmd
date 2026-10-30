import type { GpuixTheme } from 'gpuix-svelte'
import type { Appearance } from '../host/appearance.ts'

export type Palette = Record<string, string>

type BaseColours = Record<
	| 'text'
	| 'muted'
	| 'faint'
	| 'background'
	| 'surface'
	| 'border'
	| 'accent'
	| 'mark'
	| 'danger'
	| 'agent-unknown',
	string
>

/** one colour per Agent slot, so the count matches `AGENT_SLOTS` in `core/agentColours.ts` */
type AgentColours = readonly [string, string, string, string, string, string]

/** editmd's `:root` colours (web/src/style.css@9e889e6); its `--bg` is `background` here */
const BASE: Record<Appearance, BaseColours> = {
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
		'agent-unknown': '#6e7781'
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
		'agent-unknown': '#8b949e'
	}
}

/**
 * AppKit's colours editmd paints its window chrome in, read in Swift on this macOS as sRGB: systemRed for Find's
 * no-match count and Not Saved (EditorWindowController.swift:301, 358), secondaryLabelColor for Saving… and Saved
 */
const APPKIT: Record<Appearance, Record<'system-red' | 'secondary-label', string>> = {
	light: { 'system-red': '#ff383c', 'secondary-label': '#0000007f' },
	dark: { 'system-red': '#ff4245', 'secondary-label': '#ffffff8c' }
}

/** editmd's Agent colours by slot, assigned in the order Agents first edit the file */
const AGENTS: Record<Appearance, AgentColours> = {
	light: ['#8250df', '#1a7f37', '#bc4c00', '#bf3989', '#0969da', '#1b7c83'],
	dark: ['#ab7df8', '#3fb950', '#f0883e', '#f778ba', '#4493f8', '#39c5cf']
}

/** a share of full opacity as the two hex digits a `#rrggbbaa` colour ends in */
const alphaHex = (share: number) =>
	Math.round(share * 255)
		.toString(16)
		.padStart(2, '0')

/** editmd tints an Agent's block with `color-mix(var(--agent) 13%, transparent)`; var() cannot fade a token, so the alpha is baked in */
const TINT_ALPHA = alphaHex(0.13)

/** editmd's changed text inside a Block, `.agent-change { background: color-mix(var(--agent) 18%, transparent) }` */
const CHANGE_ALPHA = alphaHex(0.18)

/** editmd's Deletion line, `color-mix(var(--agent) 70%, transparent)`, baked in as TINT_ALPHA is */
const DELETED_ALPHA = alphaHex(0.7)

/** editmd's `.agent-legend button:hover`: `color-mix(var(--text) 8%, transparent)`, baked in as TINT_ALPHA is */
const HOVER_ALPHA = alphaHex(0.08)

/** editmd's `--selection`, the accent at 22%, baked in as TINT_ALPHA is */
const SELECTION_ALPHA = alphaHex(0.22)

/** every colour token the views read through `var(--token)` */
export function paletteFor(appearance: Appearance): Palette {
	const palette: Palette = { ...BASE[appearance], ...APPKIT[appearance] }
	// the active find match: editmd shows WebKit's yellow find indicator behind it, and nothing on the other matches
	// (editmd's screenshot); a wash cannot recolour the text (gap G4), so the strong `mark` stands in for the yellow
	palette['find-active'] = BASE[appearance].mark
	// editmd's `.agent-unknown` sets `--agent`, so an Outside edit block takes the same 13% tint
	palette['agent-unknown-tint'] = `${BASE[appearance]['agent-unknown']}${TINT_ALPHA}`
	palette['agent-unknown-deleted'] = `${BASE[appearance]['agent-unknown']}${DELETED_ALPHA}`
	palette['agent-unknown-change'] = `${BASE[appearance]['agent-unknown']}${CHANGE_ALPHA}`
	palette['legend-hover'] = `${BASE[appearance].text}${HOVER_ALPHA}`
	// editmd's `--selection: color-mix(in srgb, var(--accent) 22%, transparent)`, the open front matter's focus ring
	palette.selection = `${BASE[appearance].accent}${SELECTION_ALPHA}`
	/**
	 * gpuix's Tooltip paints its tip in these, else in its own `#313244` and `#cdd6f4` whatever the appearance; editmd's
	 * tooltips are the system's, which the surface and the text colour come close to
	 */
	palette['tooltip-surface'] = BASE[appearance].surface
	palette['tooltip-ink'] = BASE[appearance].text
	/**
	 * gpuix's Scroller paints its thumb in these, else in its own dark slate `#585b70` whatever the appearance;
	 * editmd shows the system's overlay scroller, a quiet grey in light and dark, so faint, and muted on hover
	 */
	palette['scroller-thumb'] = BASE[appearance].faint
	palette['scroller-thumb-hover'] = BASE[appearance].muted
	AGENTS[appearance].forEach((colour, slot) => {
		palette[`agent-${slot}`] = colour
		palette[`agent-${slot}-tint`] = `${colour}${TINT_ALPHA}`
		palette[`agent-${slot}-deleted`] = `${colour}${DELETED_ALPHA}`
		palette[`agent-${slot}-change`] = `${colour}${CHANGE_ALPHA}`
	})
	return palette
}

/** editmd's `html { font: 16px/1.65 }` body text, which every `em` below is relative to */
const BODY_SIZE = 16
const BODY_LINE_HEIGHT = 1.65
/** editmd's h1, h2, h3 and h4 sizes in em; native <markdown> sizes h4-h6 as one tier */
const HEADING_SCALE = [2.1, 1.55, 1.25, 1.05]
const HEADING_LINE_HEIGHT = 1.25
const REM = 16
/**
 * every syntax token kind in one colour, written out: `SyntaxTheme` has a `constructor` key, which a built-up
 * object would inherit from Object.prototype as a Function and fail the type
 */
function syntaxIn(colour: string): NonNullable<GpuixTheme['syntax']> {
	return {
		comment: colour,
		keyword: colour,
		string: colour,
		stringSpecial: colour,
		escape: colour,
		number: colour,
		boolean: colour,
		typeName: colour,
		typeBuiltin: colour,
		constructor: colour,
		function: colour,
		functionBuiltin: colour,
		macroName: colour,
		property: colour,
		constant: colour,
		variable: colour,
		variableSpecial: colour,
		parameter: colour,
		operator: colour,
		punctuation: colour,
		tag: colour,
		attribute: colour,
		label: colour,
		invalid: colour
	}
}

/**
 * editmd's `--font-mono: ui-monospace, "SF Mono", Menlo` (style.css:14), which WebKit paints in the system's SF Mono.
 * GPUI resolves it by this name in native <markdown>'s theme (measured headless: ten `i`s 98.9px wide, SF Mono's advance,
 * against Menlo's 96.3px); "SF Mono", ".SF NS Mono" and "ui-monospace" do not. a <text> or <textarea> style refuses
 * every one of them (".SF NS Mono" dropped with a warning, the others painted in the default sans), so the fields
 * (Source mode, an open code or front matter field) keep Menlo; the read-only mono lines (front matter, definition
 * and HTML lines, diagram messages) paint through <markdown> as inline code, so they take SF Mono (src/app/monoLines.ts)
 */
const MONO_FONT = '.AppleSystemUIFontMonospaced'

/** float noise from the em multiplications would make theme values like 20.925000000000001 */
const round = (value: number) => Math.round(value * 1000) / 1000

/**
 * the `theme` for native <markdown> and <textarea>, which ignore CSS variables and otherwise paint in
 * gpuix's built-in Comet theme (14px/22px text, headings 19/16/15/14): editmd's colours and its
 * `.markdown-body` measurements from style.css, every metric in px and scaled by `zoom` like editmd's page zoom
 */
export function textThemeFor(appearance: Appearance, zoom = 1): GpuixTheme {
	const palette = BASE[appearance]
	const px = (cssPixels: number) => round(cssPixels * zoom)
	return {
		appearance,
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
		fontMono: MONO_FONT,
		// editmd's code blocks have no syntax colours
		syntax: syntaxIn(palette.text),
		metrics: {
			mdTextSize: px(BODY_SIZE),
			mdLineHeight: px(BODY_SIZE * BODY_LINE_HEIGHT),
			// paragraphs, lists, quotes, code and tables have `margin: 0 0 1em`
			mdBlockGap: px(BODY_SIZE),
			mdHeadingSizes: HEADING_SCALE.map((em) => px(BODY_SIZE * em)),
			mdHeadingLineHeights: HEADING_SCALE.map((em) => px(BODY_SIZE * em * HEADING_LINE_HEIGHT)),
			// `pre`: 13.5px/1.55, padding 0.9rem 1.1rem, radius 8px; inline `code` radius 5px
			codeTextSize: px(13.5),
			codeLineHeight: px(13.5 * 1.55),
			mdCodePaddingX: px(1.1 * REM),
			mdCodePaddingY: px(0.9 * REM),
			mdCodeRadius: px(8),
			mdInlineCodeRadius: px(5)
		}
	}
}

/** editmd's `.markdown-body table { font-size: 0.94em }` (style.css:322), the body's line-height kept */
const TABLE_SCALE = 0.94

/** the `theme` a table cell's native <markdown> paints in: `theme` with editmd's 0.94em text at `zoom` */
export function tableThemeFor(theme: GpuixTheme, zoom = 1): GpuixTheme {
	const size = round(BODY_SIZE * TABLE_SCALE * zoom)
	return {
		...theme,
		metrics: {
			...theme.metrics,
			mdTextSize: size,
			mdLineHeight: round(size * BODY_LINE_HEIGHT)
		}
	}
}

/** a colour with no alpha, which GPUI paints as nothing */
export const NO_FILL = '#00000000'

/**
 * the `theme` a Block holding a link with no text paints in: editmd shows such a link as its source,
 * `a.empty-link::before { content: "[](" attr(href) ")"; font: 0.86em var(--font-mono) }` (style.css:363-366), in the
 * link's accent and with no fill. native <markdown> paints it as inline code (paintedSlice), so the code wash goes
 * and code takes the accent; a Block with inline code of its own (`hasCode`) keeps `theme`, so its code keeps
 * editmd's pill
 */
export function emptyLinkThemeFor(theme: GpuixTheme, hasCode: boolean): GpuixTheme {
	if (hasCode) return theme
	return { ...theme, codeWash: NO_FILL, codeText: theme.caret ?? theme.codeText }
}

/**
 * the `theme` a Block holding inline HTML paints in: editmd shows each tag as its source, `span[data-type="html"] {
 * font: 0.86em var(--font-mono); color: var(--muted) }` (style.css:346-349), with no fill. native <markdown> paints it
 * as inline code (paintedSlice), so the code wash goes and code takes the muted colour; a Block with inline code of
 * its own (`hasCode`) keeps `theme`, so its code keeps editmd's pill
 */
export function inlineHtmlThemeFor(theme: GpuixTheme, hasCode: boolean): GpuixTheme {
	if (hasCode) return theme
	return { ...theme, codeWash: NO_FILL, codeText: theme.textMuted }
}

/**
 * the `theme` a Block holding a link paints in while ⌘ is held: editmd's `body.cmd-down a { text-decoration-color:
 * currentColor }` (style.css:178-181) turns the underline to the link's own colour. native <markdown> paints a link
 * in the theme's `text` and its underline in `textMuted`, so `textMuted` takes the text colour
 */
export function heldLinkThemeFor(theme: GpuixTheme): GpuixTheme {
	return { ...theme, textMuted: theme.text }
}

/** editmd's `.markdown-body a { text-decoration-color: color-mix(var(--accent) 35%, transparent) }` */
const LINK_UNDERLINE_ALPHA = alphaHex(0.35)

/**
 * the `theme` a Block holding a link paints in: editmd underlines a link in the accent at 35%, and while ⌘ is held in
 * the link's own colour, the accent (style.css:170-181), wherever it sits. native <markdown> draws a link's underline in
 * `textMuted` (and a strike line with it, which editmd draws in the text colour)
 */
export function linkThemeFor(theme: GpuixTheme, held: boolean): GpuixTheme {
	// the page's caret is editmd's accent (`emptyLinkThemeFor`)
	const accent = theme.caret ?? theme.textMuted
	return { ...theme, textMuted: held ? accent : `${accent}${LINK_UNDERLINE_ALPHA}` }
}

/**
 * the `theme` of a list item's text: its paragraphs stack with no gap between them, as editmd's `li > p { margin: 0 }`
 * (style.css:235), where native <markdown> puts its block gap
 */
export function listItemThemeFor(theme: GpuixTheme): GpuixTheme {
	return { ...theme, metrics: { ...theme.metrics, mdBlockGap: 0 } }
}

/**
 * the `theme` of muted text (a quote, a ticked task, a footnote, an h6): native <markdown> ignores CSS, so the muted
 * colour goes in as its `text`, and its inline code, which editmd's `code` inherits from its text (style.css:185-191),
 * as `codeText`. a link's underline, native's `textMuted`, steps down to the faint colour, one below the text as the
 * muted underline is below the body's, so ⌘ (`heldLinkThemeFor`) still turns it to the text colour of that place
 */
export function mutedThemeFor(theme: GpuixTheme): GpuixTheme {
	return {
		...theme,
		text: theme.textMuted,
		codeText: theme.textMuted,
		textMuted: theme.textFaint ?? theme.textMuted
	}
}

/**
 * the `theme` of a field outside the page, which keeps the system caret in its own text colour: editmd draws its
 * accent caret only in `.markdown-body` (style.css:105-120), so Source mode's `.source` caret is the text colour and
 * front matter's `pre.frontmatter` caret its muted text (frontmatter.ts:20-22). `colour` is the field's text colour,
 * the theme's own `text` when left out
 */
export function plainFieldThemeFor(theme: GpuixTheme, colour?: string): GpuixTheme {
	const text = colour ?? theme.text
	return { ...theme, text, caret: text }
}

/** editmd's h5 and h6 sizes in em, which native <markdown> would paint in its h4 tier */
const SMALL_HEADING_SCALE: Partial<Record<number, number>> = { 5: 0.95, 6: 0.9 }

/**
 * the `theme` a heading of `level` paints in, from the Blocks' `theme` at `zoom`: native <markdown> has one tier
 * for h4-h6, so an h5 or h6 puts its own size (line-height 1.25) into that fourth tier, and an h6 paints in the
 * muted colour, its inline code too (`h6 { font-size: 0.9em; color: var(--muted) }`, `mutedThemeFor`). every other
 * level gets `theme` itself
 */
export function headingThemeFor(theme: GpuixTheme, level: number, zoom = 1): GpuixTheme {
	const em = SMALL_HEADING_SCALE[level]
	if (em === undefined) return theme
	const { metrics = {} } = theme
	const size = round(BODY_SIZE * em * zoom)
	const withTier = (tiers: number[] | undefined, value: number) => {
		const next = [...(tiers ?? [])]
		next[3] = value
		return next
	}
	return {
		...(level === 6 ? mutedThemeFor(theme) : theme),
		metrics: {
			...metrics,
			mdHeadingSizes: withTier(metrics.mdHeadingSizes, size),
			mdHeadingLineHeights: withTier(
				metrics.mdHeadingLineHeights,
				round(size * HEADING_LINE_HEIGHT)
			)
		}
	}
}

/**
 * editmd's margins around the Blocks in CSS px, which `spaceAbove` (blockSpacing.ts) collapses between two
 * neighbours: `p, ul, ol, blockquote, pre, table, dl { margin: 0 0 1em }`, headings `margin: 1.6em 0 0.6em` in
 * their own em (2.1, 1.55, 1.25, 1.05, 0.95 and 0.9 of the 16px body), `hr { margin: 2em 0 }` and
 * `.frontmatter { margin: 0 0 2rem }`
 */
export const BLOCK_MARGINS = {
	'block-bottom': 16,
	'heading-1-top': 53.76,
	'heading-1-bottom': 20.16,
	'heading-2-top': 39.68,
	'heading-2-bottom': 14.88,
	'heading-3-top': 32,
	'heading-3-bottom': 12,
	'heading-4-top': 26.88,
	'heading-4-bottom': 10.08,
	'heading-5-top': 24.32,
	'heading-5-bottom': 9.12,
	'heading-6-top': 23.04,
	'heading-6-bottom': 8.64,
	'rule-margin': 32,
	'frontmatter-bottom': 32,
	// a Deletion's line, `.agent-deleted.between { margin: 0.2rem 0 }`
	'deleted-margin': 3.2
} as const

export type BlockMargin = keyof typeof BLOCK_MARGINS

/**
 * editmd's `ul, ol { padding-left: 1.75em }` of the 16px body (style.css:230-233): an item's text sits this far in
 * per level of nesting, its marker in the gutter before it
 */
export const LIST_INDENT = 28

/**
 * the views' own lengths in CSS px at actual size, each read as `var(--size-<name>)`. only what editmd paints
 * inside its web page is here, since WKWebView's pageZoom scales the page and nothing around it: the save-status
 * label, the scrollbar and the link dialog (an NSAlert in editmd) stay out, and so do 1px hairline borders,
 * which WebKit snaps to whole device pixels
 */
const SIZES: Record<string, number> = {
	// editmd's `#editor { max-width: 46rem; padding: 3rem 2.5rem 40vh }`; the 40vh is a share of the window, not zoomed
	'page-measure': 736,
	'page-padding-top': 48,
	'page-padding-x': 40,
	...BLOCK_MARGINS,
	// h1 `padding-bottom: 0.25em` and h2 `0.2em`, in their own em, above their 1px bottom rule
	'heading-1-rule-padding': 8.4,
	'heading-2-rule-padding': 4.96,
	// `blockquote { padding: 0 1em; border-left: 0.25em solid var(--border) }`
	'quote-rail': 4,
	'quote-padding': 16,
	// a code block's language label, `pre[data-language]::before { font: 11px; top: 0.35rem; right: 0.6rem }`
	'code-label': 11,
	'code-label-right': 9.6,
	/**
	 * an Agent highlight, editmd's `.agent-block { box-shadow: -6px 0 0 var(--tint), -8px 0 0 var(--agent) }`
	 * (style.css:474-479), square: the agent shadow shows 8px left of the Block, and the translucent tint shadow over
	 * it from 6px leaves it the agent's colour, so an 8px solid bar, the tint on the Block alone. box-shadows move
	 * nothing, so the Block reaches out by the bar (`agent-outset`) and its text stays where a plain Block's is
	 */
	'agent-rail': 8,
	'agent-inset': 0,
	'agent-outset': -8,
	// a Deletion's line, `border-top: 2px` (dashed in editmd; gpuix has no dashed border, remorses/gpuix#60)
	'deleted-line': 2,
	// `.frontmatter { padding: 0.75rem 1rem; font: 12.5px/1.55 var(--font-mono); border-radius: 8px }`
	'frontmatter-padding-y': 12,
	'frontmatter-padding-x': 16,
	'frontmatter-radius': 8,
	'frontmatter-text': 12.5,
	'frontmatter-line-height': 19.375,
	// open, `.frontmatter:focus { box-shadow: 0 0 0 2px var(--selection) }` as an outline outside the box
	'frontmatter-focus-ring': 2,
	// Source mode's field, `.source { font: 14px/1.6 var(--font-mono) }`
	'source-text': 14,
	'source-line-height': 22.4,
	// an open code or mermaid Block's field in its `pre` card: 13.5px/1.55, `padding: 0.9rem 1.1rem`, radius 8px
	'code-text': 13.5,
	'code-line-height': 20.925,
	'code-padding-y': 14.4,
	'code-padding-x': 17.6,
	'code-radius': 8,
	/**
	 * a footnote reference is a `sup` (style.css:370-374), which makes its line taller than the body's: the r-footnotes
	 * shots set the paragraph's text 2px lower than r-html's, and everything below it with it
	 */
	'footnote-sup-rise': 2,
	/**
	 * a code block's `div.code-block` holds a diagram box that `hidden` cannot hide (diagrams.ts:78-87, `.diagram {
	 * display: flex }`): below the card come the pre's `margin: 0 0 1em` of its 13.5px and the empty box's `padding:
	 * 1rem`, then its 1em margin, which collapses with the next Block's as the card's own would
	 */
	'code-margin': 13.5,
	'hidden-diagram': 32,
	// a footnote definition's `padding-top: 0.5em`, of its 0.9em
	'footnote-inset': 7.2,
	// editmd's footnote label: 0.9 of the 16px body
	'footnote-label': 14.4,
	// a list's rows, editmd's `li + li { margin-top: 0.2em }` and `li > ul { margin: 0.2em 0 0 }`
	'list-gap': 3.2,
	'list-indent': LIST_INDENT,
	// one row of the 16px/1.65 body, which a marker's number is set in so its baseline meets the text's
	'list-line-height': 26.4,
	/**
	 * the browser's disc, circle and square markers, measured in editmd's screenshot: about 6px across, centred 14.5px
	 * before the text and 14px below the row's top, so 10.5px into the gutter and 11px down
	 */
	'list-bullet': 6,
	'list-bullet-left': 10.5,
	'list-bullet-top': 11,
	// an `ol`'s number ends one space of the 16px system font before the text, as the marker's "1. " does
	'list-number-gap': 4.4,
	/**
	 * a task's box, `li[data-item-type="task"]::before { left: -1.55em; top: 0.3em; width: 1em; border-radius: 4px }`:
	 * 3.2px into the 28px gutter, and 5.5px down, the 4.8px of `top` plus the 0.7px GPUI sets its text lower in the
	 * line than WebKit (r-tasks shots: the box's centre 0.25px above the text's ink centre in both)
	 */
	checkbox: 16,
	'checkbox-left': 3.2,
	'checkbox-offset': 5.5,
	'checkbox-radius': 4,
	/**
	 * text with no size of its own paints at GPUI's 16px and so never zooms: a bullet or number marker
	 * and a blocked image's alt text take these instead, 16px at actual size, so zoom 1 paints them at GPUI's own 16px
	 */
	'list-marker': 16,
	'images-gap': 8,
	// the box an image of unknown size paints in
	'image-fallback': 240,
	'image-alt': 16,
	// `img { border-radius: 4px }`
	'image-radius': 4,
	// a blocked image's `.remote-image` box in its own 0.9em: gap 0.35em, padding 0.05em 0.45em, the icon 1em square
	'remote-image-text': 14.4,
	'remote-image-gap': 5.04,
	'remote-image-padding-y': 0.72,
	'remote-image-padding-x': 6.48,
	// the space between an inline image and the text after it: one space of the 16px system font
	'inline-gap': 4.4,
	// editmd's `.diagram { padding: 1rem; border-radius: 8px }`
	'diagram-padding': 16,
	'diagram-radius': 8,
	// a table's `font-size: 0.94em`, and its cells' `padding: 0.4em 0.85em` of it (style.css:322-327)
	'table-text': 15.04,
	'table-cell-padding-y': 6.016,
	'table-cell-padding-x': 12.784,
	// the Agent legend, editmd's `.agent-legend` rules (rem at 16px): it floats in the page's bottom-right corner
	'legend-inset': 16,
	'legend-gap': 2,
	'legend-width': 288,
	'legend-padding': 5.6,
	'legend-radius': 8,
	// 12px/1.4
	'legend-text': 12,
	'legend-line-height': 16.8,
	// the AGENTS header, its padding `0.05rem 0 0.1rem 0.4rem`
	'legend-header-text': 11,
	'legend-header-padding-top': 0.8,
	'legend-header-padding-bottom': 1.6,
	'legend-header-padding-left': 6.4,
	// the – and × buttons are 1.4rem squares; every legend button has a 5px radius
	'legend-button': 22.4,
	'legend-button-radius': 5,
	'legend-minimize-text': 13,
	// a row's name button: its dot, name and count
	'legend-name-gap': 7.2,
	'legend-name-padding-y': 3.2,
	'legend-name-padding-x': 6.4,
	'legend-dot': 9.6,
	'legend-dot-radius': 4.8,
	'legend-count-gap': 8,
	'legend-rename-margin': 1.6,
	'legend-rename-padding-y': 2.4,
	'legend-rename-padding-x': 5.6,
	'legend-clear-all-gap': 2,
	// minimized: the legend's own padding, then the pill inside it
	'legend-pill-outer': 3.2,
	'legend-pill-gap': 4.8,
	'legend-pill-padding-y': 4,
	'legend-pill-padding-x': 8.8,
	'legend-pill-radius': 999,
	'legend-pill-count-gap': 3.2
}

/**
 * the window chrome's lengths in px, which never zoom: editmd's find bar is an AppKit view stacked above the
 * WKWebView, so pageZoom leaves it alone. NSStackView spacing 8 and edge insets 6/10, a separator line, and
 * small controls (NSControl.ControlSize.small: 11pt text, about 20px tall)
 */
const CHROME_SIZES: Record<string, number> = {
	'find-gap': 8,
	'find-padding-y': 6,
	'find-padding-x': 10,
	'find-separator': 1,
	'find-text': 11,
	'find-control-height': 20,
	'find-control-padding-x': 8,
	'find-control-radius': 5,
	'find-chevron': 12,
	// a small NSSearchField's magnifier and clear glyphs, and the space around them inside its bezel
	'find-glyph': 12,
	'find-glyph-gap': 5,
	// the save-status label, an NSTextField in the title bar in `NSFont.smallSystemFontSize` (EditorWindowController.swift:340)
	'status-text': 11
}

/**
 * the length tokens set with `set_css_vars` (keys without `--`): the page's every one scaled by `zoom` like
 * editmd's page zoom, the window chrome's at actual size
 */
export function sizeTokensFor(zoom: number): Palette {
	const tokens = (sizes: Record<string, number>, scale: number) =>
		Object.entries(sizes).map(([name, cssPixels]) => [
			`size-${name}`,
			`${round(cssPixels * scale)}px`
		])
	return Object.fromEntries([...tokens(SIZES, zoom), ...tokens(CHROME_SIZES, 1)])
}

/**
 * mermaid's own `default` and `dark` themes, which editmd draws diagrams in (diagrams.ts:30), sampled from
 * editmd's `--snapshot` of a flowchart: node fill, node border, edge line and label text
 */
const MERMAID_THEME: Record<Appearance, Record<'surface' | 'border' | 'line' | 'fg', string>> = {
	light: { surface: '#ececff', border: '#9370db', line: '#333333', fg: '#333333' },
	dark: { surface: '#1f2020', border: '#cccccc', line: '#d3d3d3', fg: '#cccccc' }
}

/** pele's theme variables (keys without `--`), inlined into its SVG since GPUI's decoder drops var() */
export function mermaidPaletteFor(appearance: Appearance): Palette {
	const palette = BASE[appearance]
	const theme = MERMAID_THEME[appearance]
	return {
		'pele-bg': palette.background,
		'pele-fg': theme.fg,
		'pele-muted': palette.muted,
		'pele-line': theme.line,
		'pele-surface': theme.surface,
		'pele-surface-alt': palette.background,
		'pele-border': theme.border,
		'pele-accent': theme.border,
		'pele-font': 'Helvetica'
	}
}
