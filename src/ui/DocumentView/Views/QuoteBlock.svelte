<!--
  @component
  A blockquote as editmd paints it (`blockquote { padding: 0 1em; color: var(--muted); border-left: 0.25em solid
  var(--border) }`): a rail in the border colour, no fill, and the Blocks inside it painted as top-level ones are, in the
  muted colour they inherit. Native <markdown>'s own quote paints a rail and a wash in its theme's accent.
-->
<script lang="ts">
	import { provideQuoted } from '../../../app/theme.svelte.ts'
	import type { BlockViewProps } from '../DocumentView.model.ts'
	import NestedBlocks from '../NestedBlocks.svelte'

	let { block, index, testKey }: BlockViewProps = $props()

	provideQuoted()
</script>

<div class="quote" testid={`quote-${testKey}`}>
	<NestedBlocks blocks={block.children ?? []} {index} {testKey} />
</div>

<style>
	.quote {
		border-left-width: var(--size-quote-rail);
		border-color: var(--border);
		padding-left: var(--size-quote-padding);
		padding-right: var(--size-quote-padding);
	}
</style>
