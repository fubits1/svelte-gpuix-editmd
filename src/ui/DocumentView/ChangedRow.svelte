<!--
  @component
  The content of one row of a list or a quote (a list item's text, a quote's child), painting the Document from `start`
  to `end`, in its Agent's tint and bar when an Agent made that child new or another node (a ticked task): editmd marks
  such a child as a block (changes.ts:38-40, 49-50), with the tint and bar a Block marked whole takes (style.css:474-479).
-->
<script lang="ts">
	import type { Snippet } from 'svelte'
	import { documentController } from './controller.svelte.ts'

	let { start, end, children }: { start: number; end: number; children: Snippet } = $props()

	const agentClass = $derived(documentController.rowAgentClassOf(start, end))
</script>

{#if agentClass}
	<div
		class="agent"
		testid={`agent-row-${start}`}
		style:border-color={`var(--${agentClass})`}
		style:background-color={`var(--${agentClass}-tint)`}
	>
		{@render children()}
	</div>
{:else}
	{@render children()}
{/if}

<style>
	/*
	 * editmd's box-shadows as the box itself, as DocumentView's `.agent`: 8px left of the row with an 8px bar, so its
	 * text stays where an unmarked row's does
	 */
	.agent {
		width: auto;
		margin-left: var(--size-agent-outset);
		border-left-width: var(--size-agent-rail);
		padding-left: var(--size-agent-inset);
	}
</style>
