<!--
  @component
  Format > Link…'s sheet, editmd's NSAlert with an accessory field (EditorWindowController.swift:115-150) on the port's
  Alert: the title "Add Link", the text "Enter the URL for the selected text.", a 320px URL field with the "https://"
  placeholder, prefilled by the caller, and Add (the default, Return) right of Cancel (Escape). With the caret in a link
  it is editmd's Edit Link: Update in place of Add, and Remove Link, which hands Add an empty URL as editmd's does. AppKit
  chrome in editmd, so it does not zoom; render it inside `Portal`, so it paints over the Document.
-->
<script lang="ts">
	import { focused_element, type ShadowNode } from 'gpuix-svelte'
	import { untrack } from 'svelte'
	import { keysOnceFocused } from '../../../app/fieldKeys.ts'
	import { useTheme } from '../../../app/theme.svelte.ts'
	import Alert from './Alert.svelte'

	let {
		url: initialUrl,
		edit,
		onadd,
		close
	}: {
		/** what the field starts with: the link's URL for Edit Link, else the pasteboard's URL, or '' */
		url: string
		/** the caret is in a link: editmd's Edit Link, with Update and Remove Link */
		edit: boolean
		/** Add or Update with the typed URL, Remove Link with '' */
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
	 * the field has the keys, so it shows AppKit's focus ring (e-link-dialog-source.png); transient UI (ADR-0011). read
	 * from native on a poll, as the find field's: an autofocused field reports no focus event and gpuix has no
	 * focus-change event (FindBar.svelte)
	 */
	let fieldFocused = $state(false)

	/** how often the field's focus is read, as the find field's */
	const FOCUS_POLL_MS = 100

	function trackFocus(node: ShadowNode) {
		const poll = setInterval(() => {
			fieldFocused = focused_element()?.nativeId === node.nativeId
		}, FOCUS_POLL_MS)
		return () => clearInterval(poll)
	}

	/** NSAlert paints its first button (Add or Update) rightmost, the second left of it, a third (Remove Link) leftmost */
	const buttons = $derived([
		...(edit
			? [{ label: 'Remove Link', testid: 'add-link-remove', onclick: () => onadd('') }]
			: []),
		{ label: 'Cancel', testid: 'add-link-cancel', onclick: close },
		{
			label: edit ? 'Update' : 'Add',
			testid: 'add-link-add',
			onclick: () => onadd(url),
			primary: true
		}
	])
</script>

<!--
  Return presses the default button: through the field's `onsubmit` while it has focus, which keeps the key from the
  window listener, and through the alert's window listener otherwise (as SaveAsDialog measured)
-->
<Alert
	testid="add-link"
	notice
	title={edit ? 'Edit Link' : 'Add Link'}
	message="Enter the URL for the selected text."
	{buttons}
	ondefault={() => onadd(url)}
	oncancel={close}
>
	<input
		class={['add-link-url', fieldFocused && 'add-link-url-focused']}
		testid="add-link-url"
		autofocus
		placeholder="https://"
		value={url}
		theme={theme().chromeTextTheme}
		onchange={(event) => (url = event.value ?? '')}
		onsubmit={() => onadd(url)}
		{@attach selectPrefill}
		{@attach trackFocus}
	/>
</Alert>

<style>
	/* editmd's accessory field is 320 by 24, a rounded bezel in the text background */
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
	/* AppKit's 3pt focus ring round the field while it has the keys, an outline that takes no room, as the find field's */
	.add-link-url-focused {
		outline-width: 3px;
		outline-color: var(--focus-ring);
	}
</style>
