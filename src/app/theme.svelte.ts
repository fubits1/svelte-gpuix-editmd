import { type GpuixTheme, set_css_vars } from 'gpuix-svelte'
import { getContext, setContext, untrack } from 'svelte'
import { type Appearance, readSystemAppearance, systemAppearance } from '../host/appearance.ts'
import { readScrollerStyle, type ScrollerStyle } from '../host/scrollerStyle.ts'
import {
	mermaidPaletteFor,
	mutedThemeFor,
	NO_FILL,
	paletteFor,
	sizeTokensFor,
	textThemeFor
} from './palette.ts'
import { zoomIn, zoomOut } from './zoom.ts'

export type ThemeOptions = {
	/**
	 * light or dark right now, polled; `readSystemAppearance` asks macOS through `defaults` without blocking.
	 * a reader may also answer synchronously
	 */
	readAppearance?: () => Appearance | Promise<Appearance>
	/**
	 * the appearance the first paint uses, read once and synchronously at construction so the window never
	 * flashes the wrong palette. without it a synchronous `readAppearance` answers, else `systemAppearance`
	 */
	initialAppearance?: () => Appearance
	/** ms between two reads, so a system switch shows within that time */
	pollInterval?: number
	/**
	 * AppKit's scroller style, read once as the window starts: `readScrollerStyle` (osascript) by default. a reader may
	 * also answer synchronously
	 */
	readScrollerStyle?: () => ScrollerStyle | Promise<ScrollerStyle>
}

/**
 * how long an overlay scroller stays up after the page last scrolled, about AppKit's: editmd's web view hides its
 * thumb a second or so after a scroll ends
 */
const SCROLLER_LINGER_MS = 1000

/** the thumb's colours while an overlay scroller is hidden: gpuix's Scroller paints its thumb in these */
const HIDDEN_THUMB = { 'scroller-thumb': NO_FILL, 'scroller-thumb-hover': NO_FILL }

/**
 * the window's appearance and zoom, and everything painted from them: the colour tokens every view reads
 * through `var(--token)`, the `theme` native <markdown> and <textarea> take, and pele's diagram palette.
 * gpuix has no appearance-change event, so editmd's live following of the system is a poll
 */
export class ThemeController {
	#readAppearance: () => Appearance | Promise<Appearance>
	#pollInterval: number
	appearance = $state<Appearance>('light')
	/** editmd's View > Zoom: its WKWebView pageZoom, 1 at actual size */
	zoom = $state(1)
	/** every colour token the views read through `var(--token)` */
	palette = $derived(paletteFor(this.appearance))
	/** the `theme` every native <markdown> and <textarea> takes, since they ignore CSS variables */
	textTheme = $derived(textThemeFor(this.appearance, this.zoom))
	/** the same at actual size, for text fields in the window chrome (the find bar), which editmd never zooms */
	chromeTextTheme = $derived(textThemeFor(this.appearance))
	/** pele's theme variables (keys without `--`), inlined into its SVG since GPUI's decoder drops var() */
	mermaidPalette = $derived(mermaidPaletteFor(this.appearance))
	/** the views' own lengths, read through `var(--size-…)` */
	sizeTokens = $derived(sizeTokensFor(this.zoom))
	#readScrollerStyle: () => ScrollerStyle | Promise<ScrollerStyle>
	/** AppKit's scroller style; overlay until it is read, so no thumb flashes up on a Mac that hides it */
	scrollerStyle = $state<ScrollerStyle>('overlay')
	/** the page scrolled within the last SCROLLER_LINGER_MS (`pageScrolled`) */
	#scrolling = $state(false)
	#scrollingEnds: ReturnType<typeof setTimeout> | undefined = undefined
	/** the page's scrollbar thumb shows: always in the legacy style, in the overlay style while the page scrolls */
	scrollerShown = $derived(this.scrollerStyle === 'legacy' || this.#scrolling)

	constructor({
		readAppearance,
		initialAppearance,
		pollInterval = 2000,
		readScrollerStyle: scrollerReader = readScrollerStyle
	}: ThemeOptions = {}) {
		this.#readAppearance = readAppearance ?? readSystemAppearance
		this.#pollInterval = pollInterval
		this.appearance = initialAppearance?.() ?? firstAnswerOf(readAppearance)
		this.#readScrollerStyle = scrollerReader
	}

	/** the page scrolled: an overlay scroller shows now and hides SCROLLER_LINGER_MS after the last scroll */
	pageScrolled(): void {
		this.#scrolling = true
		clearTimeout(this.#scrollingEnds)
		this.#scrollingEnds = setTimeout(() => (this.#scrolling = false), SCROLLER_LINGER_MS)
	}

	/** View > Zoom In, Cmd-= */
	zoomIn(): void {
		this.zoom = zoomIn(this.zoom)
	}

	/** View > Zoom Out, Cmd-- */
	zoomOut(): void {
		this.zoom = zoomOut(this.zoom)
	}

	/** View > Actual Size, Cmd-0 */
	actualSize(): void {
		this.zoom = 1
	}

	/**
	 * a length computed from content (a list's indent, a diagram's or an image's natural size) at the current
	 * zoom; fixed lengths go through the size tokens instead. rounded like the tokens, against float noise
	 */
	scaled(cssPixels: number): number {
		return Math.round(cssPixels * this.zoom * 1000) / 1000
	}

	/**
	 * sets the colour and size tokens now and again whenever they change, and polls the appearance; returns the stop. the
	 * window's root calls it from an `$effect`, so the poll lives exactly as long as the window's content
	 */
	start(): () => void {
		// a hidden overlay scroller's thumb paints nothing in place of the palette's colours
		const apply = () =>
			set_css_vars({
				...this.palette,
				...this.sizeTokens,
				...(this.scrollerShown ? {} : HIDDEN_THUMB)
			})
		// at once, before the first paint resolves any var(); untracked, so a caller's $effect does not restart on a change
		untrack(apply)
		const stopApplying = $effect.root(() => {
			$effect(apply)
		})
		let stopped = false
		let reading = false
		// once, as the window starts: a reader that throws or rejects keeps the overlay style
		new Promise<ScrollerStyle>((resolve) => resolve(this.#readScrollerStyle())).then(
			(style) => {
				if (!stopped) this.scrollerStyle = style
			},
			() => {}
		)
		const poll = setInterval(() => {
			// one read at a time: a slow `defaults` skips the ticks it overlaps instead of stacking spawns
			if (reading) return
			reading = true
			// a reader that throws or rejects keeps the current appearance, as `systemAppearance` falls back to light
			new Promise<Appearance>((resolve) => resolve(this.#readAppearance()))
				.then(
					(appearance) => {
						// an answer that lands after stop() belongs to a window that is gone
						// an unchanged answer is no change to $state, so the steady poll repaints nothing
						if (!stopped) this.appearance = appearance
					},
					() => {}
				)
				.finally(() => {
					reading = false
				})
		}, this.#pollInterval)
		return () => {
			stopped = true
			clearInterval(poll)
			clearTimeout(this.#scrollingEnds)
			stopApplying()
		}
	}
}

/**
 * the first paint's appearance without `initialAppearance`: an injected reader's own answer when it gives one
 * synchronously, else one blocking `systemAppearance` (4.11ms median), paid once rather than every 2s
 */
function firstAnswerOf(readAppearance: ThemeOptions['readAppearance']): Appearance {
	const answer = readAppearance?.()
	return typeof answer === 'string' ? answer : systemAppearance()
}

/** the one window's ThemeController (one window per process, ADR-0008) */
export const themeController = new ThemeController()

/** reads the ThemeController a view paints from, at the time of reading, so a root may swap it */
export type ThemeReader = () => ThemeController

const THEME_KEY = Symbol('theme')

/** hands every view below the calling component its ThemeController; App passes the one its prop holds */
export function provideTheme(read: ThemeReader): void {
	setContext(THEME_KEY, read)
}

/** the ThemeController a root component provided, or the process's own when a view is mounted without one */
export function useTheme(): ThemeReader {
	return getContext<ThemeReader | undefined>(THEME_KEY) ?? (() => themeController)
}

const COMMAND_HELD_KEY = Symbol('command held')

/**
 * hands every view below the calling component whether ⌘ is held, read at the time of reading: editmd's `cmd-down`
 * body class (main.ts:48-54), which turns a link's cursor to the pointer and its underline to its own colour
 */
export function provideCommandHeld(read: () => boolean): void {
	setContext(COMMAND_HELD_KEY, read)
}

/** whether ⌘ is held, as the document view provided it; never, for a view mounted without one */
export function useCommandHeld(): () => boolean {
	return getContext<(() => boolean) | undefined>(COMMAND_HELD_KEY) ?? (() => false)
}

const QUOTED_KEY = Symbol('quoted')

/** every view below the calling component paints inside a quote */
export function provideQuoted(): void {
	setContext(QUOTED_KEY, true)
}

/**
 * a text theme in the colour of the place a view paints in: muted inside a quote, as everything there inherits
 * editmd's `blockquote { color: var(--muted) }` (style.css:222-226), and as given anywhere else
 */
export function useQuoteColour(): (theme: GpuixTheme) => GpuixTheme {
	return getContext<boolean | undefined>(QUOTED_KEY) ? mutedThemeFor : (theme) => theme
}
