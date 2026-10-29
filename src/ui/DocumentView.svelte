<!--
  @component
  The open Document as rendered Blocks, one native <markdown> each; the Active block shows its source in a text field.
  In Source mode the whole Document shows as one text field instead. An open field takes the keys when it mounts,
  unless `autofocus` is false.
-->
<script lang="ts">
	import {
		focus_element,
		focused_element,
		get_native,
		type GpuixEvent,
		type GpuixTheme,
		type HighlightSpec,
		on_selection_change,
		on_window_key,
		type ShadowNode,
		window_size
	} from 'gpuix-svelte'
	import Portal from 'gpuix-svelte/components/Portal.svelte'
	import Tooltip from 'gpuix-svelte/components/Tooltip.svelte'
	import { onDestroy, untrack } from 'svelte'
	import { SvelteMap } from 'svelte/reactivity'
	import { spaceAbove, spaceAroundDeletions } from '../app/blockSpacing.ts'
	import { findController } from '../app/find.svelte.ts'
	import type { Match } from '../app/findMatches.ts'
	import { commandFor } from '../app/shortcuts.ts'
	import { headingThemeFor, plainFieldThemeFor } from '../app/palette.ts'
	import { provideCommandHeld, useTheme } from '../app/theme.svelte.ts'
	import { type Deletion, deletionSlot } from '../core/document.ts'
	import type { Row } from '../core/dropTarget.ts'
	import type { Block } from '../engine/blocks.ts'
	import AgentLegend from './DocumentView/AgentLegend.svelte'
	import Content from './DocumentView/Content.svelte'
	import { CODE_LABEL_TOP, NO_FIND, PREVIEW_GAP } from './DocumentView/DocumentView.model.ts'
	import { documentController, type RevealPlace } from './DocumentView/controller.svelte.ts'
	import { dropFiles } from './DocumentView/fileDrop.ts'
	import AddLinkDialog from './DocumentView/Overlays/AddLinkDialog.svelte'
	import Alert from './DocumentView/Overlays/Alert.svelte'
	import CommandPalette from './DocumentView/Overlays/CommandPalette.svelte'
	import ConfirmLinkDialog from './DocumentView/Overlays/ConfirmLinkDialog.svelte'
	import OpenRecentDialog from './DocumentView/Overlays/OpenRecentDialog.svelte'
	import SaveAsDialog from './DocumentView/Overlays/SaveAsDialog.svelte'
	import MermaidPreview from './DocumentView/Views/MermaidPreview.svelte'

	let {
		autofocus = true
	}: {
		/**
		 * an open field (a Block's, Source mode's) takes the keys when it mounts, so its caret blinks; false leaves it
		 * unfocused until a command or a click gives it the keys
		 */
		autofocus?: boolean
	} = $props()

	const theme = useTheme()

	/**
	 * editmd's `#editor` ends in `padding-bottom: 40vh`, so the last Block can scroll up to the top part of the
	 * window: 40% of the window's height, a share of the viewport that page zoom leaves alone. Source mode's field
	 * keeps it too, as it sits in the same `#editor` (style.css:64-69)
	 */
	/**
	 * room added below the page so a followed link's target near the end still reaches the window's top, as editmd's
	 * `scrollIntoView` puts its heading there (editmd's screenshot), where the page's own end would stop the scroll
	 * short; 0 until a link needs it, and back to 0 with each Document (the room is kept with the Document it was
	 * made for)
	 */
	let reveal = $state({ generation: -1, room: 0 })
	const revealRoom = $derived(
		reveal.generation === documentController.documentGeneration ? reveal.room : 0
	)

	const pageBottom = $derived(`${Math.round((window_size.height * 0.4 + revealRoom) * 10) / 10}px`)

	/**
	 * a field's row cap, past any document's line count: editmd shows a Block whole while it is edited and grows Source
	 * mode's field to its whole text (`field-sizing: content`), so neither scrolls inside itself; the page scrolls them
	 */
	const WHOLE_TEXT_ROWS = 1_000_000

	/** editmd's `.source { font: 14px/1.6 }`: a Source mode line, 22.4px at actual size */
	const SOURCE_LINE_HEIGHT = 14 * 1.6

	/** `.source { min-height: 70vh }` in Source mode's lines, at the page's zoom */
	const sourceMinRows = $derived(
		Math.max(1, Math.ceil((window_size.height * 0.7) / theme().scaled(SOURCE_LINE_HEIGHT)))
	)

	/**
	 * the menu shortcuts, subscribed here rather than in App.svelte: every Command acts on the open Document,
	 * which this view renders (blocks or Source mode), and App only adds the window's chrome around it; the
	 * headless suite mounts this view, so the shortcuts run through GPUI's real key dispatch there too
	 */
	$effect(() =>
		on_window_key('keydown', (event) => {
			if (event.key === undefined || event.modifiers === undefined) return
			/**
			 * a dialog is modal, as editmd's sheets and alerts are: `runShortcut` keeps the menu keys away from the
			 * Document while one shows (Cmd-S reopened Save As over the typed name), and the dialog's own listener
			 * keeps Return and Escape; an open menu closes and lets the key run, as AppKit's menus do
			 */
			// null for ordinary typing, which stays with the focused field
			const command = commandFor(event.key, event.modifiers)
			if (command) documentController.runShortcut(command, { editing: event.editing })
		})
	)

	/**
	 * ⌘ is held, so a Block holding a link shows the pointer, as editmd's `cmd-down` body class turns a link's text
	 * cursor into one (main.ts:48-54, style.css:170-181); transient UI (ADR-0011). told by the pointer's modifiers on
	 * every move, and by the window's keys: ⌘ alone arrives as the key `platform` (headless), any other key
	 * says whether ⌘ is down with it
	 */
	let cmdHeld = $state(false)

	// the Blocks' views turn a link's underline to its own colour while it is held
	provideCommandHeld(() => cmdHeld)

	$effect(() =>
		on_window_key('keydown', (event) => {
			cmdHeld = event.key === 'platform' || event.modifiers?.cmd === true
		})
	)
	$effect(() =>
		on_window_key('keyup', (event) => {
			if (event.key === 'platform') cmdHeld = false
		})
	)

	// the painted text the window's selection holds, which Edit > Copy and ⌘C copy
	$effect(() =>
		on_selection_change((event) => documentController.selectionChanged(event.value ?? null))
	)

	/** the Block an empty Document's first field stands for until its first keystroke makes a real one */
	const FIRST_BLOCK: Block = { kind: 'paragraph', start: 0, end: 0 }

	/**
	 * the Blocks to paint: an empty Document started from its hint (`startWriting`) holds FIRST_BLOCK for its
	 * field, keyed as the Block typing makes, so the field stays mounted when that Block arrives
	 */
	const paintedBlocks = $derived(
		documentController.blocks.length === 0 && documentController.activeIndex === 0
			? [FIRST_BLOCK]
			: documentController.blocks
	)

	/**
	 * editmd's empty-document hint (style.css `.markdown-body > p:only-child…::before`): a paragraph in the faint
	 * colour, which native <markdown> paints in its theme's `text`
	 */
	const hintTheme = $derived({ ...theme().textTheme, text: theme().textTheme.textFaint })

	/**
	 * open front matter's text, `.frontmatter { color: var(--muted) }`: a <textarea> takes its colour from its theme, and
	 * so does its caret, the system's in the muted text colour, as the page's accent caret is drawn only in the page
	 */
	const mutedTextTheme = $derived(
		plainFieldThemeFor(theme().textTheme, theme().textTheme.textMuted)
	)

	/** Source mode's field keeps the system caret in the text colour (`.source` is outside `.markdown-body`) */
	const sourceTextTheme = $derived(plainFieldThemeFor(theme().textTheme))

	/** each painted Block's node by index, for scrolling a followed link's target; nothing renders from it */
	const blockNodes = new SvelteMap<number, ShadowNode>()

	function trackBlock(index: number, node: ShadowNode) {
		blockNodes.set(index, node)
		return () => {
			if (blockNodes.get(index) === node) blockNodes.delete(index)
		}
	}

	/**
	 * scroll the nearest scrolling ancestor (App's Scroller) so `node`'s top meets its top, as a browser's
	 * scrollIntoView does; GPUI clamps the offset, so for a Block near the end the page grows the room it lacks
	 * (`revealRoom`) and the scroll is made again. GPUI's own
	 * `scroll_into_view` left the Block where it was (measured headlessly, with the Block three levels below the
	 * Scroller's column), so the offset is set on the first ancestor that reports one
	 */
	function scrollToTop(node: ShadowNode, top?: number): void {
		const scrolling = scrollingAncestorOf(node)
		if (!scrolling) return
		const { native, id, offset, viewport, target } = scrolling
		const [x, y] = offset
		const wanted = (y ?? 0) - ((top ?? target.y) - viewport.y)
		native.scrollTo(id, x ?? 0, wanted)
		// GPUI clamps at the page's end: the room it fell short by goes below the page, then the scroll is made again
		setTimeout(() => {
			const reached = native.getScrollOffset(id)?.[1]
			if (reached === undefined || reached - wanted <= 1) return
			reveal = {
				generation: documentController.documentGeneration,
				room: revealRoom + reached - wanted
			}
			setTimeout(() => native.scrollTo(id, x ?? 0, wanted), REVEAL_SETTLE_MS)
		}, REVEAL_SETTLE_MS)
	}

	/** how long a scroll or a taller page takes to paint before the next step reads or uses it */
	const REVEAL_SETTLE_MS = 32

	/**
	 * scroll the nearest scrolling ancestor so `node`'s top meets the middle of what it shows, as editmd's `reveal`
	 * scrolls a change's top to the window's middle (highlights.ts:131-142: `coordsAtPos(at).top` by
	 * `top - window.innerHeight / 2`). a Block near the top stops the page at its top, offsets running negative
	 * as the page scrolls down; GPUI clamps one past the end, as for `scrollToTop`. `top`, in window coordinates, puts a
	 * point inside the node there instead of its top (a changed run's)
	 */
	function scrollToMiddle(node: ShadowNode, top?: number): void {
		const scrolling = scrollingAncestorOf(node)
		if (!scrolling) return
		const { native, id, offset, viewport, target } = scrolling
		const [x, y] = offset
		const shownMiddle = viewport.y + viewport.height / 2
		native.scrollTo(id, x ?? 0, Math.min(0, (y ?? 0) - ((top ?? target.y) - shownMiddle)))
	}

	/** the first ancestor of `node` that reports a scroll offset, with its viewport and `node`'s painted box */
	function scrollingAncestorOf(node: ShadowNode) {
		const native = get_native()
		const target = node.nativeId === null ? null : native?.getElementBounds(node.nativeId)
		if (!native || !target) return null
		for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
			if (ancestor.nativeId === null) continue
			const offset = native.getScrollOffset(ancestor.nativeId)
			const viewport = native.getElementBounds(ancestor.nativeId)
			if (!offset || !viewport) continue
			return { native, id: ancestor.nativeId, offset, viewport, target }
		}
		return null
	}

	/**
	 * scrolls Block `index` to the top, as a followed link does, or to the middle, as an Agent's revealed change; a
	 * revealed change of `run`, a changed run's text, puts that run's painted top there, as editmd's `reveal` scrolls to
	 * the change's own position (`coordsAtPos`, highlights.ts:133-141), however deep in a tall Block it is
	 */
	function revealBlock(index: number, place: RevealPlace = 'top', run?: string): void {
		const node = blockNodes.get(index)
		if (!node) return
		const runTop = run === undefined ? undefined : runRectIn(node, run)?.y
		if (place === 'middle') scrollToMiddle(node, runTop)
		else scrollToTop(node, runTop)
	}

	/** the first painted box of the changed run `run` washed inside `node`, null when none paints */
	function runRectIn(node: ShadowNode, run: string) {
		const wash = get_native()
			?.getPaintedHighlights()
			.find(
				({ active, elementId, text, start, end }) =>
					active && text.slice(start, end) === run && holds(node, elementId)
			)
		return wash?.rects[0] ?? null
	}

	/** a changed run's underline, editmd's inset 2px shadow, and how often its painted boxes are read */
	const UNDERLINE_PX = 2
	const UNDERLINE_POLL_MS = 100

	/** gpuix Tooltip's own hover delay, which a highlighted Block's tip waits out too */
	const TIP_DELAY_MS = 300

	/**
	 * whose tooltip shows, once the pointer has rested on it: a highlighted Block (`block-<index>`) or a Deletion
	 * line (`deleted-<n>`); transient UI (ADR-0011)
	 */
	let tipped = $state<string | null>(null)
	/** whose tip waits out the delay; GPUI may report the next one's enter before this one's leave */
	let pendingTip: string | null = null
	let tipTimer: ReturnType<typeof setTimeout> | undefined

	/**
	 * the pointer on a highlighted Block or a Deletion line: its tip shows after the delay. the Block, not a Tooltip
	 * around it, takes the hover: Tooltip's wrapper shrinks a full-width Block to its content (45px of 784)
	 */
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

	/**
	 * the Deletion lines by the index of the Block they paint above (the Blocks' count for after the last), each with
	 * its index in `deletions` for its test id. typing moves their offsets in place, and the new Blocks place them again
	 */
	const deletionsBySlot = $derived.by(() => {
		const bySlot = new SvelteMap<number, { deletion: Deletion; n: number }[]>()
		documentController.deletions.forEach((deletion, n) => {
			const slot = deletionSlot(paintedBlocks, deletion.offset)
			bySlot.set(slot, [...(bySlot.get(slot) ?? []), { deletion, n }])
		})
		return bySlot
	})

	/**
	 * a Deletion line's dashes, `border-top: 2px dashed` (style.css:494-498), which gpuix cannot draw as a border
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

	/** the space class of a margin token, null for none */
	const spaceClassOf = (margin: string | null) => margin && `space-${margin}`

	onDestroy(() => clearTimeout(tipTimer))

	// an Active block shows its field instead, which has no node here, so it is not scrolled
	$effect(() => documentController.onRevealBlock(revealBlock))

	/** the Active block's field, kept apart from `blockNodes` so a followed link never scrolls to it */
	let activeField: ShadowNode | null = null

	function trackField(node: ShadowNode) {
		activeField = node
		return () => {
			if (activeField === node) activeField = null
		}
	}

	/** the Active block's <textarea> itself (inside a code card too), which a cancelled sheet gives focus back to */
	let editorNode: ShadowNode | null = null
	/** the `fieldRevision` `editorNode` was mounted at, so a field mounted afresh is told from the one it replaces */
	let editorRevision = -1

	function trackEditor(node: ShadowNode) {
		editorNode = node
		editorRevision = untrack(() => documentController.fieldRevision)
		mountedAt.set(node, editorRevision)
		return () => {
			if (editorNode === node) editorNode = null
		}
	}

	/**
	 * the `fieldRevision` each Block field was mounted at, by its node, read when it reports a change: the controller
	 * drops what a field reports once another was mounted in its place, so a probe's late sentinel never reaches the
	 * Document. kept by node, since an event handler's expression is read when the event comes, by then the new
	 * revision; nothing renders from it
	 */
	const mountedAt = new WeakMap<ShadowNode, number>()

	function changeOfField(event: GpuixEvent & { value: string }): void {
		documentController.typeInActive(event.value, mountedAt.get(event.currentTarget) ?? -1)
	}

	/** Source mode's field, which takes the keys its commands send (its caret to the top, Edit's field keys) */
	let sourceNode: ShadowNode | null = null

	function trackSource(node: ShadowNode) {
		sourceNode = node
		return () => {
			if (sourceNode === node) sourceNode = null
		}
	}

	/**
	 * the open field takes the keys, for the keys a command sends it: Source mode's, or the Block field
	 * mounted at `revision`; false while that one has not been painted yet
	 */
	function focusField(revision: number): boolean {
		const node = documentController.sourceMode
			? sourceNode
			: editorRevision === revision
				? editorNode
				: null
		if (node?.nativeId == null) return false
		focus_element(node)
		return focused_element()?.nativeId === node.nativeId
	}

	$effect(() => documentController.onFocusField(focusField))

	/** the dialogs that are alerts: buttons only, Return and Escape heard through the window's keys */
	const ALERTS = new Set([
		'confirmLink',
		'saveChanges',
		'revert',
		'openFailed',
		'saveFailed',
		'saveLocked',
		'saveNotice'
	])
	/** an alert was up at the last look; nothing renders from it */
	let alertUp = false

	/**
	 * an alert takes the keys from an open field (its default button is the key view), as editmd's sheets take them
	 * from its page; the field gets them back once it goes, as editmd's page does
	 */
	$effect(() => {
		const up = ALERTS.has(documentController.overlay?.kind ?? '')
		if (!up && alertUp) untrack(() => focusField(documentController.fieldRevision))
		alertUp = up
	})

	/**
	 * every Block's painted top and height, in order, for placing a drop. a Block's own node counts while it is
	 * painted, and the Active block's field in its place. a Block not painted yet sorts after every drop, so it
	 * never takes one
	 */
	function blockRows(): Row[] {
		const native = get_native()
		return documentController.blocks.map((_block, index) => {
			const node =
				blockNodes.get(index) ?? (index === documentController.activeIndex ? activeField : null)
			const box = node?.nativeId == null ? null : native?.getElementBounds(node.nativeId)
			return box ? { top: box.y, height: box.height } : { top: Number.POSITIVE_INFINITY, height: 0 }
		})
	}

	$effect(() => documentController.onBlockRows(blockRows))

	/**
	 * a heading's text size and line height, in px at the page's zoom, and the level of the rule an h1 or h2 draws below
	 * it (null for h3-h6)
	 */
	type HeadingFont = { size: number; lineHeight: number; rule: 1 | 2 | null }

	/**
	 * the open field of a heading Block paints at the heading's size and line height, as editmd edits a heading in place,
	 * so opening an h1 does not shrink it and move the page: native <markdown>'s tier for the level (h4-h6 share the
	 * fourth, which `headingThemeFor` sets to an h5's or h6's own size); null for any other Block
	 */
	const headingFont = $derived.by((): HeadingFont | null => {
		const index = documentController.activeIndex
		if (index === null || documentController.activeKind !== 'heading') return null
		const level = documentController.blocks[index]?.heading?.level
		if (!level) return null
		const metrics = headingThemeFor(theme().textTheme, level, theme().zoom).metrics
		const tier = Math.min(level, 4) - 1
		const size = metrics?.mdHeadingSizes?.[tier]
		const lineHeight = metrics?.mdHeadingLineHeights?.[tier]
		const rule = level === 1 || level === 2 ? level : null
		return size && lineHeight ? { size, lineHeight, rule } : null
	})

	/** whether the painted element `elementId` is `node` or inside it */
	function holds(node: ShadowNode, elementId: number): boolean {
		if (node.nativeId === elementId) return true
		for (let child = node.first; child; child = child.next) if (holds(child, elementId)) return true
		return false
	}

	/**
	 * Find's active match, painted in the element `elementId` from offset `start`, scrolls into view: its own painted
	 * wash goes to the top, as the browser's find scrolls to the match, however deep in a Block taller than the window
	 * it is; a match whose wash is not painted yet takes its Block's top. nothing moves while it already shows, so
	 * stepping between visible matches keeps still
	 */
	function revealMatch({ elementId, start }: Match): void {
		const wash = get_native()
			?.getPaintedHighlights()
			.find((each) => each.elementId === elementId && each.start === start)
		for (const node of blockNodes.values()) {
			if (!holds(node, elementId)) continue
			const scrolling = scrollingAncestorOf(node)
			if (!scrolling) return
			const { viewport, target } = scrolling
			const box = wash?.rects[0] ?? target
			const shown = box.y >= viewport.y && box.y + box.height <= viewport.y + viewport.height
			if (!shown) scrollToTop(node, box.y)
			return
		}
	}

	/** the index of the painted Block holding the painted element `elementId`, null for none */
	function blockIndexOf(elementId: number): number | null {
		for (const [index, node] of blockNodes) if (holds(node, elementId)) return index
		return null
	}

	/**
	 * the Blocks Agents' changes mark by their changed runs (`changedRunsOf`), by index, with a wash for each run of
	 * every such change: editmd's `.agent-change` (style.css:468-472) in its own Agent's colour over exactly that
	 * occurrence of the run's text, the others transparent (measured headless: `activeIndex` washes the nth occurrence
	 * only). editmd also underlines the run, which a `highlight` cannot draw (HighlightSpec has no underline), so
	 * `runUnderlines` draws it from the washes' painted boxes
	 */
	const runWashes = $derived.by(() => {
		const marked = new SvelteMap<number, HighlightSpec[]>()
		paintedBlocks.forEach((block, index) => {
			const changes = documentController.changedRunsOf(block)
			if (changes.length === 0) return
			marked.set(
				index,
				changes.flatMap(({ runs, agentClass }) =>
					runs.map((run) => ({
						query: run.text,
						caseSensitive: true,
						color: '#00000000',
						activeColor: theme().palette[`${agentClass}-change`],
						activeIndex: run.index
					}))
				)
			)
		})
		return marked
	})

	/** the key of the `occurrence`th run of `text` in its Block, which one Agent's change marks */
	const runKey = (text: string, occurrence: number) => `${text}\u0000${occurrence}`

	/**
	 * each run-marked Block's runs, by index, with the colour that underlines each: its Agent's at 70%. a run is keyed
	 * by its text and which occurrence of that text it is (`runKey`), so two Agents who wrote the same word in one
	 * Block each underline their own
	 */
	const underlineColours = $derived.by(() => {
		const byBlock = new SvelteMap<number, SvelteMap<string, string>>()
		paintedBlocks.forEach((block, index) => {
			const colours = new SvelteMap<string, string>()
			for (const { runs, agentClass } of documentController.changedRunsOf(block))
				for (const run of runs)
					colours.set(runKey(run.text, run.index), theme().palette[`${agentClass}-deleted`] ?? '')
			if (colours.size > 0) byBlock.set(index, colours)
		})
		return byBlock
	})

	/** a changed run's underline: where it paints in its Block, in logical px from the Block's box, and its colour */
	type Underline = {
		key: string
		index: number
		x: number
		y: number
		width: number
		colour: string
	}

	/**
	 * the underlines as last measured: `box-shadow: inset 0 -2px 0 color-mix(var(--agent) 70%, transparent)`, a 2px bar
	 * along the bottom of each box a run's wash paints. read back from the paint, as Find's matches are, since only
	 * native knows where a run lands; transient UI (ADR-0011)
	 */
	let runUnderlines = $state.raw<readonly Underline[]>([])

	/** reads where the runs' washes painted, and keeps the underlines when they moved */
	function measureUnderlines(): void {
		const native = get_native()
		const washes = native?.getPaintedHighlights() ?? []
		const thickness = theme().scaled(UNDERLINE_PX)
		const next: Underline[] = []
		for (const [index, colours] of underlineColours) {
			const node = blockNodes.get(index)
			const box = node?.nativeId == null ? null : native?.getElementBounds(node.nativeId)
			if (!node || !box) continue
			/**
			 * which occurrence of its text in the Block each painted run is: native numbers a spec's matches in paint
			 * order, and every run's spec washes every occurrence of its text, so each place counts once
			 */
			const places = new Map<string, string[]>()
			for (const wash of washes) {
				if (!holds(node, wash.elementId)) continue
				const text = wash.text.slice(wash.start, wash.end)
				const place = `${wash.elementId}:${wash.sub}:${wash.start}`
				const seen = places.get(text) ?? []
				if (!seen.includes(place)) places.set(text, [...seen, place])
			}
			for (const wash of washes) {
				if (!wash.active || !holds(node, wash.elementId)) continue
				const text = wash.text.slice(wash.start, wash.end)
				const occurrence = (places.get(text) ?? []).indexOf(
					`${wash.elementId}:${wash.sub}:${wash.start}`
				)
				const colour = colours.get(runKey(text, occurrence))
				if (colour === undefined) continue
				for (const rect of wash.rects)
					next.push({
						key: `${index}-${next.length}`,
						index,
						x: rect.x - box.x,
						y: rect.y + rect.height - thickness - box.y,
						width: rect.width,
						colour
					})
			}
		}
		if (JSON.stringify(next) !== JSON.stringify(runUnderlines)) runUnderlines = next
	}

	// gpuix has no paint event, so the runs' boxes are read on a poll while any run is marked, as Find reads its matches
	$effect(() => {
		if (underlineColours.size === 0) return
		untrack(measureUnderlines)
		const poll = setInterval(measureUnderlines, UNDERLINE_POLL_MS)
		return () => clearInterval(poll)
	})

	// Find leaves the runs' washes out of its matches, since native lists them with its own
	$effect(() =>
		findController.setForeignTexts(
			[...runWashes.values()].flatMap((specs) => specs.map(({ query }) => query ?? ''))
		)
	)

	/**
	 * Find's `highlight` with Blocks marked by runs: such a Block declares its own `highlight`, which replaces the
	 * container's in it and which the container's numbering skips (measured headless), so the container's active
	 * index counts only the matches outside them, and each such Block repeats Find's spec from its first match on
	 * (`matchIndexOffset`), the matches read from the paint giving both
	 */
	const findSpecs = $derived.by(() => {
		const spec = findController.highlight(theme().palette)
		const offsets = new SvelteMap<number, number>()
		if (!spec || runWashes.size === 0) return { outer: spec, inner: spec, offsets }
		let outerActive = -1
		let outerCount = 0
		findController.matches.forEach((match, n) => {
			const owner = blockIndexOf(match.elementId)
			if (owner !== null && runWashes.has(owner)) {
				if (!offsets.has(owner)) offsets.set(owner, n)
				return
			}
			if (n === findController.active) outerActive = outerCount
			outerCount++
		})
		return {
			outer: { ...spec, activeIndex: outerActive < 0 ? outerCount : outerActive },
			inner: spec,
			offsets
		}
	})

	/** a Block's own `highlight`: Find's, then its runs' washes, for a Block marked by runs; null for any other */
	function blockHighlight(index: number): HighlightSpec[] | null {
		const washes = runWashes.get(index)
		if (!washes) return null
		const { inner, offsets } = findSpecs
		return inner ? [{ ...inner, matchIndexOffset: offsets.get(index) ?? 0 }, ...washes] : washes
	}

	$effect(() => findController.onReveal(revealMatch))
	// the matches are read from the paint this view's highlight makes, so the poll lives as long as the view
	$effect(() => findController.start())
</script>

<!-- a Tooltip's trigger for a tip the Block's own hover opens: nothing, so the Tooltip is only the point it hangs from -->
{#snippet noTrigger()}{/snippet}

<!--
  the Deletion lines above the Block at `slot` (after the last Block when `slot` is their count): editmd's dashed
  2px line in the Agent's colour, its dashes an svg since gpuix has no dashed border (remorses/gpuix#60)
-->
{#snippet deletionLines(slot: number, spaceClass: string | null)}
	<div class={['deletions', spaceClass]}>
		{#each deletionsBySlot.get(slot) ?? [] as { deletion, n } (n)}
			<div
				class={['deleted', documentController.deletionClassOf(deletion)]}
				testid={`deleted-${n}`}
				role="separator"
				aria-label={documentController.deletionTooltipOf(deletion)}
				onmouseenter={() => enterTip(`deleted-${n}`)}
				onmouseleave={() => leaveTip(`deleted-${n}`)}
			>
				{#each { length: dashes.count }, part (part)}
					<svg
						class="dashes"
						style:width={`${dashes.width}px`}
						style:height={`${dashes.thickness}px`}
						source={dashes.source}
					></svg>
				{/each}
				<div class="block-tip">
					<Tooltip
						content={documentController.deletionTooltipOf(deletion)}
						open={tipped === `deleted-${n}`}
						side="bottom"
						align="start"
						testid={`deleted-tooltip-${n}`}
						children={noTrigger}
					/>
				</div>
			</div>
		{/each}
	</div>
{/snippet}

<!--
  the Active block's field; `tracked` when it is the outermost painted box, so a drop measures it (a code card
  wrapping it is tracked instead). `font` is a heading's size and line height, which a <textarea> takes from its style
-->
{#snippet blockField(
	look: 'editor' | 'code-field' | 'frontmatter-field',
	spaceClass: string | null,
	tracked: boolean,
	fieldTheme: GpuixTheme,
	font: HeadingFont | null = null,
	agentClass: string | null = null
)}
	<textarea
		class={[look, spaceClass, font && 'heading-field', agentClass && `agent ${agentClass}`]}
		testid="block-editor"
		style:font-size={font ? `${font.size}px` : null}
		style:line-height={font ? `${font.lineHeight}px` : null}
		{autofocus}
		value={documentController.activeSource}
		theme={fieldTheme}
		minRows={1}
		maxRows={WHOLE_TEXT_ROWS}
		{@attach tracked && trackField}
		{@attach trackEditor}
		onchange={changeOfField}
		onkeydown={(event) => {
			if (event.key === 'escape') documentController.closeEdit()
			else if (
				event.key !== undefined &&
				event.modifiers !== undefined &&
				documentController.tabInField(event.key, event.modifiers)
			)
				event.preventDefault()
		}}></textarea>
{/snippet}

<!-- a file dropped anywhere on the page, its margins included, lands between the Blocks -->
<div
	class="page"
	onfiledrop={dropFiles}
	onmousemove={(event) => (cmdHeld = event.modifiers?.cmd === true)}
	role="presentation"
>
	<div class="document" testid="document" style:padding-bottom={pageBottom}>
		{#if !documentController.sourceMode && documentController.blocks.length === 0 && documentController.activeIndex === 0}
			<!--
			  the field an empty Document opens on load (editmd focuses its editor, main.ts:80-84) keeps the hint until its
			  first character: painted behind the field, which paints no fill of its own, in the hint's own colour (a
			  <textarea>'s placeholder paints in a fixed grey whatever its theme, measured headlessly: #8f8f8f)
			-->
			<div class="field-hint" testid="empty-hint">
				<markdown testid="empty-hint-text" source="Start writing…" theme={hintTheme}></markdown>
			</div>
		{/if}
		<!-- the find highlight sits on the container of every painted Block, so it searches each Block's native markdown -->
		<div class="blocks" highlight={findSpecs.outer}>
			{#if documentController.sourceMode}
				<!--
				  Source mode: only Cmd-/ leaves it, as in editmd, so Escape stays with the field. it grows to its whole text,
				  at least 70% of the window, and the page scrolls it (`min-height: 70vh; field-sizing: content`)
				-->
				<textarea
					class="source"
					testid="source-editor"
					{autofocus}
					value={documentController.activeSource}
					minRows={sourceMinRows}
					maxRows={WHOLE_TEXT_ROWS}
					theme={sourceTextTheme}
					{@attach trackSource}
					onchange={(event) => documentController.typeInActive(event.value)}></textarea>
			{:else}
				<!--
				  the Active block's key follows its Edit session, not its offset: a Disk merge that adds or removes a Block
				  above moves its start, and a new key would remount the field, losing what it shows and its caret
				-->
				{#each paintedBlocks as block, index (index === documentController.activeIndex ? 'active' : block.start)}
					{@const agentClass = documentController.agentClassOf(block)}
					{@const tooltip = documentController.highlightTooltipOf(block)}
					{@const deleted = deletionsBySlot.has(index)}
					<!-- a Deletion line above takes the space above the Block, and the Block keeps the line's own below it -->
					{@const around = spaceAroundDeletions(paintedBlocks[index - 1], block)}
					{@const spaceClass = spaceClassOf(
						deleted ? around.below : spaceAbove(paintedBlocks[index - 1], block)
					)}
					{@const covered = documentController.coveredByField(index)}
					{#if deleted && !covered}
						{@render deletionLines(index, spaceClassOf(around.above))}
					{/if}
					{#if covered}
						<!-- a Block the open field holds after its own (a Format command wrote several) paints only there -->
					{:else if documentController.activeIndex === index}
						<!-- a Format command replaces the field's text by mounting a fresh field -->
						{#key documentController.fieldRevision}
							{#if documentController.activeKind === 'code' || documentController.activeKind === 'mermaid'}
								{@const label = block.lang ? block.lang.toLowerCase() : null}
								<!--
								  editmd edits a code block inside its `pre` card, so the field sits in one, and the card keeps
								  its `pre[data-language]::before` label, a mermaid one's "mermaid" included
								-->

								<div
									class={['code-card', spaceClass]}
									testid="block-editor-card"
									{@attach trackField}
								>
									{@render blockField('code-field', null, false, theme().textTheme)}
									{#if label}
										<text
											class="code-label"
											testid="block-editor-label"
											highlight={NO_FIND}
											style:top={`${theme().scaled(CODE_LABEL_TOP)}px`}>{label}</text
										>
									{/if}
								</div>
								{#if documentController.activeKind === 'code'}
									<!-- the room below an open code card too, as CodeBlock keeps it (`.diagram` shows while editing) -->
									<div class="diagram-room"></div>
								{/if}
							{:else if documentController.activeKind === 'frontmatter'}
								<!--
								  editmd edits front matter inside its box, a contenteditable `pre.frontmatter`
								  (frontmatter.ts:20-23), which `.frontmatter:focus` rings in the selection colour
								-->
								<div
									class={['frontmatter-card', spaceClass]}
									testid="block-editor-card"
									{@attach trackField}
								>
									{@render blockField('frontmatter-field', null, false, mutedTextTheme)}
								</div>
							{:else}
								{@const fieldAgent = documentController.fieldAgentClassOf(index)}
								{#if headingFont?.rule}
									<!-- an h1 or h2 keeps its rule below its text while it is edited, as editmd's heading does -->
									<div
										class={['field-rule', `field-rule-${headingFont.rule}`, spaceClass]}
										testid="block-editor-rule"
										{@attach trackField}
									>
										{@render blockField(
											'editor',
											null,
											false,
											theme().textTheme,
											headingFont,
											fieldAgent
										)}
									</div>
								{:else}
									{@render blockField(
										'editor',
										spaceClass || null,
										true,
										theme().textTheme,
										headingFont,
										fieldAgent
									)}
								{/if}
							{/if}
						{/key}
						<!-- editmd keeps a diagram painted below its source while it is edited, as a live preview -->
						{#if block.kind === 'mermaid'}
							<div class="preview" style:margin-top={`${theme().scaled(PREVIEW_GAP)}px`}>
								<MermaidPreview {block} {index} />
							</div>
						{/if}
					{:else}
						<!--
						  task lists open from their item text, so a checkbox click only ticks. the Block takes a drop as
						  the page does: GPUI would hand a drop on it to its click (measured headless), opening it
						-->
						<div
							class={['block', spaceClass, agentClass !== null && `agent ${agentClass}`]}
							testid={`block-${index}`}
							highlight={blockHighlight(index)}
							style:cursor={cmdHeld && block.links ? 'pointer' : 'text'}
							hitbox={block.tasks ? null : 'self'}
							onmousedown={block.tasks
								? null
								: (event) => documentController.pressBlock(event.x, event.y)}
							onclick={block.tasks
								? null
								: (event) =>
										documentController.clickBlock(index, {
											cmd: event.modifiers?.cmd === true,
											x: event.x,
											y: event.y
										})}
							onfiledrop={dropFiles}
							onmouseenter={tooltip === null ? null : () => enterTip(`block-${index}`)}
							onmouseleave={tooltip === null ? null : () => leaveTip(`block-${index}`)}
							{@attach (node: ShadowNode) => trackBlock(index, node)}
						>
							<Content {block} {index} />
							<!-- a measure left from runs since cleared paints nothing: only a run-marked Block draws underlines -->
							{#each underlineColours.has(index) ? runUnderlines.filter((line) => line.index === index) : [] as line (line.key)}
								<div
									class="run-underline"
									testid={`run-underline-${line.key}`}
									style:left={`${line.x}px`}
									style:top={`${line.y}px`}
									style:width={`${line.width}px`}
									style:height={`${theme().scaled(UNDERLINE_PX)}px`}
									style:background-color={line.colour}
								></div>
							{/each}
							<!-- editmd titles a highlight "<name>, <time>"; the tip hangs below the Block's bottom-left corner -->
							{#if tooltip !== null}
								<div class="block-tip">
									<Tooltip
										content={tooltip}
										open={tipped === `block-${index}`}
										side="bottom"
										align="start"
										testid={`block-tooltip-${index}`}
										children={noTrigger}
									/>
								</div>
							{/if}
						</div>
					{/if}
				{/each}
				{#if deletionsBySlot.has(paintedBlocks.length)}
					{@render deletionLines(
						paintedBlocks.length,
						spaceClassOf(spaceAroundDeletions(paintedBlocks.at(-1), undefined).above)
					)}
				{/if}
			{/if}
		</div>
		<!--
		  not part of the text: it shows only while the body holds no text (no Block, or front matter only) and no field
		  is open. it sits outside the highlighted container, as editmd's hint is a CSS ::before that find never matches;
		  after the Blocks, so it keeps the first body Block's place, below any front matter box with its margin
		-->
		{#if !documentController.sourceMode && documentController.bodyBlank && documentController.activeIndex === null}
			<div
				class={['block', spaceClassOf(spaceAbove(paintedBlocks.at(-1), FIRST_BLOCK))]}
				testid="empty-hint"
				hitbox="self"
				onclick={() => documentController.startWriting()}
			>
				<markdown testid="empty-hint-text" source="Start writing…" theme={hintTheme}></markdown>
			</div>
		{/if}
	</div>
</div>

<!-- editmd's legend is `position: fixed` in the page's corner, so it floats over the scrolling Blocks -->
{#if documentController.agents.length > 0}
	<Portal>
		<AgentLegend />
	</Portal>
{/if}

{#if documentController.overlay?.kind === 'confirmLink'}
	<Portal>
		<ConfirmLinkDialog
			url={documentController.overlay.url}
			onopen={() => documentController.openConfirmedLink()}
			close={() => documentController.closeOverlay()}
		/>
	</Portal>
{:else if documentController.overlay?.kind === 'saveAs'}
	<Portal>
		<SaveAsDialog
			name={documentController.overlay.name}
			folder={documentController.overlay.folder}
			replacing={documentController.overlay.replacing}
			failure={documentController.overlay.failure}
			onsave={(name) => documentController.saveAs(name)}
			onchoose={() => documentController.chooseSaveFolder()}
			onreplace={() => documentController.replaceFile()}
			oncancelreplace={() => documentController.cancelReplace()}
			close={() => documentController.closeOverlay()}
		/>
	</Portal>
{:else if documentController.overlay?.kind === 'saveChanges'}
	<!-- NSDocument's close alert, in its words (AppKit Document.loctable); Save… when it leads to Save As -->
	<Portal>
		<Alert
			testid="save-changes"
			title={`Do you want to save the changes made to the document “${documentController.overlay.documentName}”?`}
			message="Your changes will be lost if you don’t save them."
			buttons={[
				{
					label: 'Don’t Save',
					testid: 'save-changes-dont-save',
					onclick: () => documentController.discardChanges()
				},
				{
					label: 'Cancel',
					testid: 'save-changes-cancel',
					onclick: () => documentController.closeOverlay()
				},
				{
					label: documentController.overlay.untitled ? 'Save…' : 'Save',
					testid: 'save-changes-save',
					onclick: () => documentController.saveChanges(),
					primary: true
				}
			]}
			ondefault={() => documentController.saveChanges()}
			oncancel={() => documentController.closeOverlay()}
		/>
	</Portal>
{:else if documentController.overlay?.kind === 'revert'}
	<!-- NSDocument's revert alert, in its words (AppKit Document.loctable) -->
	<Portal>
		<Alert
			testid="revert"
			title={`Do you want to revert to the most recently saved version of the document “${documentController.overlay.documentName}”?`}
			message="Your current changes will be lost."
			buttons={[
				{
					label: 'Cancel',
					testid: 'revert-cancel',
					onclick: () => documentController.closeOverlay()
				},
				{
					label: 'Revert',
					testid: 'revert-revert',
					onclick: () => documentController.revertConfirmed(),
					primary: true
				}
			]}
			ondefault={() => documentController.revertConfirmed()}
			oncancel={() => documentController.closeOverlay()}
		/>
	</Portal>
{:else if documentController.overlay?.kind === 'openRecent'}
	<Portal>
		<OpenRecentDialog
			paths={documentController.overlay.paths}
			onopen={(path) => documentController.openRecentFile(path)}
			onclear={() => documentController.clearRecentFiles()}
			close={() => documentController.closeOverlay()}
		/>
	</Portal>
{:else if documentController.overlay?.kind === 'openFailed'}
	<!--
	  NSDocumentController's alert, in its words (AppKit Document.loctable and Common.loctable's OK, Foundation
	  FoundationErrors.loctable)
	-->

	<Portal>
		<Alert
			testid="open-failed"
			title={documentController.overlay.title}
			message={documentController.overlay.message}
			buttons={[
				{
					label: 'OK',
					testid: 'open-failed-ok',
					onclick: () => documentController.closeOverlay(),
					primary: true
				}
			]}
			ondefault={() => documentController.closeOverlay()}
			oncancel={() => documentController.closeOverlay()}
		/>
	</Portal>
{:else if documentController.overlay?.kind === 'saveFailed'}
	<!--
	  NSDocument's alert for File > Save's error, as editmd presents it (Document.swift:171-176): AppKit
	  Document.loctable's "could not be saved", Foundation FoundationErrors.loctable's reason, and Common.loctable's OK
	-->
	<Portal>
		<Alert
			testid="save-failed"
			title={documentController.overlay.title}
			message={documentController.overlay.message}
			buttons={[
				{
					label: 'OK',
					testid: 'save-failed-ok',
					onclick: () => documentController.closeOverlay(),
					primary: true
				}
			]}
			ondefault={() => documentController.closeOverlay()}
			oncancel={() => documentController.closeOverlay()}
		/>
	</Portal>
{:else if documentController.overlay?.kind === 'saveLocked'}
	<!--
	  NSDocument's question for a locked file (editmd measured: the edit is written, the mode stays 444): Cancel is the
	  default, so Return and Escape both cancel; Save Anyway writes the file all the same
	-->
	<Portal>
		<Alert
			testid="save-locked"
			title={`The document “${documentController.overlay.documentName}” could not be saved. The file is locked.`}
			message="Do you want to save your changes to it anyway?"
			buttons={[
				{
					label: 'Cancel',
					testid: 'save-locked-cancel',
					onclick: () => documentController.closeOverlay(),
					primary: true
				},
				{
					label: 'Save Anyway',
					testid: 'save-locked-anyway',
					onclick: () => documentController.saveAnyway()
				}
			]}
			ondefault={() => documentController.closeOverlay()}
			oncancel={() => documentController.closeOverlay()}
		/>
	</Portal>
{:else if documentController.overlay?.kind === 'saveNotice'}
	<!-- editmd's notice sheet (EditorWindowController `showNotice`): an NSAlert with only AppKit's default OK -->
	<Portal>
		<Alert
			testid="save-notice"
			title="Saved in a Different Encoding"
			message={documentController.overlay.message}
			buttons={[
				{
					label: 'OK',
					testid: 'save-notice-ok',
					onclick: () => documentController.closeOverlay(),
					primary: true
				}
			]}
			ondefault={() => documentController.closeOverlay()}
			oncancel={() => documentController.closeOverlay()}
		/>
	</Portal>
{:else if documentController.overlay?.kind === 'addLink'}
	<!-- editmd focuses the page again after the sheet (`bridge.focus()`); Add remounts the field, which takes focus -->
	<Portal>
		<AddLinkDialog
			url={documentController.overlay.url}
			onadd={(url) => documentController.addLink(url)}
			close={() => {
				documentController.closeOverlay()
				if (editorNode) focus_element(editorNode)
			}}
		/>
	</Portal>
{:else if documentController.overlay?.kind === 'commandPalette'}
	<Portal>
		<CommandPalette
			entries={documentController.paletteEntries}
			onrun={(command) => documentController.runPaletteEntry(command)}
			close={() => documentController.closeOverlay()}
		/>
	</Portal>
{/if}

<style>
	/* editmd's `#editor { margin: 0 auto }`: the column centred in the window */
	.page {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 100%;
	}
	/* editmd's `#editor { max-width: 46rem; padding: 3rem 2.5rem 40vh }`; the bottom comes from `pageBottom` */
	.document {
		display: flex;
		flex-direction: column;
		padding-top: var(--size-page-padding-top);
		padding-left: var(--size-page-padding-x);
		padding-right: var(--size-page-padding-x);
		width: 100%;
		max-width: var(--size-page-measure);
	}
	/* the Blocks touch: the space between two is the margin `spaceAbove` picks, one `space-*` class below */
	.blocks {
		display: flex;
		flex-direction: column;
		width: 100%;
	}
	.block {
		width: 100%;
	}
	/* a changed run's underline over its text, out of the flow; its box and colour come from `runUnderlines` */
	.run-underline {
		position: absolute;
		pointer-events: none;
	}
	/* out of the flow, where the first Block's text starts, so the field mounted over it keeps its own place */
	.field-hint {
		position: absolute;
		top: var(--size-page-padding-top);
		left: var(--size-page-padding-x);
		right: var(--size-page-padding-x);
		pointer-events: none;
	}
	/* a 0×0 point at the Block's bottom-left corner, out of its flow, that its tooltip hangs from */
	.block-tip {
		position: absolute;
		left: 0;
		bottom: 0;
		width: 0;
		height: 0;
	}
	.space-block-bottom {
		margin-top: var(--size-block-bottom);
	}
	.space-heading-1-top {
		margin-top: var(--size-heading-1-top);
	}
	.space-heading-1-bottom {
		margin-top: var(--size-heading-1-bottom);
	}
	.space-heading-2-top {
		margin-top: var(--size-heading-2-top);
	}
	.space-heading-2-bottom {
		margin-top: var(--size-heading-2-bottom);
	}
	.space-heading-3-top {
		margin-top: var(--size-heading-3-top);
	}
	.space-heading-3-bottom {
		margin-top: var(--size-heading-3-bottom);
	}
	.space-heading-4-top {
		margin-top: var(--size-heading-4-top);
	}
	.space-heading-4-bottom {
		margin-top: var(--size-heading-4-bottom);
	}
	.space-heading-5-top {
		margin-top: var(--size-heading-5-top);
	}
	.space-heading-5-bottom {
		margin-top: var(--size-heading-5-bottom);
	}
	.space-heading-6-top {
		margin-top: var(--size-heading-6-top);
	}
	.space-heading-6-bottom {
		margin-top: var(--size-heading-6-bottom);
	}
	.space-rule-margin {
		margin-top: var(--size-rule-margin);
	}
	.space-frontmatter-bottom {
		margin-top: var(--size-frontmatter-bottom);
	}
	/*
	 * editmd's box-shadows (style.css:474-479) as the box itself: it starts 8px left of the column with an 8px bar, the
	 * tint shadow over the agent one leaving the agent's colour, so its text stays where a plain Block's does; `width:
	 * auto` lets the column stretch it to its right edge
	 */
	.agent {
		width: auto;
		margin-left: var(--size-agent-outset);
		border-left-width: var(--size-agent-rail);
		padding-left: var(--size-agent-inset);
	}
	.agent-0 {
		border-color: var(--agent-0);
		background-color: var(--agent-0-tint);
	}
	.agent-1 {
		border-color: var(--agent-1);
		background-color: var(--agent-1-tint);
	}
	.agent-2 {
		border-color: var(--agent-2);
		background-color: var(--agent-2-tint);
	}
	.agent-3 {
		border-color: var(--agent-3);
		background-color: var(--agent-3-tint);
	}
	.agent-4 {
		border-color: var(--agent-4);
		background-color: var(--agent-4-tint);
	}
	.agent-5 {
		border-color: var(--agent-5);
		background-color: var(--agent-5-tint);
	}
	/* Outside edit, editmd's UNKNOWN agent */
	.agent-unknown {
		border-color: var(--agent-unknown);
		background-color: var(--agent-unknown-tint);
	}
	/* the Deletion lines at one place, each `margin: 0.2rem 0` apart, collapsed */
	.deletions {
		display: flex;
		flex-direction: column;
		gap: var(--size-deleted-margin);
		width: 100%;
	}
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
	.space-deleted-margin {
		margin-top: var(--size-deleted-margin);
	}
	.agent-0-deleted {
		color: var(--agent-0-deleted);
	}
	.agent-1-deleted {
		color: var(--agent-1-deleted);
	}
	.agent-2-deleted {
		color: var(--agent-2-deleted);
	}
	.agent-3-deleted {
		color: var(--agent-3-deleted);
	}
	.agent-4-deleted {
		color: var(--agent-4-deleted);
	}
	.agent-5-deleted {
		color: var(--agent-5-deleted);
	}
	.agent-unknown-deleted {
		color: var(--agent-unknown-deleted);
	}
	.editor {
		width: 100%;
	}
	/* an open h1's or h2's rule, as MarkdownBlock draws it: its padding, then a 1px line in the border colour */
	.field-rule {
		width: 100%;
		border-bottom-width: 1px;
		border-color: var(--border);
	}
	.field-rule-1 {
		padding-bottom: var(--size-heading-1-rule-padding);
	}
	.field-rule-2 {
		padding-bottom: var(--size-heading-2-rule-padding);
	}
	/* editmd's headings are bold, `h1-h6 { font-weight: 600 }`; their size and line height are set inline */
	.heading-field {
		font-weight: 600;
	}
	/*
	 * editmd's `pre` card around an open code or mermaid Block (style.css:193-220): GPUI's <textarea> clips its
	 * own padding into its rows, so the card is a box around the field
	 */
	.code-card {
		width: 100%;
		padding-top: var(--size-code-padding-y);
		padding-bottom: var(--size-code-padding-y);
		padding-left: var(--size-code-padding-x);
		padding-right: var(--size-code-padding-x);
		border-radius: var(--size-code-radius);
		background-color: var(--surface);
	}
	/* below an open code card, the room CodeBlock keeps below a closed one */
	.diagram-room {
		margin-top: var(--size-code-margin);
		height: var(--size-hidden-diagram);
	}
	/* `pre { font: 13.5px/1.55 var(--font-mono) }`; a <textarea> takes its font from its style, not its theme */
	.code-field {
		width: 100%;
		font-family: Menlo;
		font-size: var(--size-code-text);
		line-height: var(--size-code-line-height);
	}
	/* the open card's `pre[data-language]::before { font: 11px; right: 0.6rem; color: var(--faint) }`, `top` inline */
	.code-label {
		position: absolute;
		right: var(--size-code-label-right);
		font-size: var(--size-code-label);
		color: var(--faint);
	}
	/*
	 * editmd's `.frontmatter { padding: 0.75rem 1rem; background: var(--surface); border-radius: 8px }` around the open
	 * field, with `.frontmatter:focus { box-shadow: 0 0 0 2px var(--selection) }`: @gpuix/native 0.10's style has no
	 * shadow or outline, so the ring is a 2px border inside the box, taken off its padding, so the text stays put
	 */
	.frontmatter-card {
		width: 100%;
		padding-top: var(--size-frontmatter-focus-padding-y);
		padding-bottom: var(--size-frontmatter-focus-padding-y);
		padding-left: var(--size-frontmatter-focus-padding-x);
		padding-right: var(--size-frontmatter-focus-padding-x);
		border-width: var(--size-frontmatter-focus-ring);
		border-color: var(--selection);
		border-radius: var(--size-frontmatter-radius);
		background-color: var(--surface);
	}
	/* `font: 12.5px/1.55 var(--font-mono); color: var(--muted)`: a <textarea> paints its text in its style's colour */
	.frontmatter-field {
		width: 100%;
		color: var(--muted);
		font-family: Menlo;
		font-size: var(--size-frontmatter-text);
		line-height: var(--size-frontmatter-line-height);
	}
	/* editmd's `.source { font: 14px/1.6 var(--font-mono) }` (style.css:88-103); its height comes from its rows */
	.source {
		width: 100%;
		font-family: Menlo;
		font-size: var(--size-source-text);
		line-height: var(--size-source-line-height);
	}
</style>
