<!--
  @component
  The Agents whose highlights the Document shows, as editmd's legend (web/src/highlights.ts `Legend`, style.css
  `.agent-legend`): floating in the page's bottom-right corner under an AGENTS header, one row per Agent in order of
  arrival and Outside edit last, each its colour dot, name and count of changes with a × that clears them, and Clear all
  below when there is more than one. A click on a name scrolls to that Agent's next change, a double click swaps the
  name for a field that renames it. The – shrinks the legend to a pill of the dots and the total count, a click on the
  pill shows the rows again. Render it inside `Portal`, so it floats over the scrolling page.
-->
<script module lang="ts">
	import { define_styles } from 'gpuix-svelte/renderer'

	/**
	 * editmd's `.agent-legend { box-shadow: 0 4px 16px rgb(0 0 0 / 0.12) }` (style.css:515), in both appearances.
	 * gpuix-svelte drops `box-shadow` from CSS text (its style.js refuses the key, a struct natively), but a class
	 * rule handed to its renderer as a style object reaches GPUI's `StyleDesc.boxShadow` as it is
	 */
	define_styles('legend-shadow', [
		{
			classes: ['legend-shadow'],
			tag: null,
			pseudo: null,
			style: {
				boxShadow: { offsetX: 0, offsetY: 4, blurRadius: 16, spreadRadius: 0, color: '#0000001f' }
			}
		}
	])
</script>

<script lang="ts">
	import type { GpuixEvent, ShadowNode } from 'gpuix-svelte'
	import { keysOnceFocused } from '../../app/fieldKeys.ts'
	import { useTheme } from '../../app/theme.svelte.ts'
	import PointerTip from '../PointerTip.svelte'
	import { documentController, slotClassOf } from './controller.svelte.ts'

	const theme = useTheme()

	/** editmd's name title (highlights.ts:284, 295): Outside edit, with no Agent to rename, only reveals */
	const nameTitle = (id: string) =>
		id === '' ? 'Show the next change' : 'Show the next change. Double-click to rename.'

	/** the Agent whose name the rename field stands in for, null when none does: transient UI (ADR-0011) */
	let renaming = $state<string | null>(null)
	/** what the rename field holds */
	let typedName = $state('')

	/** the pill's number: every highlight in the legend */
	const total = $derived(documentController.agents.reduce((sum, { count }) => sum + count, 0))

	/**
	 * editmd reveals on the first click (`event.detail < 2`) and renames on the double click, whose second click
	 * GPUI reports with a clickCount of 2. Outside edit has no id, so nothing to rename
	 */
	function clickName(event: GpuixEvent, id: string, name: string): void {
		if ((event.clickCount ?? 1) < 2) {
			documentController.revealAgent(id)
			return
		}
		if (id === '') return
		typedName = name
		renaming = id
	}

	/** the rename field opens with the name selected, as editmd's `edit` selects it (highlights.ts:326-349) */
	function selectName(node: ShadowNode): void {
		void keysOnceFocused(node, 'cmd-a')
	}

	/** Return, or leaving the field, keeps the typed name, Escape does not, as editmd's `edit`; it ends once */
	function finishRename(keep: boolean): void {
		const id = renaming
		if (id === null) return
		renaming = null
		if (keep) documentController.renameAgent(id, typedName)
	}
</script>

<!--
  every legend title is a native tip at the pointer (highlights.ts:253, 257, 274, 284, 295, 300); a dot's sits inside
  the pill's, and only the innermost shows
-->
<div
	class={['legend', 'legend-shadow', documentController.legendMinimized && 'legend-minimized']}
	testid="legend"
	role="complementary"
	aria-label="Agents"
>
	{#if documentController.legendMinimized}
		<!-- editmd's `pill.title = "Show agents"` (highlights.ts:253) -->
		<PointerTip text="Show agents" testid="legend-pill-tooltip">
			{#snippet children(pillPointer)}
				<div
					class="pill"
					testid="legend-pill"
					role="button"
					tabindex={0}
					aria-label="Show agents"
					hitbox="self"
					onclick={() => documentController.minimizeLegend(false)}
					{...pillPointer}
				>
					{#each documentController.agents as agent, index (agent.id)}
						<!--
						  editmd's `dot.title = agent.name` (highlights.ts:257): a dot hears the pointer itself, so it takes
						  its own clicks too, which show the rows as the pill's do
						-->
						<PointerTip text={agent.name} testid={`legend-pill-dot-tooltip-${index}`}>
							{#snippet children(dotPointer)}
								<div
									class="dot"
									testid={`legend-pill-dot-${index}`}
									style:background-color={`var(--${slotClassOf(agent)})`}
									aria-label={agent.name}
									onclick={() => documentController.minimizeLegend(false)}
									{...dotPointer}
								></div>
							{/snippet}
						</PointerTip>
					{/each}
					<text class="pill-count" testid="legend-pill-count">{total}</text>
				</div>
			{/snippet}
		</PointerTip>
	{:else}
		<div class="header">
			<!-- editmd's "Agents", painted uppercase by its `text-transform`, which GPUI text lacks -->
			<text testid="legend-header">AGENTS</text>
			<!-- editmd's `title = "Minimize"` (highlights.ts:274) -->
			<PointerTip text="Minimize" testid="legend-minimize-tooltip">
				{#snippet children(pointer)}
					<div
						class="minimize"
						role="button"
						tabindex={0}
						aria-label="Minimize"
						hitbox="self"
						onclick={() => documentController.minimizeLegend(true)}
						{...pointer}
					>
						<text testid="legend-minimize">–</text>
					</div>
				{/snippet}
			</PointerTip>
		</div>
		{#each documentController.agents as agent, index (agent.id)}
			<div class="row" testid={`legend-row-${index}`}>
				{#if renaming === agent.id}
					<input
						class="rename"
						testid="legend-rename"
						autofocus
						aria-label="Agent name"
						value={typedName}
						theme={theme().textTheme}
						onchange={(event) => (typedName = event.value ?? '')}
						onsubmit={() => finishRename(true)}
						onkeydown={(event) => {
							if (event.key === 'escape') finishRename(false)
						}}
						onblur={() => finishRename(true)}
						{@attach selectName}
					/>
				{:else}
					<PointerTip text={nameTitle(agent.id)} testid={`legend-name-tooltip-${index}`}>
						{#snippet children(pointer)}
							<div
								class="name"
								testid={`legend-name-${index}`}
								role="button"
								tabindex={0}
								aria-label={nameTitle(agent.id)}
								hitbox="self"
								onclick={(event) => clickName(event, agent.id, agent.name)}
								{...pointer}
							>
								<div
									class="dot"
									testid={`legend-dot-${index}`}
									style:background-color={`var(--${slotClassOf(agent)})`}
								></div>
								<text class="name-text" testid={`legend-name-text-${index}`}>{agent.name}</text>
								<text class="count" testid={`legend-count-${index}`}>{agent.count}</text>
							</div>
						{/snippet}
					</PointerTip>
				{/if}
				<!-- editmd's `title = \`Clear ${agent.name}'s highlights\`` (highlights.ts:300) -->
				<PointerTip
					text={`Clear ${agent.name}'s highlights`}
					testid={`legend-clear-tooltip-${index}`}
				>
					{#snippet children(pointer)}
						<div
							class="clear"
							role="button"
							tabindex={0}
							aria-label={`Clear ${agent.name}'s highlights`}
							hitbox="self"
							onclick={() => documentController.clearHighlights(agent.id)}
							{...pointer}
						>
							<text testid={`legend-clear-${index}`}>×</text>
						</div>
					{/snippet}
				</PointerTip>
			</div>
		{/each}
		{#if documentController.agents.length > 1}
			<div
				class="clear-all"
				role="button"
				tabindex={0}
				hitbox="self"
				onclick={() => documentController.clearHighlights()}
			>
				<text testid="legend-clear-all">Clear all</text>
			</div>
		{/if}
	{/if}
</div>

<style>
	.legend {
		position: absolute;
		right: var(--size-legend-inset);
		bottom: var(--size-legend-inset);
		display: flex;
		flex-direction: column;
		gap: var(--size-legend-gap);
		max-width: var(--size-legend-width);
		padding: var(--size-legend-padding);
		border-width: 1px;
		border-color: var(--border);
		border-radius: var(--size-legend-radius);
		background-color: var(--surface);
		color: var(--text);
		font-size: var(--size-legend-text);
		line-height: var(--size-legend-line-height);
	}
	.legend-minimized {
		padding: var(--size-legend-pill-outer);
		border-radius: var(--size-legend-pill-radius);
	}
	.header {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		padding: var(--size-legend-header-padding-top) 0 var(--size-legend-header-padding-bottom)
			var(--size-legend-header-padding-left);
		color: var(--muted);
		font-size: var(--size-legend-header-text);
		font-weight: 600;
	}
	.minimize {
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--size-legend-button);
		height: var(--size-legend-button);
		border-radius: var(--size-legend-button-radius);
		color: var(--muted);
		font-size: var(--size-legend-minimize-text);
		font-weight: 400;
		cursor: pointer;
	}
	.minimize:hover {
		background-color: var(--legend-hover);
	}
	.row {
		display: flex;
		flex-direction: row;
		align-items: center;
	}
	.name {
		display: flex;
		flex-direction: row;
		align-items: center;
		flex-grow: 1;
		gap: var(--size-legend-name-gap);
		min-width: 0;
		padding: var(--size-legend-name-padding-y) var(--size-legend-name-padding-x);
		border-radius: var(--size-legend-button-radius);
		cursor: pointer;
	}
	.name:hover {
		background-color: var(--legend-hover);
	}
	/* `.agent-legend .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis }` (style.css:581-592) */
	.name-text {
		flex-grow: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.count {
		padding-left: var(--size-legend-count-gap);
		color: var(--muted);
	}
	.rename {
		flex-grow: 1;
		min-width: 0;
		margin: 0 var(--size-legend-rename-margin);
		padding: var(--size-legend-rename-padding-y) var(--size-legend-rename-padding-x);
		border-width: 1px;
		border-color: var(--accent);
		border-radius: var(--size-legend-button-radius);
		background-color: var(--background);
		color: var(--text);
	}
	.clear {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: var(--size-legend-button);
		height: var(--size-legend-button);
		border-radius: var(--size-legend-button-radius);
		color: var(--muted);
		cursor: pointer;
	}
	.clear:hover {
		background-color: var(--legend-hover);
	}
	.clear-all {
		margin-top: var(--size-legend-clear-all-gap);
		padding: var(--size-legend-name-padding-y) var(--size-legend-name-padding-x);
		border-radius: var(--size-legend-button-radius);
		color: var(--muted);
		cursor: pointer;
	}
	.clear-all:hover {
		background-color: var(--legend-hover);
	}
	.pill {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: var(--size-legend-pill-gap);
		padding: var(--size-legend-pill-padding-y) var(--size-legend-pill-padding-x);
		border-radius: var(--size-legend-pill-radius);
		cursor: pointer;
	}
	.pill:hover {
		background-color: var(--legend-hover);
	}
	.pill-count {
		padding-left: var(--size-legend-pill-count-gap);
		color: var(--muted);
	}
	.dot {
		flex-shrink: 0;
		width: var(--size-legend-dot);
		height: var(--size-legend-dot);
		border-radius: var(--size-legend-dot-radius);
	}
</style>
