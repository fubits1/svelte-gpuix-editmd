<!--
  @component
  An NSAlert in editmd's palette: a bold message, informative text and a row of buttons, on a window-sized backdrop that
  makes it modal. Return presses `ondefault` and Escape `oncancel`, when given; a parent that handles the keys itself
  leaves both out. Render it inside `Portal`, or inside a dialog that already is, so it paints over the Document.
-->
<script module lang="ts">
	export type AlertButton = {
		label: string
		testid: string
		onclick: () => void
		/** the default button, painted in the accent as NSAlert's first button */
		primary?: boolean
	}
</script>

<script lang="ts">
	import { on_window_key } from 'gpuix-svelte'

	let {
		testid,
		title,
		message,
		buttons,
		ondefault,
		oncancel
	}: {
		/** the dialog's test id; its title is `<testid>-title`, its message `<testid>-message` */
		testid: string
		/** NSAlert's `messageText` */
		title: string
		/** NSAlert's `informativeText`, '' for none */
		message: string
		/** left to right, as they paint */
		buttons: AlertButton[]
		/** Return */
		ondefault?: () => void
		/** Escape */
		oncancel?: () => void
	} = $props()

	$effect(() => {
		if (!ondefault && !oncancel) return
		return on_window_key('keydown', (event) => {
			if (event.key === 'escape') oncancel?.()
			else if (event.key === 'enter') ondefault?.()
		})
	})
</script>

<!--
  GPUI gives a click to the topmost element under the pointer, so a click beside the alert lands on the backdrop and
  never reaches what is under it; the backdrop stays transparent, since editmd's palette has no dimming colour
-->
<div class="alert-backdrop">
	<div class="alert" {testid} role="alertdialog" aria-label={title}>
		<text class="alert-title" testid={`${testid}-title`}>{title}</text>
		<!-- NSAlert leaves out an empty informative text, as for a missing file, whose error has no suggestion -->
		{#if message}
			<text class="alert-message" testid={`${testid}-message`}>{message}</text>
		{/if}
		<div class="alert-buttons">
			{#each buttons as button (button.testid)}
				<!--
				  the default button takes the keys, as NSAlert's is the key view, so Return and Escape reach the window's
				  listener above rather than a field that had them (an empty Document's field is open from its load). GPUI
				  gives an element a focus handle, which `autofocus` needs, only with a key or focus listener (measured
				  headlessly), so the button has one; the keys themselves are the window listener's, which hears them after it
				-->
				<div
					class={['alert-button', button.primary && 'alert-primary']}
					testid={button.testid}
					role="button"
					tabindex={0}
					autofocus={button.primary === true}
					onclick={button.onclick}
					onkeydown={() => {}}
				>
					<text>{button.label}</text>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.alert-backdrop {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.alert {
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: 380px;
		padding: 20px;
		border-width: 1px;
		border-color: var(--border);
		border-radius: 10px;
		background-color: var(--surface);
		color: var(--text);
	}
	.alert-title {
		font-size: 15px;
		font-weight: 600;
	}
	.alert-message {
		font-size: 13px;
		color: var(--muted);
	}
	.alert-buttons {
		display: flex;
		flex-direction: row;
		justify-content: flex-end;
		gap: 8px;
	}
	.alert-button {
		padding: 4px 14px;
		border-width: 1px;
		border-color: var(--border);
		border-radius: 6px;
		background-color: var(--background);
		cursor: pointer;
	}
	.alert-primary {
		border-color: var(--accent);
		background-color: var(--accent);
		color: var(--background);
	}
</style>
