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
	import Tooltip from 'gpuix-svelte/components/Tooltip.svelte'
	import { onDestroy } from 'svelte'
	import { keysOnceFocused } from '../../app/fieldKeys.ts'
	import { useTheme } from '../../app/theme.svelte.ts'
	import { documentController } from './controller.svelte.ts'

	const theme = useTheme()

	/** gpuix Tooltip's own hover delay, which a name's tip waits out too */
	const TIP_DELAY_MS = 300

	/**
	 * whose tip shows: a row's name (`name-<index>`), the minimized pill (`pill`) or one of its dots (`dot-<index>`);
	 * transient UI (ADR-0011). each takes the hover itself, as a Tooltip around a name would stop it growing across
	 * the row (its wrapper shrinks to content), and one around a dot would pull it out of the pill's row
	 */
	let tipped = $state<string | null>(null)
	/** whose tip waits out the delay; GPUI may report the next one's enter before this one's leave */
	let pendingTip: string | null = null
	let tipTimer: ReturnType<typeof setTimeout> | undefined

	function enterTip(key: string): void {
		clearTimeout(tipTimer)
		pendingTip = key
		tipTimer = setTimeout(() => {
			pendingTip = null
			tipped = key
		}, TIP_DELAY_MS)
	}

	/** only `key`'s own wait and tip end, so a leave that comes after the next one's enter keeps that one */
	function leaveTip(key: string): void {
		if (pendingTip === key) {
			clearTimeout(tipTimer)
			pendingTip = null
		}
		if (tipped === key) tipped = null
	}

	onDestroy(() => clearTimeout(tipTimer))

	/** editmd's name title (highlights.ts:284, 295): Outside edit, with no Agent to rename, only reveals */
	const nameTitle = (id: string) =>
		id === '' ? 'Show the next change' : 'Show the next change. Double-click to rename.'

	/** the Agent whose name the rename field stands in for, null when none does: transient UI (ADR-0011) */
	let renaming = $state<string | null>(null)
	/** what the rename field holds */
	let typedName = $state('')

	/** the pill's number: every highlight in the legend */
	const total = $derived(documentController.agents.reduce((sum, { count }) => sum + count, 0))

	/** a dot's colour class: the Agent's slot, or editmd's `agent-unknown` for Outside edit */
	const dotClass = (slot: number | null) => (slot === null ? 'dot-unknown' : `dot-${slot}`)

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

<!-- a Tooltip's trigger for a tip the name's own hover opens: nothing, so the Tooltip is only the point it hangs from -->
{#snippet noTrigger()}{/snippet}

<div
	class={['legend', 'legend-shadow', documentController.legendMinimized && 'legend-minimized']}
	testid="legend"
	role="complementary"
	aria-label="Agents"
>
	{#if documentController.legendMinimized}
		<div
			class="pill"
			testid="legend-pill"
			role="button"
			tabindex={0}
			aria-label="Show agents"
			hitbox="self"
			onclick={() => documentController.minimizeLegend(false)}
			onmouseenter={() => enterTip('pill')}
			onmouseleave={() => leaveTip('pill')}
		>
			<!-- editmd's `pill.title = "Show agents"` (highlights.ts:253); the tip hangs left of the legend -->
			<div class="tip-point">
				<Tooltip
					content="Show agents"
					open={tipped === 'pill'}
					side="left"
					align="start"
					testid="legend-pill-tooltip"
					children={noTrigger}
				/>
			</div>
			{#each documentController.agents as agent, index (agent.id)}
				<!--
				  editmd's `dot.title = agent.name` (highlights.ts:257): a dot hears the pointer itself, so it takes its own
				  clicks too, which show the rows as the pill's do
				-->
				<div
					class={['dot', dotClass(agent.slot)]}
					testid={`legend-pill-dot-${index}`}
					aria-label={agent.name}
					onclick={() => documentController.minimizeLegend(false)}
					onmouseenter={() => enterTip(`dot-${index}`)}
					onmouseleave={() => leaveTip(`dot-${index}`)}
				>
					<div class="tip-point">
						<Tooltip
							content={agent.name}
							open={tipped === `dot-${index}`}
							side="top"
							align="start"
							testid={`legend-pill-dot-tooltip-${index}`}
							children={noTrigger}
						/>
					</div>
				</div>
			{/each}
			<text class="pill-count" testid="legend-pill-count">{total}</text>
		</div>
	{:else}
		<div class="header">
			<!-- editmd's "Agents", painted uppercase by its `text-transform`, which GPUI text lacks -->
			<text testid="legend-header">AGENTS</text>
			<!-- editmd's `title = "Minimize"` (highlights.ts:274) -->
			<Tooltip content="Minimize" testid="legend-minimize-tooltip">
				{#snippet children(hover)}
					<div
						class="minimize"
						role="button"
						tabindex={0}
						aria-label="Minimize"
						hitbox="self"
						onclick={() => documentController.minimizeLegend(true)}
						{...hover}
					>
						<text testid="legend-minimize">–</text>
					</div>
				{/snippet}
			</Tooltip>
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
					<div
						class="name"
						testid={`legend-name-${index}`}
						role="button"
						tabindex={0}
						aria-label={nameTitle(agent.id)}
						hitbox="self"
						onclick={(event) => clickName(event, agent.id, agent.name)}
						onmouseenter={() => enterTip(`name-${index}`)}
						onmouseleave={() => leaveTip(`name-${index}`)}
					>
						<div class={['dot', dotClass(agent.slot)]} testid={`legend-dot-${index}`}></div>
						<text class="name-text" testid={`legend-name-text-${index}`}>{agent.name}</text>
						<text class="count" testid={`legend-count-${index}`}>{agent.count}</text>
						<!--
						  a 0×0 point at the name's top-left corner; the tip shows left of the legend, level with its row,
						  so it never covers the rows below, whose names it would keep from the pointer
						-->
						<div class="name-tip">
							<Tooltip
								content={nameTitle(agent.id)}
								open={tipped === `name-${index}`}
								side="left"
								align="start"
								testid={`legend-name-tooltip-${index}`}
								children={noTrigger}
							/>
						</div>
					</div>
				{/if}
				<!-- editmd's `title = \`Clear ${agent.name}'s highlights\`` (highlights.ts:300) -->
				<Tooltip
					content={`Clear ${agent.name}'s highlights`}
					testid={`legend-clear-tooltip-${index}`}
				>
					{#snippet children(hover)}
						<div
							class="clear"
							role="button"
							tabindex={0}
							aria-label={`Clear ${agent.name}'s highlights`}
							hitbox="self"
							onclick={() => documentController.clearHighlights(agent.id)}
							{...hover}
						>
							<text testid={`legend-clear-${index}`}>×</text>
						</div>
					{/snippet}
				</Tooltip>
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
	.name-tip {
		position: absolute;
		left: 0;
		top: 0;
		width: 0;
		height: 0;
	}
	/* a 0×0 point at the pill's or a dot's top-left corner, out of its flow, that its tip hangs from */
	.tip-point {
		position: absolute;
		left: 0;
		top: 0;
		width: 0;
		height: 0;
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
	.dot-0 {
		background-color: var(--agent-0);
	}
	.dot-1 {
		background-color: var(--agent-1);
	}
	.dot-2 {
		background-color: var(--agent-2);
	}
	.dot-3 {
		background-color: var(--agent-3);
	}
	.dot-4 {
		background-color: var(--agent-4);
	}
	.dot-5 {
		background-color: var(--agent-5);
	}
	.dot-unknown {
		background-color: var(--agent-unknown);
	}
</style>
