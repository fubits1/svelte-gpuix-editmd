<!--
  @component
  A native tip, as AppKit shows a view's `toolTip` and WebKit an element's `title`: once the pointer has rested on the
  trigger past the delay, the text shows below-right of where the pointer was, kept inside the window, and goes when
  the pointer leaves. `text` may depend on where on the trigger the pointer is (a changed run's or a titled link's
  painted boxes), a tip with other words showing afresh after the delay. The trigger, the `children` snippet's element,
  spreads the handlers it is passed, none while `text` is null. Of nested triggers only
  the one the pointer entered last shows its tip, as a browser shows the innermost `title`; the tip takes no clicks and
  no hover.
-->
<script module lang="ts">
	import type { GpuixEvent } from 'gpuix-svelte'

	/** the handlers a trigger spreads, which tell its tip where the pointer is; empty while there is no tip */
	type PointerHandlers = Partial<{
		onmouseenter: (event: GpuixEvent) => void
		onmousemove: (event: GpuixEvent) => void
		onmouseleave: () => void
	}>

	/** the triggers under the pointer, in the order it entered them: the last is the innermost, whose tip may show */
	const hovered = $state<symbol[]>([])

	/** takes `trigger` out of `hovered`, where it is at most once */
	function unhover(trigger: symbol): void {
		const at = hovered.indexOf(trigger)
		if (at >= 0) hovered.splice(at, 1)
	}
</script>

<script lang="ts">
	import { onDestroy, type Snippet } from 'svelte'

	let {
		text,
		testid,
		children
	}: {
		/** what the tip says, or what it says with the pointer at window point (`x`, `y`); null for no tip there */
		text: string | null | ((x: number, y: number) => string | null)
		/** the tip's box is `<testid>-tip` */
		testid: string
		children: Snippet<[PointerHandlers]>
	} = $props()

	/** what the tip says with the pointer at window point (`x`, `y`), null for none */
	const textAt = (x: number, y: number) => (typeof text === 'function' ? text(x, y) : text)

	/** how long the pointer rests on the trigger before its tip shows: gpuix Tooltip's hover delay */
	const DELAY_MS = 300

	/**
	 * a native tip starts below-right of the pointer, past the arrow cursor's body: NSCursor.arrow paints 9.3pt right
	 * of and 15.7pt below its hot spot (measured on this macOS, its image's opaque pixels)
	 */
	const OFFSET = { x: 9, y: 16 }

	/** the room kept from the window's edges, where a native tip moves back inside the screen */
	const EDGE_MARGIN = 4

	/** this trigger in `hovered`: a symbol, which `$state` keeps as it is where it would proxy an object */
	const self = Symbol('pointer tip')

	/** the last pointer position over the trigger, null while it is elsewhere; nothing renders from it */
	let pointer: { x: number; y: number } | null = null

	/** where the shown tip hangs from: the pointer once it rested, fixed while the tip shows; transient UI (ADR-0011) */
	let shownAt = $state<{ x: number; y: number } | null>(null)
	let timer: ReturnType<typeof setTimeout> | undefined

	/** what this trigger's tip says where the pointer rests: on it, innermost, and where `text` gives words; else null */
	function wanted(): string | null {
		return pointer !== null && hovered.at(-1) === self ? textAt(pointer.x, pointer.y) : null
	}

	/**
	 * the tip waits out the delay while wanted and goes at once when not, or when the pointer moved onto other words,
	 * which wait out the delay afresh
	 */
	function sync(): void {
		const words = wanted()
		if (words === null || (shownAt !== null && textAt(shownAt.x, shownAt.y) !== words)) {
			clearTimeout(timer)
			timer = undefined
			shownAt = null
		}
		if (words === null || shownAt !== null || timer !== undefined) return
		timer = setTimeout(() => {
			timer = undefined
			if (wanted() !== null && pointer) shownAt = { ...pointer }
		}, DELAY_MS)
	}

	function track(event: GpuixEvent): void {
		if (event.x !== undefined && event.y !== undefined) pointer = { x: event.x, y: event.y }
		if (!hovered.includes(self)) hovered.push(self)
		sync()
	}

	const handlers: PointerHandlers = {
		onmouseenter: track,
		onmousemove: track,
		onmouseleave: () => {
			pointer = null
			unhover(self)
			sync()
		}
	}

	/**
	 * a trigger with no tip hears no pointer, so it hides no outer tip and keeps the listeners it had: a Block that
	 * hears moves took a linked image's click before the image did (measured headless)
	 */
	const NO_HANDLERS: PointerHandlers = {}

	onDestroy(() => {
		clearTimeout(timer)
		unhover(self)
	})
</script>

{@render children(text === null ? NO_HANDLERS : handlers)}
<!-- a nested trigger entered since hides this tip at once, before the pointer's next move tells this one -->
{#if shownAt !== null && hovered.at(-1) === self}
	<!-- a 0×0 box out of the trigger's flow: the tip hangs from the window point, wherever the box sits -->
	<div class="tip-layer">
		<anchored
			position={shownAt}
			anchor="topLeft"
			offset={OFFSET}
			fit="snap"
			snapMargin={EDGE_MARGIN}
			occlude={false}
		>
			<div class="tip" testid={`${testid}-tip`}>{textAt(shownAt.x, shownAt.y)}</div>
		</anchored>
	</div>
{/if}

<style>
	.tip-layer {
		position: absolute;
		left: 0;
		top: 0;
		width: 0;
		height: 0;
	}
	/* gpuix Tooltip's tip box, in the palette's `--tooltip-*` colours (palette.ts) */
	.tip {
		padding: 4px 8px;
		border-radius: 6px;
		font-size: 12px;
		line-height: 16px;
		white-space: nowrap;
		user-select: none;
		background-color: var(--tooltip-surface);
		color: var(--tooltip-ink);
	}
</style>
