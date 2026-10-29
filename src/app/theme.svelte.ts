import { set_css_vars } from 'gpuix-svelte'
import { getContext, setContext, untrack } from 'svelte'
import { type Appearance, readSystemAppearance, systemAppearance } from '../host/appearance.ts'
import { mermaidPaletteFor, paletteFor, sizeTokensFor, textThemeFor } from './palette.ts'
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
}

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

	constructor({ readAppearance, initialAppearance, pollInterval = 2000 }: ThemeOptions = {}) {
		this.#readAppearance = readAppearance ?? readSystemAppearance
		this.#pollInterval = pollInterval
		this.appearance = initialAppearance?.() ?? firstAnswerOf(readAppearance)
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
		const apply = () => set_css_vars({ ...this.palette, ...this.sizeTokens })
		// at once, before the first paint resolves any var(); untracked, so a caller's $effect does not restart on a change
		untrack(apply)
		const stopApplying = $effect.root(() => {
			$effect(apply)
		})
		let stopped = false
		let reading = false
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
