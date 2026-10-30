<!--
  @component
  Picks the View for a Block by its kind: a top-level Block, and through NestedBlocks one inside a quote or a list item,
  which editmd paints as it paints one at the top level.
-->
<script lang="ts">
	import type { Component } from 'svelte'
	import type { BlockKind } from '../../engine/blocks.ts'
	import type { BlockViewProps } from './DocumentView.model.ts'
	import CodeBlock from './Views/CodeBlock.svelte'
	import FootnoteBlock from './Views/FootnoteBlock.svelte'
	import FrontmatterBlock from './Views/FrontmatterBlock.svelte'
	import ImageBlock from './Views/ImageBlock.svelte'
	import ListBlock from './Views/ListBlock.svelte'
	import MarkdownBlock from './Views/MarkdownBlock.svelte'
	import MermaidBlock from './Views/MermaidBlock.svelte'
	import MixedParagraphBlock from './Views/MixedParagraphBlock.svelte'
	import QuoteBlock from './Views/QuoteBlock.svelte'
	import SourceLineBlock from './Views/SourceLineBlock.svelte'
	import TableBlock from './Views/TableBlock.svelte'

	let { block, index, testKey }: BlockViewProps = $props()

	const VIEW_BY_KIND: Partial<Record<BlockKind, Component<BlockViewProps>>> = {
		blockquote: QuoteBlock,
		code: CodeBlock,
		definition: SourceLineBlock,
		// editmd shows raw HTML as its source, mono and muted (style.css:344-349)
		html: SourceLineBlock,
		footnoteDefinition: FootnoteBlock,
		frontmatter: FrontmatterBlock,
		mermaid: MermaidBlock,
		// editmd's table look (style.css:316-342), which native <markdown> has no tokens for
		table: TableBlock
	}

	// a list carries `items` always, so it paints its own rows with editmd's markers and indent, and its tasks'
	// boxes, where native <markdown> paints a task as literal brackets;
	// a paragraph carries `images` only when it is nothing but images, which it paints as link text;
	// one mixing text and images carries `segments` instead, so each image paints as one between the text runs
	const View = $derived(
		block.items
			? ListBlock
			: block.images
				? ImageBlock
				: block.segments
					? MixedParagraphBlock
					: (VIEW_BY_KIND[block.kind] ?? MarkdownBlock)
	)
</script>

<View {block} {index} {testKey} />
