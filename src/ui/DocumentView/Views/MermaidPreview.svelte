<!--
  @component
  The live preview under an Active mermaid Block's field, as editmd's diagrams.ts: the diagram shows at once, and
  re-renders from the field's text once typing pauses for 300ms, or shows why the text cannot be drawn.
-->
<script lang="ts">
	import { untrack } from 'svelte'
	import { DIAGRAM_RERENDER_DELAY, diagramOf, diagramSource } from '../../../app/diagrams.ts'
	import { useTheme } from '../../../app/theme.svelte.ts'
	import { documentController } from '../controller.svelte.ts'
	import type { BlockViewProps } from '../DocumentView.model.ts'
	import DiagramView from './DiagramView.svelte'

	let { block, index }: BlockViewProps = $props()

	const theme = useTheme()

	/** what the field holds now: every keystroke writes it into the Active block's Slice */
	const typed = $derived(diagramSource(documentController.sliceOf(block)))

	/**
	 * the source the diagram is drawn from: the field's text at opening, then as of the last pause in typing, so
	 * it does not redraw on every key. a timer, not a $derived, since the pause is time
	 */
	let shown = $state(untrack(() => typed))

	$effect(() => {
		const next = typed
		const timer = setTimeout(() => (shown = next), DIAGRAM_RERENDER_DELAY)
		return () => clearTimeout(timer)
	})

	// a theme change redraws at once, as editmd's appearance listener does
	const diagram = $derived(diagramOf(shown, theme().mermaidPalette))
</script>

<DiagramView {diagram} {index} editing />
