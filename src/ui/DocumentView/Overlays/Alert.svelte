<!--
  @component
  An NSAlert as editmd's pictures show it (f-save-now-source.png, f-binary-source.png): a caution icon, a bold message,
  informative text and a row of equal buttons, on a window-sized backdrop that makes it modal. A `notice` is editmd's
  own plain NSAlert (f-encodings-source.png, e-link-policy-source.png): no icon, its default button filled in the accent.
  The `children` snippet is NSAlert's `accessoryView` (EditorWindowController.swift:122-129), between the text and the
  buttons, which takes the keys in place of a button. Return presses `ondefault` and Escape `oncancel`, when given; a
  parent that handles the keys itself leaves both out. Render it inside `Portal`, or inside a dialog that already is, so
  it paints over the Document.
-->
<script module lang="ts">
	type AlertButton = {
		label: string
		/** the button's test id; its label's is `<testid>-label` */
		testid: string
		onclick: () => void
		/** the default button, which Return presses: NSDocument's alerts ring it, editmd's own fill it in the accent */
		primary?: boolean
	}

	/**
	 * AppKit's caution icon with the app's own as its badge, drawn from editmd's picture: a 58×56pt box, the yellow
	 * triangle with a white rim and a white `!`, and editmd's M↓ document in its lower right. an <img>, since GPUI paints
	 * an <svg> as one-colour mask; AppKit's icon keeps its colours in either appearance
	 */
	const CAUTION_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(
		'<svg xmlns="http://www.w3.org/2000/svg" width="58" height="56" viewBox="0 0 58 56"><defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbe977"/><stop offset="1" stop-color="#e2b94a"/></linearGradient></defs><path d="M26.4 3.2a3 3 0 0 1 5.2 0l24 42.6a3 3 0 0 1-2.6 4.5H5a3 3 0 0 1-2.6-4.5z" fill="url(#c)" stroke="#fdfdfd" stroke-width="2.4" stroke-linejoin="round"/><rect x="27.6" y="14" width="4.8" height="19" rx="2.4" fill="#fdfdfd"/><circle cx="30" cy="40" r="2.8" fill="#fdfdfd"/><rect x="33" y="29.5" width="25" height="26" rx="5" fill="#f6f6f6" stroke="#d6d6d6" stroke-width="0.6"/><path d="M36.5 41v-7.5l3 4.5 3-4.5V41" fill="none" stroke="#3b82f6" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><path d="M48.5 33.5v7m-3-3 3 3 3-3" fill="none" stroke="#3b82f6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M36.5 46h15M36.5 49.5h15" stroke="#cfcfcf" stroke-width="0.8"/></svg>'
	)}`
</script>

<script lang="ts">
	import { on_window_key } from 'gpuix-svelte'
	import type { Snippet } from 'svelte'

	let {
		testid,
		title,
		message,
		buttons,
		notice = false,
		ondefault,
		oncancel,
		children
	}: {
		/** the dialog's test id; its title is `<testid>-title`, its message `<testid>-message`, its icon `<testid>-icon` */
		testid: string
		/** NSAlert's `messageText` */
		title: string
		/** NSAlert's `informativeText`, '' for none */
		message: string
		/** left to right, as they paint */
		buttons: AlertButton[]
		/** editmd's own plain NSAlert (`showNotice`, LinkOpener, Add Link): no icon, the default button filled in the accent */
		notice?: boolean
		/** Return */
		ondefault?: () => void
		/** Escape */
		oncancel?: () => void
		/** NSAlert's `accessoryView`, which takes the keys (`initialFirstResponder`); its own element takes the focus */
		children?: Snippet
	} = $props()

	/**
	 * the key view, which AppKit rings and gives the keys: none of the buttons while an accessory takes them; in editmd's
	 * own alert the leftmost button (e-link-policy-source.png rings Cancel, f-encodings-source.png its one OK); in
	 * NSDocument's its default button (f-save-now-source.png)
	 */
	const keyButton = $derived(
		children ? null : notice ? buttons[0] : buttons.find((button) => button.primary)
	)

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
  never reaches what is under it; the backdrop darkens the page as editmd's alert does
-->
<div class="alert-backdrop" testid={`${testid}-backdrop`}>
	<div
		class={['alert', children && 'alert-with-accessory']}
		{testid}
		role="alertdialog"
		aria-label={title}
	>
		{#if !notice}
			<img class="alert-icon" testid={`${testid}-icon`} src={CAUTION_ICON} alt="" />
		{/if}
		<text class="alert-title" testid={`${testid}-title`}>{title}</text>
		<!-- NSAlert leaves out an empty informative text, as for a missing file, whose error has no suggestion -->
		{#if message}
			<text class="alert-message" testid={`${testid}-message`}>{message}</text>
		{/if}
		{#if children}
			<div class="alert-accessory">
				{@render children()}
			</div>
		{/if}
		<div class={['alert-buttons', children && 'alert-buttons-centred']}>
			{#each buttons as button (button.testid)}
				<!--
				  the key button takes the keys, as NSAlert's is the key view, so Return and Escape reach the window's
				  listener above rather than a field that had them (an empty Document's field is open from its load). GPUI
				  gives an element a focus handle, which `autofocus` needs, only with a key or focus listener (measured
				  headlessly), so the button has one; the keys themselves are the window listener's, which hears them after it
				-->
				<div
					class={[
						'alert-button',
						button === keyButton && 'alert-key',
						button.primary && notice && 'alert-default-filled',
						children && 'alert-button-sized'
					]}
					testid={button.testid}
					role="button"
					tabindex={0}
					autofocus={button === keyButton}
					onclick={button.onclick}
					onkeydown={() => {}}
				>
					<text testid={`${button.testid}-label`}>{button.label}</text>
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
		background-color: var(--alert-dim);
	}
	/*
	 * f-save-now-source.png at 2x: the box 520 device px wide (260pt) with a 26pt corner and no border, its icon 25pt
	 * from the top and its text 22pt from the sides, its buttons 16pt from the sides and the bottom
	 */
	.alert {
		display: flex;
		flex-direction: column;
		width: 260px;
		padding: 25px 22px 16px;
		border-radius: 26px;
		background-color: var(--alert-surface);
		color: var(--text);
	}
	/* e-link-dialog-source.png at 2x: the box widens to 350pt round Add Link's 320pt field, 15pt from its sides */
	.alert-with-accessory {
		width: 350px;
	}
	/* the visible icon, 58×56pt, and 19pt to the title's line */
	.alert-icon {
		width: 58px;
		height: 56px;
		margin-bottom: 19px;
	}
	/* 13pt bold on 16pt lines (two lines 32 device px apart) */
	.alert-title {
		font-size: 13px;
		line-height: 16px;
		font-weight: 700;
	}
	/* 13pt on 16pt lines, 10pt below the title, in the title's label colour (both #e5e6e6 in the picture) */
	.alert-message {
		margin-top: 10px;
		font-size: 13px;
		line-height: 16px;
		color: var(--text);
	}
	/* e-link-dialog-source.png: the field 10pt below the text, reaching 7pt past it to 15pt from the box's sides */
	.alert-accessory {
		display: flex;
		flex-direction: column;
		margin: 10px -7px 0;
	}
	/* 16pt below the text, reaching 6pt past it to 16pt from the box's sides, 9.5pt apart */
	.alert-buttons {
		display: flex;
		flex-direction: row;
		gap: 9.5px;
		margin: 16px -6px 0;
	}
	/* e-link-dialog-source.png: beside an accessory the buttons keep their own width, centred under the field, 8pt apart */
	.alert-buttons-centred {
		justify-content: center;
		gap: 8px;
	}
	/* equal widths sharing the row, 28pt tall capsules in AppKit's push button fill */
	.alert-button {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-grow: 1;
		width: 0;
		min-width: 0;
		height: 28px;
		border-radius: 14px;
		background-color: var(--alert-button);
		font-size: 13px;
		cursor: pointer;
	}
	/* e-link-dialog-source.png: Cancel and Add 113pt each, narrower when a third shares the row */
	.alert-button-sized {
		flex-grow: 0;
		flex-shrink: 1;
		width: 113px;
	}
	/* the key button's ring, AppKit's 3pt focus ring round the capsule (7 device px at 2x, the outer two blended) */
	.alert-key {
		outline-width: 3px;
		outline-color: var(--focus-ring);
	}
	/* f-encodings-source.png, e-link-policy-source.png: editmd's own alert fills its default button in the accent */
	.alert-default-filled {
		background-color: var(--accent);
		color: var(--background);
	}
</style>
