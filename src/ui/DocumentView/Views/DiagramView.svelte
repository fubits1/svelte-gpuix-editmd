<!--
  @component
  A Mermaid diagram as editmd's `.diagram` paints it (style.css:421-455): a box with no fill, bordered only under the
  pointer or while its Block is open (`box-shadow: inset 0 0 0 1px var(--border)`), holding the image centred at its
  natural size and shrunk to the box when wider (`.diagram svg { max-width: 100%; height: auto }`), editmd's "Empty
  diagram" note centred, or the reason it could not be drawn, centred too in the danger colour. MermaidBlock paints it
  in place of its Block, where a click opens the Block as editmd's `editSource` does; MermaidBlock `editing` under the Active
  block's field.
-->
<script lang="ts">
	import type { Diagram } from '../../../app/diagrams.ts'
	import { monoLinesSource, monoLinesTheme, monoLinesWidth } from '../../../app/monoLines.ts'
	import { useTheme } from '../../../app/theme.svelte.ts'
	import { fitToWidth } from '../../../core/imageSize.ts'
	import { documentController } from '../controller.svelte.ts'
	import { dropFiles } from '../fileDrop.ts'
	import { diagramImageSrc } from './diagramImage.svelte.ts'

	let {
		diagram,
		index,
		testKey,
		editing = false
	}: {
		diagram: Diagram
		/** the top-level Block's index, which a click opens */
		index: number
		/**
		 * the Block's test id key (BlockViewProps), for `mermaid-box-<key>`, `mermaid-<key>`, `mermaid-error-<key>` and
		 * `mermaid-empty-<key>`
		 */
		testKey: string
		/** shown under the open Block's field, as editmd's `.code-block.mermaid.editing > .diagram`: always bordered */
		editing?: boolean
	} = $props()

	const theme = useTheme()

	/** `.diagram-empty, .diagram-error { font: 12.5px/1.5 var(--font-mono) }`, faint and danger, at the page's zoom */
	const emptyTheme = $derived(
		monoLinesTheme(
			theme().textTheme,
			theme().palette.faint ?? '',
			theme().scaled(12.5),
			theme().scaled(12.5 * 1.5)
		)
	)
	const errorTheme = $derived(
		monoLinesTheme(
			theme().textTheme,
			theme().palette.danger ?? '',
			theme().scaled(12.5),
			theme().scaled(12.5 * 1.5)
		)
	)

	/** the box's inner width as its layout event last reported it, null until the first paint */
	let innerWidth = $state<number | null>(null)

	/** the natural size at the page's zoom, shrunk to the box when wider, its shape kept */
	const size = $derived.by(() => {
		if (diagram.kind !== 'diagram') return null
		const natural = { width: theme().scaled(diagram.width), height: theme().scaled(diagram.height) }
		return innerWidth === null ? natural : fitToWidth(natural, innerWidth)
	})
</script>

<div
	class={['mermaid', editing && 'editing']}
	testid={`mermaid-box-${testKey}`}
	hitbox="self"
	onclick={editing
		? () => documentController.caretToSourceEnd()
		: (event) => documentController.clickBlock(index, { cmd: event.modifiers?.cmd === true })}
	onfiledrop={editing ? null : dropFiles}
>
	<div class="inner" onlayout={(event) => (innerWidth = event.width ?? null)}>
		{#if diagram.kind === 'diagram' && size}
			<img
				testid={`mermaid-${testKey}`}
				src={diagramImageSrc(diagram)}
				alt="Mermaid diagram"
				style:width={`${size.width}px`}
				style:height={`${size.height}px`}
			/>
		{:else if diagram.kind === 'empty' || diagram.kind === 'error'}
			<!--
			  in SF Mono, wrapping as editmd's `white-space: pre-wrap` (style.css:449): native <markdown> inline code
			  (`monoLinesSource`), where a <text> refuses SF Mono and a <code> never wraps
			-->
			<!-- as wide as its longest line, so the box centres it; a longer one is held to the box and wraps -->
			<markdown
				class="message"
				testid={`mermaid-${diagram.kind}-${testKey}`}
				style:width={`${monoLinesWidth(diagram.message, theme().scaled(12.5))}px`}
				source={monoLinesSource(diagram.message)}
				theme={diagram.kind === 'empty' ? emptyTheme : errorTheme}
			></markdown>
		{/if}
	</div>
</div>

<style>
	/*
	 * `.diagram { display: flex; justify-content: center; padding: 1rem; border-radius: 8px }`; its border is the
	 * inset box-shadow editmd shows on hover and while open, a 1px border here, clear the rest of the time
	 */
	.mermaid {
		display: flex;
		flex-direction: column;
		padding: var(--size-diagram-padding);
		border-radius: var(--size-diagram-radius);
		border-width: 1px;
		border-color: #00000000;
		cursor: pointer;
	}
	.mermaid:hover {
		border-color: var(--border);
	}
	/* the open Block's preview keeps the pointer: a click on it puts the caret at the end of the source (diagrams.ts:86) */
	.editing {
		border-color: var(--border);
	}
	/* the box's content width, which a wider diagram shrinks to; its parts centre across it */
	.inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 100%;
	}
	/* a message never wider than the box: past it, it wraps there */
	.message {
		max-width: 100%;
	}
</style>
