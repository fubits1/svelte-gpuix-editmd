<!--
  @component
  A fenced code Block as editmd's `pre` (style.css:193-220): a card in the surface colour with no ring, `padding:
  0.9rem 1.1rem` and radius 8px, its lines through GPUI's native <code> at 13.5px/1.55 mono, and its language as a small
  lowercase label in the top-right corner. Native <markdown>'s own code card rings itself in its theme's `border`,
  which made the card 2.5px taller than editmd's and moved its text, so the card is drawn here around a <code>, which
  paints no surface of its own.
-->
<script lang="ts">
	import { codeText } from '../../../app/codeText.ts'
	import { useTheme } from '../../../app/theme.svelte.ts'
	import { documentController } from '../controller.svelte.ts'
	import { type BlockViewProps, CODE_LABEL_TOP, NO_FIND } from '../DocumentView.model.ts'

	let { block, index }: BlockViewProps = $props()

	const theme = useTheme()

	/** the code between the fences, as editmd's `pre` shows it */
	const code = $derived(codeText(documentController.sliceOf(block)))

	/** editmd's `text-transform: lowercase` on the label */
	const label = $derived(block.lang ? block.lang.toLowerCase() : null)
</script>

<div class="code-block">
	<div class="card" testid={`code-card-${index}`}>
		<code class="lines" testid={`code-${index}`} {code} theme={theme().textTheme}></code>
		{#if label}
			<!-- editmd's label is `::before` content, which its find never matches -->
			<text
				class="label"
				testid={`code-label-${index}`}
				highlight={NO_FIND}
				style:top={`${theme().scaled(CODE_LABEL_TOP)}px`}>{label}</text
			>
		{/if}
	</div>
	<!--
  the room editmd's code block keeps below its card: the pre's margin, then the diagram box `hidden` cannot hide
  (diagrams.ts:78-87, `.diagram { display: flex }` outranks it); a click there opens the Block, as in editmd
-->
	<div class="diagram-room" testid={`code-room-${index}`}></div>
</div>

<style>
	/* editmd's `div.code-block`: the card, then the room below it */
	.code-block {
		display: flex;
		flex-direction: column;
	}
	/* `pre { padding: 0.9rem 1.1rem; background: var(--surface); border-radius: 8px }` */
	.card {
		display: flex;
		flex-direction: column;
		padding-top: var(--size-code-padding-y);
		padding-bottom: var(--size-code-padding-y);
		padding-left: var(--size-code-padding-x);
		padding-right: var(--size-code-padding-x);
		border-radius: var(--size-code-radius);
		background-color: var(--surface);
	}
	.diagram-room {
		margin-top: var(--size-code-margin);
		height: var(--size-hidden-diagram);
	}
	.lines {
		width: 100%;
	}
	/* `pre[data-language]::before { font: 11px; top: 0.35rem; right: 0.6rem; color: var(--faint) }`, `top` set inline */
	.label {
		position: absolute;
		right: var(--size-code-label-right);
		font-size: var(--size-code-label);
		color: var(--faint);
	}
</style>
