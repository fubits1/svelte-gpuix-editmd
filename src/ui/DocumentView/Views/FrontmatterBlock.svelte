<!--
  @component
  A front matter Block shown verbatim, fences included, in its own box, as editmd shows it.
-->
<script lang="ts">
	import { monoLinesSource, monoLinesTheme } from '../../../app/monoLines.ts'
	import { useTheme } from '../../../app/theme.svelte.ts'
	import { documentController } from '../controller.svelte.ts'
	import type { BlockViewProps } from '../DocumentView.model.ts'

	let { block, index }: BlockViewProps = $props()

	const theme = useTheme()

	/** `font: 12.5px/1.55 var(--font-mono); color: var(--muted)`, at the page's zoom */
	const linesTheme = $derived(
		monoLinesTheme(
			theme().textTheme,
			theme().palette.muted ?? '',
			theme().scaled(12.5),
			theme().scaled(12.5 * 1.55)
		)
	)
</script>

<div class="frontmatter" testid={`frontmatter-box-${index}`}>
	<!--
	  its lines in SF Mono, wrapping as editmd's `white-space: pre-wrap` (style.css:80): native <markdown> inline code
	  (`monoLinesSource`), where a <text> refuses SF Mono and a <code> never wraps
	-->
	<markdown
		testid={`frontmatter-${index}`}
		source={monoLinesSource(documentController.sliceOf(block))}
		theme={linesTheme}
	></markdown>
</div>

<style>
	/* editmd's `.frontmatter { padding: 0.75rem 1rem; background: var(--surface); border-radius: 8px }` */
	.frontmatter {
		padding-top: var(--size-frontmatter-padding-y);
		padding-bottom: var(--size-frontmatter-padding-y);
		padding-left: var(--size-frontmatter-padding-x);
		padding-right: var(--size-frontmatter-padding-x);
		border-radius: var(--size-frontmatter-radius);
		background-color: var(--surface);
	}
</style>
