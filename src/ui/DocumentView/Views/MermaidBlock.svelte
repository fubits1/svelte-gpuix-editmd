<!--
  @component
  A Mermaid Block drawn as its diagram, or the reason it could not be drawn. As editmd's diagrams.ts, the first drawing
  shows at once and a changed source (an outside write, an undo) redraws once it has stayed the same for 300ms. With
  `editing`, it is the live preview under the Active Block's field, redrawn once typing pauses for 300ms.
-->
<script lang="ts">
	import { untrack } from 'svelte'
	import { DIAGRAM_RERENDER_DELAY, diagramOf, diagramSource } from '../../../app/diagrams.ts'
	import { useTheme } from '../../../app/theme.svelte.ts'
	import { documentController } from '../controller.svelte.ts'
	import type { BlockViewProps } from '../DocumentView.model.ts'
	import DiagramView from './DiagramView.svelte'

	let {
		block,
		index,
		testKey,
		editing = false
	}: BlockViewProps & {
		/** drawn under the Active Block's field as its live preview */
		editing?: boolean
	} = $props()

	const theme = useTheme()

	/**
	 * the Block's diagram source now; inside a quote or a list item without what its container puts in front of each
	 * line (`paintedSliceOf`)
	 */
	const source = $derived(diagramSource(documentController.paintedSliceOf(block)))

	/**
	 * the source the diagram is drawn from: the Block's at first, then as of 300ms after its last change
	 * (diagrams.ts:141-143). a timer, not a $derived, since the pause is time
	 */
	let shown = $state(untrack(() => source))

	/** the Document `shown` was drawn for: another one, opened into the window, draws at once, as a first drawing */
	let drawnFor = untrack(() => documentController.documentGeneration)

	$effect(() => {
		const next = source
		const generation = documentController.documentGeneration
		if (generation !== drawnFor) {
			drawnFor = generation
			shown = next
			return
		}
		const timer = setTimeout(() => (shown = next), DIAGRAM_RERENDER_DELAY)
		return () => clearTimeout(timer)
	})

	// a theme change redraws at once, as editmd's appearance listener does
	const diagram = $derived(diagramOf(shown, theme().mermaidPalette))
</script>

<DiagramView {diagram} {index} {testKey} {editing} />
