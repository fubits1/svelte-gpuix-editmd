<!--
  @component
  A Block shown as source, mono and muted, as editmd shows link definitions (rebuilt from what they define) and raw
  HTML (as written); footnote definitions are labelled blocks instead (FootnoteBlock).
-->
<script lang="ts">
	import { monoLinesSource, monoLinesTheme } from '../../../app/monoLines.ts'
	import { useTheme } from '../../../app/theme.svelte.ts'
	import { definitionText } from '../../../core/definitionText.ts'
	import { documentController } from '../controller.svelte.ts'
	import { type BlockViewProps, HTML_INK_SHIFT, SF_MONO_LINE_BOX } from '../DocumentView.model.ts'

	let { block, testKey }: BlockViewProps = $props()

	const theme = useTheme()

	/**
	 * what the Block paints: a definition rebuilt from what it defines, `[label]: url "title"`, as editmd paints it
	 * (links.ts:133-136), so Find matches that too; raw HTML as written, inside a quote or a list item without what its
	 * container puts in front of each line (`paintedSliceOf`)
	 */
	const shown = $derived(
		block.kind === 'definition'
			? definitionText(documentController.paintedSliceOf(block))
			: documentController.paintedSliceOf(block)
	)

	/**
	 * `font: 0.86em var(--font-mono)` of the 16px body, muted: a definition is a block of its own at that size, the
	 * shorthand's `line-height: normal` SF Mono's line box (style.css:353-357); raw HTML is a span inline in the body's
	 * 16px/1.65 line
	 */
	const linesTheme = $derived(
		monoLinesTheme(
			theme().textTheme,
			theme().palette.muted ?? '',
			theme().scaled(16 * 0.86),
			theme().scaled(block.kind === 'html' ? 16 * 1.65 : 16 * 0.86 * SF_MONO_LINE_BOX)
		)
	)
</script>

<!--
  in SF Mono, wrapping as editmd's `overflow-wrap: anywhere` (style.css:356) and its inline HTML do: native
  <markdown> inline code (`monoLinesSource`), where a <text> refuses SF Mono and a <code> never wraps
-->
<markdown
	class="source-line"
	testid={`source-line-${testKey}`}
	style:top={block.kind === 'html' ? `${theme().scaled(HTML_INK_SHIFT)}px` : null}
	source={monoLinesSource(shown)}
	theme={linesTheme}
></markdown>

<style>
	/* moved by its ink shift only, so nothing after it moves */
	.source-line {
		position: relative;
	}
</style>
