<!--
  @component
  editmd's `.agent-deleted.between` line (style.css:481-498): a 2px dashed line in the Agent's `-deleted` colour where
  an Agent took text away, titled "Deleted by <name>, <time>:" and the text once the pointer rests on it. Drawn between
  top-level Blocks for a Deletion, and between the rows of a list or quote for children taken away.
-->
<script lang="ts">
	import Tooltip from 'gpuix-svelte/components/Tooltip.svelte'
	import { onDestroy } from 'svelte'
	import { useTheme } from '../../app/theme.svelte.ts'

	let {
		colour,
		tooltip,
		testid,
		tooltipTestid
	}: {
		/** the Agent's colour token, `agent-<slot>-deleted` or `agent-unknown-deleted` */
		colour: string
		/** what the line's tooltip says */
		tooltip: string
		testid: string
		tooltipTestid: string
	} = $props()

	const theme = useTheme()

	/** gpuix Tooltip's own hover delay, which the line's tip waits out too */
	const TIP_DELAY_MS = 300

	/** the tip shows once the pointer has rested on the line; transient UI (ADR-0011) */
	let tipOpen = $state(false)
	let tipTimer: ReturnType<typeof setTimeout> | undefined

	function enterTip(): void {
		clearTimeout(tipTimer)
		tipTimer = setTimeout(() => (tipOpen = true), TIP_DELAY_MS)
	}

	function leaveTip(): void {
		clearTimeout(tipTimer)
		tipOpen = false
	}

	onDestroy(() => clearTimeout(tipTimer))

	/**
	 * the line's dashes, `border-top: 2px dashed` (style.css:494-498), which gpuix cannot draw as a border
	 * (remorses/gpuix#60): svg lines side by side, together wider than the column, which the line's box clips to its own
	 * width. WebKit dashes a border three times its width; GPUI paints an svg as a mask in its element's `color`, the
	 * Agent's. one svg 2400px wide painted nothing (measured headlessly; 300px painted), so each is at most 1000px, a
	 * whole number of dash periods, so the dashes run on across them
	 */
	const dashes = $derived.by(() => {
		const thickness = theme().scaled(2)
		const period = thickness * 6
		const width = period * Math.floor(1000 / period)
		const dash = thickness * 3
		return {
			thickness,
			width,
			count: Math.ceil(theme().scaled(736) / width),
			source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${thickness}" viewBox="0 0 ${width} ${thickness}"><line x1="0" y1="${thickness / 2}" x2="${width}" y2="${thickness / 2}" stroke="black" stroke-width="${thickness}" stroke-dasharray="${dash} ${dash}"/></svg>`
		}
	})
</script>

<!-- a Tooltip's trigger for a tip the line's own hover opens: nothing, so the Tooltip is only the point it hangs from -->
{#snippet noTrigger()}{/snippet}

<div
	class="deleted"
	{testid}
	role="separator"
	aria-label={tooltip}
	style:color={`var(--${colour})`}
	onmouseenter={enterTip}
	onmouseleave={leaveTip}
>
	{#each { length: dashes.count }, part (part)}
		<svg
			class="dashes"
			style:width={`${dashes.width}px`}
			style:height={`${dashes.thickness}px`}
			source={dashes.source}
		></svg>
	{/each}
	<div class="tip">
		<Tooltip
			content={tooltip}
			open={tipOpen}
			side="bottom"
			align="start"
			testid={tooltipTestid}
			children={noTrigger}
		/>
	</div>
</div>

<style>
	/*
	 * `.agent-deleted.between { height: 0; border-top: 2px dashed }` as a 2px box holding the dashes, clipped to the
	 * column: GPUI reported a 0-height box below a border-only line, which a pointer could not land on
	 */
	.deleted {
		display: flex;
		width: 100%;
		height: var(--size-deleted-line);
		overflow: hidden;
	}
	.dashes {
		flex-shrink: 0;
	}
	/* a 0×0 point at the line's bottom-left corner, out of its flow, that its tooltip hangs from */
	.tip {
		position: absolute;
		left: 0;
		bottom: 0;
		width: 0;
		height: 0;
	}
</style>
