<!--
  @component
  editmd's alert before a link of another scheme opens in whichever app claims it (LinkOpener.swift `confirm`),
  with its wording; Escape cancels. Render it inside `Portal`, so it paints over the Document.
-->
<script lang="ts">
	import { on_window_key } from 'gpuix-svelte'

	let {
		url,
		onopen,
		close
	}: {
		/** the link as written, shown so the user sees which app it would start */
		url: string
		/** the user chose Open */
		onopen: () => void
		/** Cancel or Escape */
		close: () => void
	} = $props()

	// Open is the default button, as NSAlert's first button, so Return presses it
	$effect(() =>
		on_window_key('keydown', (event) => {
			if (event.key === 'escape') close()
			else if (event.key === 'enter') onopen()
		})
	)
</script>

<!--
  the window-sized backdrop makes the dialog modal, as an NSAlert is: GPUI gives a click to the topmost element under
  the pointer, so a click beside the dialog lands here and never reaches the Document. it stays transparent, since
  editmd's palette has no dimming colour
-->
<div class="backdrop">
	<div class="dialog" testid="confirm-link" role="alertdialog" aria-label="Open this link?">
		<text class="title">Open this link?</text>
		<text class="message">{`It opens in another app:\n\n${url}`}</text>
		<div class="buttons">
			<div class="button" testid="confirm-link-cancel" role="button" tabindex={0} onclick={close}>
				<text>Cancel</text>
			</div>
			<div
				class="button primary"
				testid="confirm-link-open"
				role="button"
				tabindex={0}
				onclick={onopen}
			>
				<text>Open</text>
			</div>
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.dialog {
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: 360px;
		padding: 20px;
		border-width: 1px;
		border-color: var(--border);
		border-radius: 10px;
		background-color: var(--surface);
		color: var(--text);
	}
	.title {
		font-size: 15px;
		font-weight: 600;
	}
	.message {
		font-size: 13px;
		color: var(--muted);
	}
	.buttons {
		display: flex;
		flex-direction: row;
		justify-content: flex-end;
		gap: 8px;
	}
	.button {
		padding: 4px 14px;
		border-width: 1px;
		border-color: var(--border);
		border-radius: 6px;
		background-color: var(--background);
		cursor: pointer;
	}
	.primary {
		border-color: var(--accent);
		background-color: var(--accent);
		color: var(--background);
	}
</style>
