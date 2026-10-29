<!--
  @component
  File > Save As in place of editmd's NSSavePanel, which gpuix has no call for: a name field and the folder it saves
  in, chosen through the platform folder picker. Return presses Save, Escape cancels. When the name is taken it asks
  before replacing the file, in NSSavePanel's words, with Cancel as the default. AppKit chrome in editmd, so it does not zoom; render it inside
  `Portal`, so it paints over the Document.
-->
<script lang="ts">
	import { on_window_key, type ShadowNode } from 'gpuix-svelte'
	import { basename } from 'node:path'
	import { untrack } from 'svelte'
	import { keysOnceFocused } from '../../../app/fieldKeys.ts'
	import { useTheme } from '../../../app/theme.svelte.ts'
	import { steps } from '../../../core/fieldSelection.ts'
	import Alert from './Alert.svelte'

	let {
		name: initialName,
		folder,
		replacing,
		failure,
		onsave,
		onchoose,
		onreplace,
		oncancelreplace,
		close
	}: {
		/** what the name field starts with */
		name: string
		/** where Save writes */
		folder: string
		/** the existing file a Save would write over, while the dialog asks; null otherwise */
		replacing: string | null
		/** why the last write failed, null when none did */
		failure: string | null
		/** Save, with the typed name */
		onsave: (name: string) => void
		/** the folder button: opens the picker */
		onchoose: () => void
		/** the replace question's Replace */
		onreplace: () => void
		/** the replace question's Cancel, back to this dialog */
		oncancelreplace: () => void
		/** Cancel or Escape */
		close: () => void
	} = $props()

	const theme = useTheme()

	/**
	 * the typed name: transient dialog text, so it lives here (ADR-0011), starting from the prefill. read once:
	 * choosing a folder or answering the replace question hands the dialog a new overlay, which must not put
	 * the prefill back over what was typed (a `$derived` did, measured headlessly)
	 */
	let name = $state(untrack(() => initialName))

	/**
	 * NSSavePanel opens with the name's base selected, so typing replaces "render" of "render.md" and keeps the
	 * extension: the field's own keys select it (gap G1), from the line's start one shift-arrow per character, once the
	 * field has the keys. the prefill is read once, so a
	 * later name never selects again
	 */
	const selectBase = untrack(() => {
		const dot = initialName.lastIndexOf('.')
		const base = dot > 0 ? initialName.slice(0, dot) : initialName
		return [
			'cmd-left',
			...Array.from({ length: steps(base, 0, base.length) }, () => 'shift-right')
		].join(' ')
	})

	/** the name field selects its base once it has the keys */
	function selectBaseOnce(node: ShadowNode): void {
		void keysOnceFocused(node, selectBase)
	}

	/**
	 * Return presses the default button: Save, or Cancel while the replace question is up, as it is the safe
	 * answer. it arrives once: through the field's `onsubmit` while the field has focus, which then keeps it
	 * from the window listener, and through the window listener otherwise (measured headlessly)
	 */
	function pressReturn(): void {
		if (replacing === null) onsave(name)
		else oncancelreplace()
	}

	/** Escape answers the replace question while it is up, and cancels Save As otherwise */
	function pressEscape(): void {
		if (replacing === null) close()
		else oncancelreplace()
	}

	// one listener for both levels, so an Escape that answers the replace question never also cancels Save As
	$effect(() =>
		on_window_key('keydown', (event) => {
			if (event.key === 'enter') pressReturn()
			else if (event.key === 'escape') pressEscape()
		})
	)
</script>

<div class="save-as-backdrop">
	<div class="save-as" testid="save-as" role="dialog" aria-label="Save As">
		<div class="save-as-row">
			<text class="save-as-label">Save As:</text>
			<input
				class="save-as-name"
				testid="save-as-name"
				autofocus
				value={name}
				theme={theme().chromeTextTheme}
				onchange={(event) => (name = event.value ?? '')}
				onsubmit={pressReturn}
				{@attach selectBaseOnce}
			/>
		</div>
		<div class="save-as-row">
			<text class="save-as-label">Where:</text>
			<text class="save-as-folder" testid="save-as-folder">{folder}</text>
			<div
				class="save-as-button"
				testid="save-as-choose"
				role="button"
				tabindex={0}
				onclick={onchoose}
			>
				<text>Choose…</text>
			</div>
		</div>
		{#if failure}
			<text class="save-as-failure" testid="save-as-failure">{failure}</text>
		{/if}
		<div class="save-as-buttons">
			<div
				class="save-as-button"
				testid="save-as-cancel"
				role="button"
				tabindex={0}
				onclick={close}
			>
				<text>Cancel</text>
			</div>
			<div
				class="save-as-button save-as-primary"
				testid="save-as-save"
				role="button"
				tabindex={0}
				onclick={() => onsave(name)}
			>
				<text>Save</text>
			</div>
		</div>
	</div>
	{#if replacing !== null}
		<Alert
			testid="replace-file"
			title={`“${basename(replacing)}” already exists. Do you want to replace it?`}
			message={`A file or folder with the same name already exists in the folder “${basename(folder)}”. Replacing it will overwrite its current contents.`}
			buttons={[
				{ label: 'Cancel', testid: 'replace-file-cancel', onclick: oncancelreplace, primary: true },
				{ label: 'Replace', testid: 'replace-file-replace', onclick: onreplace }
			]}
		/>
	{/if}
</div>

<style>
	.save-as-backdrop {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.save-as {
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: 420px;
		padding: 20px;
		border-width: 1px;
		border-color: var(--border);
		border-radius: 10px;
		background-color: var(--surface);
		color: var(--text);
		font-size: 13px;
	}
	.save-as-row {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 8px;
	}
	.save-as-label {
		width: 64px;
		text-align: right;
	}
	.save-as-name {
		flex-grow: 1;
		min-width: 0;
		padding: 2px 6px;
		border-width: 1px;
		border-color: var(--border);
		border-radius: 5px;
		background-color: var(--background);
	}
	.save-as-folder {
		flex-grow: 1;
		min-width: 0;
		color: var(--muted);
	}
	.save-as-failure {
		color: var(--danger);
	}
	.save-as-buttons {
		display: flex;
		flex-direction: row;
		justify-content: flex-end;
		gap: 8px;
	}
	.save-as-button {
		padding: 4px 14px;
		border-width: 1px;
		border-color: var(--border);
		border-radius: 6px;
		background-color: var(--background);
		cursor: pointer;
	}
	.save-as-primary {
		border-color: var(--accent);
		background-color: var(--accent);
		color: var(--background);
	}
</style>
