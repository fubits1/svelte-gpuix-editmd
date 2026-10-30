<!--
  @component
  editmd's Safari-style find bar (EditorWindowController.swift `FindBar`): a search field, previous and next chevrons
  and Done in a row above the document, a separator line below. It is part of the window's layout, not an overlay,
  and window chrome, so it does not zoom. State lives in `findController`.
-->
<script lang="ts">
	import type { ShadowNode } from 'gpuix-svelte'
	import { untrack } from 'svelte'
	import { keysOnceFocused } from '../app/fieldKeys.ts'
	import { findController } from '../app/find.svelte.ts'
	import { magnifierGlyph } from '../app/glyphs.ts'
	import { useTheme } from '../app/theme.svelte.ts'

	const theme = useTheme()

	/**
	 * editmd's `setResult(found:)`: the label colour, or AppKit's systemRed when the query matches nothing
	 * (EditorWindowController.swift:301)
	 */
	const fieldTheme = $derived({
		...theme().chromeTextTheme,
		text: findController.notFound ? theme().palette['system-red'] : theme().palette.text
	})

	/** an SF Symbols-like chevron; GPUI's SVG decoder drops var(), so the colour is inlined */
	function chevron(direction: 'left' | 'right', colour: string | undefined): string {
		const path = direction === 'left' ? 'M7.5 2.5 4 6l3.5 3.5' : 'M4.5 2.5 8 6 4.5 9.5'
		return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><path d="${path}" fill="none" stroke="${colour ?? 'currentColor'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
	}

	/** half the length and half the width of each bar of the clear button's ×, in its 12-unit box */
	const CROSS_ARM = 2.8
	const CROSS_HALF_WIDTH = 0.65

	/** the × as one outline: a plus of two bars, turned 45° about the box's centre */
	function crossOutline(): string {
		const [arm, half] = [CROSS_ARM, CROSS_HALF_WIDTH]
		const plus: [number, number][] = [
			[half, arm],
			[half, half],
			[arm, half],
			[arm, -half],
			[half, -half],
			[half, -arm],
			[-half, -arm],
			[-half, -half],
			[-arm, -half],
			[-arm, half],
			[-half, half],
			[-half, arm]
		]
		const turned = plus.map(([x, y]) => [6 + (x - y) / Math.SQRT2, 6 + (x + y) / Math.SQRT2])
		return `M${turned.map(([x, y]) => `${x!.toFixed(3)} ${y!.toFixed(3)}`).join('L')}Z`
	}

	/**
	 * NSSearchField's cancel button (SF Symbols `xmark.circle.fill`): a disc with the × cut out of it. GPUI paints an
	 * SVG as a mask in the element's `color`, whatever fills it names (measured: disc and × both painted the bar's text
	 * colour), so the × is a hole, an even-odd path, through which the field's own background shows: dark on the light
	 * disc in dark mode, white on the grey one in light
	 */
	/** ⌘F with a query in the field selects it (`cmd-a`), as NSSearchField does, so typing replaces it */
	function selectQuery(node: ShadowNode): void {
		if (untrack(() => findController.takeSelectQuery())) void keysOnceFocused(node, 'cmd-a')
	}

	const CLEAR_GLYPH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><path fill-rule="evenodd" d="M6 0A6 6 0 1 1 6 12A6 6 0 1 1 6 0Z${crossOutline()}"/></svg>`
</script>

<div class="find-bar" testid="find-bar">
	<!-- editmd's NSSearchField: the magnifier inside its left edge, the text, and its clear button while it holds text -->
	<div class="find-field-box" testid="find-field-box">
		<svg class="find-glyph" testid="find-magnifier" source={magnifierGlyph(theme().palette.muted)}
		></svg>
		<!-- Cmd-F and Shift-Enter mount a fresh field: autofocus focuses it, and it shows `fieldSource` -->
		{#key findController.fieldRevision}
			<textarea
				class="find-field"
				testid="find-field"
				autofocus
				placeholder="Find"
				value={findController.fieldSource}
				theme={fieldTheme}
				minRows={1}
				maxRows={1}
				onchange={(event) => findController.typeInField(event.value)}
				onsubmit={() => findController.next()}
				onkeydown={(event) => {
					if (event.key === 'escape') findController.close()
				}}
				{@attach selectQuery}></textarea>
		{/key}
		{#if findController.query !== ''}
			<div
				class="find-clear"
				testid="find-clear"
				role="button"
				aria-label="Clear"
				hitbox="self"
				onclick={() => findController.clear()}
			>
				<svg class="find-clear-glyph" source={CLEAR_GLYPH}></svg>
			</div>
		{/if}
	</div>
	<div class="find-arrows">
		<div
			class="find-arrow"
			testid="find-previous"
			role="button"
			aria-label="Previous"
			hitbox="self"
			onclick={() => findController.previous()}
		>
			<svg class="find-chevron" source={chevron('left', theme().palette.text)}></svg>
		</div>
		<div class="find-divider"></div>
		<div
			class="find-arrow"
			testid="find-next"
			role="button"
			aria-label="Next"
			hitbox="self"
			onclick={() => findController.next()}
		>
			<svg class="find-chevron" source={chevron('right', theme().palette.text)}></svg>
		</div>
	</div>
	<div
		class="find-done"
		testid="find-done"
		role="button"
		hitbox="self"
		onclick={() => findController.close()}
	>
		<text>Done</text>
	</div>
</div>

<style>
	/*
	 * editmd's bar is a plain NSView in a stack above the web view (EditorWindowController.swift:246-290), so it shows the
	 * window's own background; its buttons keep the arrow cursor
	 */
	.find-bar {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: var(--size-find-gap);
		padding: var(--size-find-padding-y) var(--size-find-padding-x);
		border-bottom-width: var(--size-find-separator);
		border-color: var(--border);
		font-size: var(--size-find-text);
		color: var(--text);
	}
	/* the search field's bezel, around its glyphs and its text */
	.find-field-box {
		display: flex;
		flex-direction: row;
		align-items: center;
		flex-grow: 1;
		min-width: 0;
		gap: var(--size-find-glyph-gap);
		padding: 0 var(--size-find-glyph-gap);
		border-width: var(--size-find-separator);
		border-color: var(--border);
		border-radius: var(--size-find-control-radius);
		background-color: var(--background);
	}
	.find-field {
		flex-grow: 1;
		min-width: 0;
		font-size: var(--size-find-text);
	}
	/* the magnifier in NSSearchField's secondary colour; GPUI paints an svg in its element's `color` */
	.find-glyph {
		flex-shrink: 0;
		width: var(--size-find-glyph);
		height: var(--size-find-glyph);
		color: var(--muted);
	}
	.find-clear {
		display: flex;
		flex-shrink: 0;
		cursor: default;
	}
	/* the disc's colour; the × cut out of it shows the bezel's background */
	.find-clear-glyph {
		flex-shrink: 0;
		width: var(--size-find-glyph);
		height: var(--size-find-glyph);
		color: var(--faint);
	}
	.find-arrows {
		display: flex;
		flex-direction: row;
		height: var(--size-find-control-height);
		border-width: var(--size-find-separator);
		border-color: var(--border);
		border-radius: var(--size-find-control-radius);
		background-color: var(--background);
	}
	.find-arrow {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 var(--size-find-control-padding-x);
		cursor: default;
	}
	.find-divider {
		width: var(--size-find-separator);
		background-color: var(--border);
	}
	.find-chevron {
		width: var(--size-find-chevron);
		height: var(--size-find-chevron);
	}
	.find-done {
		display: flex;
		align-items: center;
		height: var(--size-find-control-height);
		padding: 0 var(--size-find-control-padding-x);
		border-width: var(--size-find-separator);
		border-color: var(--border);
		border-radius: var(--size-find-control-radius);
		background-color: var(--background);
		cursor: default;
	}
</style>
