<!--
  @component
  Format > Link…'s Add Link sheet, editmd's NSAlert (EditorWindowController.swift:115-150) drawn as the port's other
  alerts are: the title "Add Link", the text "Enter the URL for the selected text.", a 320px URL field with the
  "https://" placeholder, prefilled by the caller, and Add (the default, Return) right of Cancel (Escape). AppKit chrome
  in editmd, so it does not zoom; render it inside `Portal`, so it paints over the Document.
-->
<script lang="ts">
	import { on_window_key, type ShadowNode } from 'gpuix-svelte'
	import { untrack } from 'svelte'
	import { keysOnceFocused } from '../../../app/fieldKeys.ts'
	import { useTheme } from '../../../app/theme.svelte.ts'

	let {
		url: initialUrl,
		onadd,
		close
	}: {
		/** what the field starts with: the pasteboard's URL, or '' */
		url: string
		/** Add, with the typed URL */
		onadd: (url: string) => void
		/** Cancel or Escape */
		close: () => void
	} = $props()

	const theme = useTheme()

	/** the typed URL: transient dialog text, so it lives here (ADR-0011), starting from the prefill, read once */
	let url = $state(untrack(() => initialUrl))

	/**
	 * NSAlert's first field opens with its text selected, so typing replaces the prefilled URL: the field's own ⌘A
	 * selects it (gap G1), once the field has the keys; an empty field has nothing to select
	 */
	function selectPrefill(node: ShadowNode): void {
		if (untrack(() => initialUrl) !== '') void keysOnceFocused(node, 'cmd-a')
	}

	/**
	 * Return presses Add, the default button: through the field's `onsubmit` while it has focus, which keeps the key
	 * from the window listener, and through the window listener otherwise (as SaveAsDialog measured)
	 */
	$effect(() =>
		on_window_key('keydown', (event) => {
			if (event.key === 'enter') onadd(url)
			else if (event.key === 'escape') close()
		})
	)
</script>

<!-- the backdrop takes every click beside the sheet, so the sheet is modal as editmd's is -->
<div class="add-link-backdrop">
	<div class="add-link" testid="add-link" role="alertdialog" aria-label="Add Link">
		<text class="add-link-title" testid="add-link-title">Add Link</text>
		<text class="add-link-message" testid="add-link-message"
			>Enter the URL for the selected text.</text
		>
		<input
			class="add-link-url"
			testid="add-link-url"
			autofocus
			placeholder="https://"
			value={url}
			theme={theme().chromeTextTheme}
			onchange={(event) => (url = event.value ?? '')}
			onsubmit={() => onadd(url)}
			{@attach selectPrefill}
		/>
		<!-- NSAlert paints its first button (Add) rightmost -->
		<div class="add-link-buttons">
			<div
				class="add-link-button"
				testid="add-link-cancel"
				role="button"
				tabindex={0}
				onclick={close}
			>
				<text testid="add-link-cancel-label">Cancel</text>
			</div>
			<div
				class="add-link-button add-link-primary"
				testid="add-link-add"
				role="button"
				tabindex={0}
				onclick={() => onadd(url)}
			>
				<text testid="add-link-add-label">Add</text>
			</div>
		</div>
	</div>
</div>

<style>
	.add-link-backdrop {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.add-link {
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
	.add-link-title {
		font-size: 15px;
		font-weight: 600;
	}
	.add-link-message {
		font-size: 13px;
		color: var(--muted);
	}
	/* editmd's accessory field is 320 by 24 */
	.add-link-url {
		width: 320px;
		height: 24px;
		padding: 2px 6px;
		border-width: 1px;
		border-color: var(--border);
		border-radius: 5px;
		background-color: var(--background);
		font-size: 13px;
	}
	.add-link-buttons {
		display: flex;
		flex-direction: row;
		justify-content: flex-end;
		gap: 8px;
		font-size: 13px;
	}
	.add-link-button {
		padding: 4px 14px;
		border-width: 1px;
		border-color: var(--border);
		border-radius: 6px;
		background-color: var(--background);
		cursor: pointer;
	}
	.add-link-primary {
		border-color: var(--accent);
		background-color: var(--accent);
		color: var(--background);
	}
</style>
