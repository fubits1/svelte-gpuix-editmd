<!--
  @component
  The open Document as rendered Blocks, one native <markdown> each; the Active block shows its source in a text field.
  In Source mode the whole Document shows as one text field instead. An open field takes the keys when it mounts,
  unless `autofocus` is false.
-->
<script lang="ts">
	import {
		focus_element,
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
	import { onDestroy, untrack } from 'svelte'
	import { SvelteMap } from 'svelte/reactivity'
	import { spaceAbove, spaceAroundDeletions } from '../app/blockSpacing.ts'
	import { takeKeys } from '../app/fieldKeys.ts'
	import { findController, paintedWashes } from '../app/find.svelte.ts'
	import type { Match } from '../app/findMatches.ts'
	import { commandFor } from '../app/shortcuts.ts'
	import { headingThemeFor, mutedThemeFor, NO_FILL, plainFieldThemeFor } from '../app/palette.ts'
	import { provideCommandHeld, useTheme } from '../app/theme.svelte.ts'
	import { CODE_BORDER_RADIUS, codeBorderBox } from '../app/codeBorders.ts'
	import { type ChangedRun, codeRunsOf, linkRunsOf } from '../core/changedText.ts'
	import { type Deletion, deletionSlot } from '../core/document.ts'
	import type { Row } from '../core/dropTarget.ts'
	import type { Block } from '../engine/blocks.ts'
	import AgentLegend from './DocumentView/AgentLegend.svelte'
	import Content from './DocumentView/Content.svelte'
	import DeletedLine from './DocumentView/DeletedLine.svelte'
	import GapLines from './DocumentView/GapLines.svelte'
	import { provideRowTracker } from './DocumentView/NestedBlocks.svelte'
	import { CODE_LABEL_TOP, NO_FIND, PREVIEW_GAP } from './DocumentView/DocumentView.model.ts'
	import { documentController, type RevealPlace } from './DocumentView/controller.svelte.ts'
	import { dropFiles } from './DocumentView/fileDrop.ts'
	import AddLinkDialog from './DocumentView/Overlays/AddLinkDialog.svelte'
	import Alert from './DocumentView/Overlays/Alert.svelte'
	import CommandPalette from './DocumentView/Overlays/CommandPalette.svelte'
	import OpenRecentDialog from './DocumentView/Overlays/OpenRecentDialog.svelte'
	import SaveAsDialog from './DocumentView/Overlays/SaveAsDialog.svelte'
	import MermaidBlock from './DocumentView/Views/MermaidBlock.svelte'
	import PointerTip from './PointerTip.svelte'
	import { boxOf, scrollingAncestorOf, trackIn } from './nodes.ts'

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
	 * room added below the page so a followed link's target near the end still reaches the window's top, as editmd's
	 * `scrollIntoView` puts its heading there (editmd's screenshot), where the page's own end would stop the scroll
	 * short; 0 until a link needs it, and back to 0 with each Document (the room is kept with the Document it was
	 * made for)
	 */
	let reveal = $state({ generation: -1, room: 0 })
	const revealRoom = $derived(
		reveal.generation === documentController.documentGeneration ? reveal.room : 0
	)

	/**
	 * editmd's `#editor` ends in `padding-bottom: 40vh`, so the last Block can scroll up to the top part of the
	 * window: 40% of the window's height, a share of the viewport that page zoom leaves alone. Source mode's field
	 * keeps it too, as it sits in the same `#editor` (style.css:64-69)
	 */
	const pageBottom = $derived(`${Math.round((window_size.height * 0.4 + revealRoom) * 10) / 10}px`)

	/**
	 * a field's row cap, past any document's line count: editmd shows a Block whole while it is edited and grows Source
	 * mode's field to its whole text (`field-sizing: content`), so neither scrolls inside itself; the page scrolls them
	 */
	const WHOLE_TEXT_ROWS = 1_000_000

	/** `.source { min-height: 70vh }` (style.css:90-103): gpuix has no `vh`, so 70% of the window's height in px */
	const sourceMinHeight = $derived(`${Math.round(window_size.height * 7) / 10}px`)

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
			 * Document while one shows, and the dialog's own listener keeps Return and Escape; an open menu closes
			 * and lets the key run, as AppKit's menus do
			 */
			// null for ordinary typing, which stays with the focused field
			const command = commandFor(event.key, event.modifiers)
			const { cmd, ctrl, alt, shift } = event.modifiers
			if (command) documentController.runShortcut(command, { editing: event.editing })
			// a character no field took: a field opening at editmd's caret takes it once it has the keys
			else if (
				!event.editing &&
				!cmd &&
				!ctrl &&
				!alt &&
				(event.key.length === 1 || event.key === 'space')
			)
				documentController.typeWithoutField(shift ? `shift-${event.key}` : event.key)
		})
	)

	/**
	 * ⌘ is held, so a link shows the pointer (`handOver`), as editmd's `cmd-down` body class turns a link's text
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
	 * field, keyed as the Block typing makes, so the field stays mounted when that Block arrives. a new Block's empty
	 * field (`activeIsNew`) holds an empty paragraph the same way, at `activeIndex`, before the Block that has that
	 * index, so the Blocks from there on paint one place later than their index (`blockIndexAt`)
	 */
	const paintedBlocks = $derived.by(() => {
		const { blocks, activeIndex, activeIsNew } = documentController
		if (blocks.length === 0 && activeIndex === 0) return [FIRST_BLOCK]
		if (!activeIsNew || activeIndex === null) return blocks
		const at = blocks[activeIndex - 1]?.end ?? 0
		return blocks.toSpliced(activeIndex, 0, { kind: 'paragraph', start: at, end: at })
	})

	/** the index in the Document's Blocks of what paints at `place`: past a new Block's field, the place before */
	const blockIndexAt = (place: number) =>
		documentController.activeIsNew &&
		documentController.activeIndex !== null &&
		place > documentController.activeIndex
			? place - 1
			: place

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

	/**
	 * the rows of the Blocks inside quotes and lists by the Document offset each Block starts at, for scrolling a followed
	 * link's heading among them (NestedBlocks reports them); nothing renders from it
	 */
	const rowNodes = new SvelteMap<number, ShadowNode>()

	const trackBlock = trackIn(blockNodes)
	provideRowTracker(trackIn(rowNodes))

	/**
	 * scroll the nearest scrolling ancestor (App's Scroller) so `node`'s top meets its top, as a browser's
	 * scrollIntoView does, and `smooth`ly as its `behavior: "smooth"` (`animateScroll`). GPUI clamps the offset at the
	 * page's end, so for a Block near the end the room the scroll lacks, measured from the painted page before it starts,
	 * goes below the page first (`revealRoom`): the taller page paints with the scroll's first step. GPUI's own
	 * `scroll_into_view` left the Block where it was (measured headlessly, with the Block three levels below the
	 * Scroller's column), so the offset is set on the first ancestor that reports one
	 */
	function scrollToTop(node: ShadowNode, top?: number, smooth = false): void {
		const scrolling = scrollingAncestorOf(node)
		if (!scrolling) return
		const { native, id, offset, viewport, target, content } = scrolling
		const [x = 0, from = 0] = offset
		const distance = (top ?? target.y) - viewport.y
		const lacking = distance - (content.y + content.height - (viewport.y + viewport.height))
		if (lacking > 0) {
			reveal = { generation: documentController.documentGeneration, room: revealRoom + lacking }
		}
		if (smooth) animateScroll(native, id, x, from, from - distance)
		else scrollPage(native, id, x, from - distance)
	}

	/** GPUI's native handle, once the window is up */
	type Native = NonNullable<ReturnType<typeof get_native>>

	/**
	 * sets the scroller `id`'s offset and tells the theme the page scrolled: macOS shows an overlay scroller's thumb
	 * during any scroll, and App hears only a wheel's (`onscroll`)
	 */
	function scrollPage(native: Native, id: number, x: number, y: number): void {
		native.scrollTo(id, x, y)
		theme().pageScrolled()
	}

	/**
	 * scroll the nearest scrolling ancestor so `node`'s top meets the middle of what it shows, as editmd's `reveal`
	 * scrolls a change's top to the window's middle (highlights.ts:131-142: `coordsAtPos(at).top` by
	 * `top - window.innerHeight / 2`), smoothly as its `behavior: "smooth"`: a step a frame over SMOOTH_SCROLL_MS, easing
	 * in and out, a new reveal taking over from where the last one got to. a Block near the top stops the page at its top,
	 * offsets running negative as the page scrolls down; GPUI clamps one past the end, as for `scrollToTop`. `top`, in
	 * window coordinates, puts a point inside the node there instead of its top (a changed run's)
	 */
	function scrollToMiddle(node: ShadowNode, top?: number): void {
		const scrolling = scrollingAncestorOf(node)
		if (!scrolling) return
		const { native, id, offset, viewport, target } = scrolling
		const [x = 0, from = 0] = offset
		const shownMiddle = viewport.y + viewport.height / 2
		animateScroll(native, id, x, from, Math.min(0, from - ((top ?? target.y) - shownMiddle)))
	}

	/**
	 * a browser's smooth scroll from offset `from` to `to` of the scroller `id`: a step a frame over SMOOTH_SCROLL_MS,
	 * easing in and out, a new one taking over from where the last one got to
	 */
	function animateScroll(native: Native, id: number, x: number, from: number, to: number): void {
		clearTimeout(smoothScroll)
		const started = Date.now()
		const step = () => {
			const progress = Math.min(1, (Date.now() - started) / SMOOTH_SCROLL_MS)
			const eased = (1 - Math.cos(Math.PI * progress)) / 2
			scrollPage(native, id, x, from + (to - from) * eased)
			if (progress < 1) smoothScroll = setTimeout(step, FRAME_MS)
		}
		smoothScroll = setTimeout(step, FRAME_MS)
	}

	/** how long a smooth scroll takes, about a browser's smooth `scrollIntoView` */
	const SMOOTH_SCROLL_MS = 300
	/** one step of that scroll, a frame at 60Hz */
	const FRAME_MS = 16
	/** the smooth scroll's next step, cleared by the next one and when the view goes */
	let smoothScroll: ReturnType<typeof setTimeout> | undefined

	/**
	 * scrolls Block `index` to the top, smoothly, as a followed link does, or to the middle, as an Agent's revealed
	 * change. a link to a heading inside the Block, `inside` its Document offset, puts that heading's own row at the top,
	 * as editmd's `scrollIntoView` takes the heading itself (main.ts:39-41); a revealed change of `inside`, a changed run,
	 * puts that run's painted top in the middle, as editmd's `reveal` scrolls to the change's own position (`coordsAtPos`,
	 * highlights.ts:133-141), however deep in a tall Block it is
	 */
	function revealBlock(index: number, place: RevealPlace, inside?: ChangedRun | number): void {
		const node = blockNodes.get(index)
		if (!node) return
		if (typeof inside === 'number') scrollToTop(rowNodes.get(inside) ?? node, undefined, true)
		else if (place === 'top') scrollToTop(node, undefined, true)
		else scrollToMiddle(node, inside === undefined ? undefined : runRectIn(node, inside)?.y)
	}

	/** one `highlight` wash the last frame painted, as native reports it */
	type PaintedWash = ReturnType<typeof paintedWashes>[number]

	/** the first painted box of the changed run `run` washed inside `node`, null when none paints */
	function runRectIn(node: ShadowNode, run: ChangedRun) {
		const painted = washedRunsIn(node, paintedWashes()).find(
			({ text, occurrence }) => text === run.text && occurrence === run.index
		)
		return painted?.wash.rects[0] ?? null
	}

	/**
	 * the runs washed active inside `node`, each with which occurrence of its text in the Block it is: native numbers a
	 * spec's matches in paint order, and every run's spec washes every occurrence of its text, so each place counts once
	 */
	function washedRunsIn(node: ShadowNode, washes: readonly PaintedWash[]) {
		const inside = washes.filter((wash) => holds(node, wash.elementId))
		const placeOf = (wash: PaintedWash) => `${wash.elementId}:${wash.sub}:${wash.start}`
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to one measurement
		const places = new Map<string, string[]>()
		for (const wash of inside) {
			const text = wash.text.slice(wash.start, wash.end)
			const seen = places.get(text) ?? []
			if (!seen.includes(placeOf(wash))) places.set(text, [...seen, placeOf(wash)])
		}
		return inside
			.filter((wash) => wash.active)
			.map((wash) => {
				const text = wash.text.slice(wash.start, wash.end)
				return { text, occurrence: (places.get(text) ?? []).indexOf(placeOf(wash)), wash }
			})
	}

	/** a changed run's underline, editmd's inset 2px shadow, and how often the runs' painted boxes are read */
	const UNDERLINE_PX = 2
	const RUN_POLL_MS = 100

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

	/** the space class of a margin token, null for none */
	const spaceClassOf = (margin: string | null) => margin && `space-${margin}`

	onDestroy(() => clearTimeout(smoothScroll))

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
		return node?.nativeId != null && takeKeys(node)
	}

	$effect(() => documentController.onFocusField(focusField))

	/** an alert was up at the last look; nothing renders from it */
	let alertUp = false

	/**
	 * an alert takes the keys from an open field (its default button is the key view), as editmd's sheets take them
	 * from its page; the field gets them back once it goes, as editmd's page does
	 */
	$effect(() => {
		const up = documentController.alert !== null
		if (!up && alertUp) untrack(() => focusField(documentController.fieldRevision))
		alertUp = up
	})

	/**
	 * every Block's painted top and height, in order, for placing a drop. a Block's own node counts while it is
	 * painted, and the Active block's field in its place. a Block not painted yet sorts after every drop, so it
	 * never takes one
	 */
	function blockRows(): Row[] {
		return documentController.blocks.map((_block, index) => {
			const box = boxOf(
				blockNodes.get(index) ?? (index === documentController.activeIndex ? activeField : null)
			)
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

	/**
	 * the box the open field of an h1 or h2, a list, a quote or a rule sits in, so it keeps the closed Block's look, as
	 * editmd edits each in place: the heading's rule below its text, the list's item indent (`ul { padding-left: 1.75em
	 * }`), the quote's rail, padding and muted text (`blockquote`) and the rule's line below it (`hr { border-top: 1px
	 * }`, style.css:222-233, 274-279); null for a field with no box
	 */
	const fieldBox = $derived.by(() => {
		const { textTheme } = theme()
		if (headingFont?.rule)
			return {
				look: `field-rule field-rule-${headingFont.rule}`,
				testid: 'block-editor-rule',
				theme: textTheme
			}
		const kind = documentController.activeKind
		if (kind === 'list')
			return { look: 'field-list', testid: 'block-editor-list', theme: textTheme }
		if (kind === 'blockquote')
			return { look: 'field-quote', testid: 'block-editor-quote', theme: mutedThemeFor(textTheme) }
		if (kind === 'thematicBreak')
			return { look: 'field-rule', testid: 'block-editor-hr', theme: textTheme }
		return null
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
		const wash = paintedWashes().find(
			(each) => each.elementId === elementId && each.start === start
		)
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
	 * each Block holding a link with its links as runs of its painted text (`linkRunsOf`), by index and then by `runKey`:
	 * what ⌘ turns the pointer to a hand over. the render source carries the definitions a reference link needs to parse
	 * as one. none in Source mode, where no Block paints
	 */
	const linkRuns = $derived.by(() => {
		const byBlock = new SvelteMap<number, SvelteMap<string, ChangedRun & { title?: string }>>()
		if (documentController.sourceMode) return byBlock
		documentController.blocks.forEach((block, index) => {
			if (!block.links) return
			const runs = linkRunsOf(documentController.renderSourceOf(block))
			if (runs.length > 0)
				byBlock.set(index, new SvelteMap(runs.map((run) => [runKey(run.text, run.index), run])))
		})
		return byBlock
	})

	/**
	 * each Block holding an inline code span with its spans as runs of its painted text (`codeRunsOf`), by index: what
	 * editmd draws its border around. a code or mermaid Block, or one whose text has no backtick, holds none, so it is
	 * never parsed for them; none in Source mode either
	 */
	const codeRuns = $derived.by(() => {
		const byBlock = new SvelteMap<number, ChangedRun[]>()
		if (documentController.sourceMode) return byBlock
		documentController.blocks.forEach((block, index) => {
			const source = documentController.sliceOf(block)
			if (block.kind === 'code' || block.kind === 'mermaid' || !source.includes('`')) return
			// its own text, where the render source writes an empty link and inline HTML as code
			const runs = codeRunsOf(source)
			if (runs.length > 0) byBlock.set(index, runs)
		})
		return byBlock
	})

	/** each Block's changed runs (`changedRunsOf`) by index, which its washes and its run marks both read */
	const changedRuns = $derived(
		documentController.blocks.map((block) => documentController.changedRunsOf(block))
	)

	/** a wash over exactly the `run.index`th occurrence of `run.text` in `colour`, the other occurrences transparent */
	const washOf = (run: ChangedRun, colour: string | undefined): HighlightSpec => ({
		query: run.text,
		caseSensitive: true,
		color: NO_FILL,
		activeColor: colour,
		activeIndex: run.index
	})

	/**
	 * the Blocks that wash runs of their own, by index: the runs Agents' changes mark (`changedRunsOf`), each in editmd's
	 * `.agent-change` (style.css:468-472) of its own Agent's colour over exactly that occurrence of the run's text, the
	 * others transparent (measured headless: `activeIndex` washes the nth occurrence only), and the links and code
	 * spans, transparent, so their painted boxes say where a hand shows and where a code border goes. editmd also
	 * underlines a changed run, which a `highlight` cannot draw (HighlightSpec has no underline), so `runUnderlines`
	 * draws it from the washes' painted boxes, as `codeBorders` draws the borders
	 */
	const blockWashes = $derived.by(() => {
		const marked = new SvelteMap<number, HighlightSpec[]>()
		changedRuns.forEach((changed, index) => {
			const specs = [
				...changed.flatMap(({ runs, agentClass }) =>
					runs.map((run) => washOf(run, theme().palette[`${agentClass}-change`]))
				),
				...[...(linkRuns.get(index)?.values() ?? []), ...(codeRuns.get(index) ?? [])].map((run) =>
					washOf(run, NO_FILL)
				)
			]
			if (specs.length > 0) marked.set(index, specs)
		})
		return marked
	})

	/**
	 * the Block whose link the pointer last moved over, null when it moved off every link: while ⌘ is held only a link
	 * shows the hand, as editmd's `body.cmd-down .markdown-body a { cursor: pointer }` (style.css:178-181); transient UI
	 * (ADR-0011)
	 */
	let handOver = $state<number | null>(null)

	/** whether one of `wash`'s painted boxes holds the window point (`x`, `y`) */
	const washHolds = (wash: PaintedWash, x: number, y: number) =>
		wash.rects.some(
			(rect) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height
		)

	/**
	 * the first of `runs`, keyed by `runKey`, that Block `index` washes under the window point (`x`, `y`) in `washes`,
	 * undefined for none
	 */
	function washedRunAt<T>(
		index: number,
		x: number,
		y: number,
		washes: readonly PaintedWash[],
		runs: ReadonlyMap<string, T> | undefined
	): T | undefined {
		const node = blockNodes.get(index)
		if (!node || !runs || !washes.some((wash) => washHolds(wash, x, y))) return undefined
		for (const { text, occurrence, wash } of washedRunsIn(node, washes)) {
			const run = runs.get(runKey(text, occurrence))
			if (run !== undefined && washHolds(wash, x, y)) return run
		}
		return undefined
	}

	/** the Block with a link painted under the window point (`x`, `y`), null for none */
	function linkBlockAt(x: number, y: number): number | null {
		if (linkRuns.size === 0) return null
		const washes = paintedWashes()
		for (const [index, runs] of linkRuns) if (washedRunAt(index, x, y, washes, runs)) return index
		return null
	}

	/**
	 * the tip a painted Block shows: editmd titles a highlight "<name>, <time>", anywhere over a Block marked whole and
	 * only over the runs of one marked by its changed runs, each `.agent-change` run titled with its own Agent's line
	 * (highlights.ts:184-186), and a titled link with its title over that link (links.ts:174), the innermost title as a
	 * browser shows it
	 */
	function blockTipOf(index: number, agentClass: string | null, tooltip: string | null) {
		const marks = agentClass === null ? runMarks.get(index) : undefined
		const links = linkRuns.get(index)
		if (!marks && !links?.values().some((run) => run.title)) return tooltip
		return (x: number, y: number) => {
			const washes = paintedWashes()
			const title = washedRunAt(index, x, y, washes, links)?.title
			if (!marks) return title ?? tooltip
			return title ?? washedRunAt(index, x, y, washes, marks)?.tooltip ?? null
		}
	}

	/** a move of the pointer over the page: whether ⌘ is held with it, and which link it is on */
	function pointerMoved(event: GpuixEvent): void {
		cmdHeld = event.modifiers?.cmd === true
		handOver = linkBlockAt(event.x ?? -1, event.y ?? -1)
	}

	/** the key of the `occurrence`th run of `text` in its Block, which one Agent's change marks */
	const runKey = (text: string, occurrence: number) => `${text}\u0000${occurrence}`

	/** a changed run's mark: the colour that underlines it, its Agent's at 70%, and its Agent's tooltip line */
	type RunMark = { colour: string; tooltip: string }

	/**
	 * each run-marked Block's runs, by index, each with its mark. a run is keyed by its text and which occurrence of that text it is
	 * (`runKey`), so two Agents who wrote the same word in one Block each underline and title their own
	 */
	const runMarks = $derived.by(() => {
		const byBlock = new SvelteMap<number, SvelteMap<string, RunMark>>()
		changedRuns.forEach((changed, index) => {
			const marks = new SvelteMap<string, RunMark>()
			for (const { runs, agentClass, tooltip } of changed)
				for (const run of runs)
					marks.set(runKey(run.text, run.index), {
						colour: theme().palette[`${agentClass}-deleted`] ?? '',
						tooltip
					})
			if (marks.size > 0) byBlock.set(index, marks)
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

	/**
	 * one row of a code span's border: its box in logical px from its Block's box (`codeBorderBox`), and whether it is the
	 * span's first and last row, as editmd's inline border is sliced where the span wraps: only the first row has the
	 * left side and corners, only the last the right ones
	 */
	type CodeBorder = {
		key: string
		index: number
		x: number
		y: number
		width: number
		height: number
		first: boolean
		last: boolean
	}

	/** the code spans' borders as last measured, read back from the paint as the underlines are; transient UI (ADR-0011) */
	let codeBorders = $state.raw<readonly CodeBorder[]>([])

	/** reads where the runs' washes painted, and keeps the underlines and code borders when they moved */
	function measureRuns(): void {
		const washes = paintedWashes()
		const thickness = theme().scaled(UNDERLINE_PX)
		const lines: Underline[] = []
		const borders: CodeBorder[] = []
		for (const index of new Set([...runMarks.keys(), ...codeRuns.keys()])) {
			const node = blockNodes.get(index)
			const box = boxOf(node)
			if (!node || !box) continue
			const marks = runMarks.get(index)
			// each code span takes one wash, though Find's active match can wash the same place again
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to one measurement
			const unbordered = new Set(
				(codeRuns.get(index) ?? []).map((run) => runKey(run.text, run.index))
			)
			for (const { text, occurrence, wash } of washedRunsIn(node, washes)) {
				const colour = marks?.get(runKey(text, occurrence))?.colour
				const code = unbordered.delete(runKey(text, occurrence))
				for (const [row, rect] of wash.rects.entries()) {
					if (colour !== undefined)
						lines.push({
							key: `${index}-${lines.length}`,
							index,
							x: rect.x - box.x,
							y: rect.y + rect.height - thickness - box.y,
							width: rect.width,
							colour
						})
					if (code)
						borders.push({
							key: `${index}-${borders.length}`,
							index,
							...codeBorderBox(rect, box),
							first: row === 0,
							last: row === wash.rects.length - 1
						})
				}
			}
		}
		if (JSON.stringify(lines) !== JSON.stringify(runUnderlines)) runUnderlines = lines
		if (JSON.stringify(borders) !== JSON.stringify(codeBorders)) codeBorders = borders
	}

	/**
	 * gpuix has no paint event, so the runs' boxes are read on a poll while any run is marked or any code span painted,
	 * as Find reads its matches
	 */
	$effect(() => {
		if (runMarks.size === 0 && codeRuns.size === 0) return
		untrack(measureRuns)
		const poll = setInterval(measureRuns, RUN_POLL_MS)
		return () => clearInterval(poll)
	})

	// Find leaves the Blocks' own washes out of its matches, since native lists them with its own
	$effect(() =>
		findController.setForeignTexts(
			[...blockWashes.values()].flatMap((specs) => specs.map(({ query }) => query ?? ''))
		)
	)

	/**
	 * Find's `highlight` with Blocks that wash runs of their own: such a Block declares its own `highlight`, which
	 * replaces the container's in it and which the container's numbering skips (measured headless), so the container's
	 * active index counts only the matches outside them, and each such Block repeats Find's spec from its first match on
	 * (`matchIndexOffset`), the matches read from the paint giving both
	 */
	const findSpecs = $derived.by(() => {
		const spec = findController.highlight(theme().palette)
		const offsets = new SvelteMap<number, number>()
		if (!spec || blockWashes.size === 0) return { outer: spec, inner: spec, offsets }
		let outerActive = -1
		let outerCount = 0
		findController.matches.forEach((match, n) => {
			const owner = blockIndexOf(match.elementId)
			if (owner !== null && blockWashes.has(owner)) {
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

	/** a Block's own `highlight`: Find's, then its own washes, for a Block that washes runs; null for any other */
	function blockHighlight(index: number): HighlightSpec[] | null {
		const washes = blockWashes.get(index)
		if (!washes) return null
		const { inner, offsets } = findSpecs
		return inner ? [{ ...inner, matchIndexOffset: offsets.get(index) ?? 0 }, ...washes] : washes
	}

	$effect(() => findController.onReveal(revealMatch))
	// the matches are read from the paint this view's highlight makes, so the poll lives as long as the view
	$effect(() => findController.start())
</script>

<!-- the Deletion lines above the Block at `slot` (after the last Block when `slot` is their count) -->
{#snippet deletionLines(slot: number, spaceClass: string | null)}
	<div class={['deletions', spaceClass]}>
		{#each deletionsBySlot.get(slot) ?? [] as { deletion, n } (n)}
			<DeletedLine
				colour={documentController.deletionClassOf(deletion)}
				tooltip={documentController.deletionTooltipOf(deletion)}
				testid={`deleted-${n}`}
				tooltipTestid={`deleted-tooltip-${n}`}
			/>
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
		class={[look, spaceClass, font && 'heading-field', agentClass && 'agent']}
		testid="block-editor"
		style:border-color={agentClass && `var(--${agentClass})`}
		style:background-color={agentClass && `var(--${agentClass}-tint)`}
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
		onsubmit={() => documentController.pressReturn()}
		onkeydown={(event) => {
			if (event.key === 'escape') documentController.escapeField()
			else if (
				event.key !== undefined &&
				event.modifiers !== undefined &&
				documentController.tabInField(event.key, event.modifiers)
			)
				event.preventDefault()
		}}
		onkeyup={(event) => {
			if (event.key === 'backspace') documentController.backspaceUp()
		}}></textarea>
{/snippet}

<!-- a file dropped anywhere on the page, its margins included, lands between the Blocks -->
<div class="page" onfiledrop={dropFiles} onmousemove={pointerMoved} role="presentation">
	<div class="document" testid="document" style:padding-bottom={pageBottom}>
		{#if !documentController.sourceMode && paintedBlocks[0] === FIRST_BLOCK}
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
					style:min-height={sourceMinHeight}
					{autofocus}
					value={documentController.activeSource}
					minRows={1}
					maxRows={WHOLE_TEXT_ROWS}
					theme={sourceTextTheme}
					{@attach trackSource}
					onchange={(event) => documentController.typeInActive(event.value)}></textarea>
			{:else}
				<!--
				  the Active block's key follows its Edit session, not its place: a Disk merge that adds or removes a Block
				  above moves it, and a new key would remount the field, losing what it shows and its caret. the others key by
				  place, so typing, which moves every later Block's offsets, updates them in place
				-->
				{#each paintedBlocks as block, place (place === documentController.activeIndex ? 'active' : place)}
					{@const index = blockIndexAt(place)}
					{@const agentClass = documentController.agentClassOf(block)}
					{@const tooltip = documentController.highlightTooltipOf(block)}
					{@const deleted = deletionsBySlot.has(place)}
					<!-- a Deletion line above takes the space above the Block, and the Block keeps the line's own below it -->
					{@const around = spaceAroundDeletions(paintedBlocks[place - 1], block)}
					{@const spaceClass = spaceClassOf(
						deleted ? around.below : spaceAbove(paintedBlocks[place - 1], block)
					)}
					{@const covered = documentController.coveredByField(index)}
					{#if deleted && !covered}
						{@render deletionLines(place, spaceClassOf(around.above))}
					{/if}
					{#if covered}
						<!-- a Block the open field holds after its own (a Format command wrote several) paints only there -->
					{:else if documentController.activeIndex === place}
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
								{#if fieldBox}
									<div
										class={[fieldBox.look, spaceClass]}
										testid={fieldBox.testid}
										{@attach trackField}
									>
										{@render blockField(
											'editor',
											null,
											false,
											fieldBox.theme,
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
								<MermaidBlock {block} {index} testKey={`${index}`} editing />
							</div>
						{/if}
					{:else}
						<!-- a highlight's or a titled link's native tip at the pointer (`blockTipOf`) -->
						<PointerTip
							text={blockTipOf(index, agentClass, tooltip)}
							testid={`block-tooltip-${index}`}
						>
							{#snippet children(pointer)}
								<!--
								  task lists open from their item text, so a checkbox click only ticks. the Block takes a drop
								  as the page does: GPUI would hand a drop on it to its click (measured headless), opening it
								-->
								<div
									class={['block', spaceClass, agentClass !== null && 'agent']}
									testid={`block-${index}`}
									style:border-color={agentClass && `var(--${agentClass})`}
									style:background-color={agentClass && `var(--${agentClass}-tint)`}
									highlight={blockHighlight(index)}
									style:cursor={cmdHeld && handOver === index ? 'pointer' : 'text'}
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
									{...pointer}
									{@attach (node: ShadowNode) => trackBlock(index, node)}
								>
									<Content {block} {index} testKey={`${index}`} />
									<!-- children an Agent took away after a list's or quote's last row -->
									<GapLines place={{ index }} />
									<!-- a measure left from runs since cleared paints nothing: only a run-marked Block draws underlines -->
									{#each runMarks.has(index) ? runUnderlines.filter((line) => line.index === index) : [] as line (line.key)}
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
									<!-- editmd's inline code border over native's pill, which has none; only a Block with code spans draws one -->
									{#each codeRuns.has(index) ? codeBorders.filter((border) => border.index === index) : [] as border (border.key)}
										{@const left = border.first ? theme().scaled(CODE_BORDER_RADIUS) : 0}
										{@const right = border.last ? theme().scaled(CODE_BORDER_RADIUS) : 0}
										<div
											class="code-border"
											testid={`code-border-${border.key}`}
											style:left={`${border.x}px`}
											style:top={`${border.y}px`}
											style:width={`${border.width}px`}
											style:height={`${border.height}px`}
											style:border-left-width={border.first ? null : '0px'}
											style:border-right-width={border.last ? null : '0px'}
											style:border-radius={`${left}px ${right}px ${right}px ${left}px`}
										></div>
									{/each}
								</div>
							{/snippet}
						</PointerTip>
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
				onclick={() => documentController.clickHint()}
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

{#if documentController.alert}
	<!-- each kind of alert mounts its own, so its key button takes the keys -->
	{#key documentController.alert.testid}
		<Portal>
			<Alert {...documentController.alert} />
		</Portal>
	{/key}
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
{:else if documentController.overlay?.kind === 'openRecent'}
	<Portal>
		<OpenRecentDialog
			paths={documentController.overlay.paths}
			onopen={(path) => documentController.openRecentFile(path)}
			onclear={() => documentController.clearRecentFiles()}
			close={() => documentController.closeOverlay()}
		/>
	</Portal>
{:else if documentController.overlay?.kind === 'addLink'}
	<!-- editmd focuses the page again after the sheet (`bridge.focus()`); Add remounts the field, which takes focus -->
	<Portal>
		<AddLinkDialog
			url={documentController.overlay.url}
			edit={documentController.overlay.edit}
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
	/* `border: 1px solid color-mix(in srgb, var(--border) 60%, transparent)` (style.css:189); its box from `codeBorders` */
	.code-border {
		position: absolute;
		pointer-events: none;
		border-width: 1px;
		border-color: var(--code-border);
	}
	/* out of the flow, where the first Block's text starts, so the field mounted over it keeps its own place */
	.field-hint {
		position: absolute;
		top: var(--size-page-padding-top);
		left: var(--size-page-padding-x);
		right: var(--size-page-padding-x);
		pointer-events: none;
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
	/* the Deletion lines at one place, each `margin: 0.2rem 0` apart, collapsed */
	.deletions {
		display: flex;
		flex-direction: column;
		gap: var(--size-deleted-margin);
		width: 100%;
	}
	.space-deleted-margin {
		margin-top: var(--size-deleted-margin);
	}
	.editor {
		width: 100%;
	}
	/* `ul { padding-left: 1.75em }`: an open list's text starts where its items' text does */
	.field-list {
		width: 100%;
		padding-left: var(--size-list-indent);
	}
	/* `blockquote { padding: 0 1em; border-left: 0.25em solid var(--border) }`, its muted text in the field's theme */
	.field-quote {
		width: 100%;
		border-left-width: var(--size-quote-rail);
		border-color: var(--border);
		padding-left: var(--size-quote-padding);
		padding-right: var(--size-quote-padding);
	}
	/*
	 * an open h1's or h2's rule, as MarkdownBlock draws it: its padding, then a 1px line in the border colour; an open
	 * rule's `hr { border-top: 1px solid var(--border) }` below its text
	 */
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
	/* editmd's headings are bold, `h1-h6 { font-weight: 650 }` (style.css:147); their size and line height are set inline */
	.heading-field {
		font-weight: 650;
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
	 * field, with `.frontmatter:focus { box-shadow: 0 0 0 2px var(--selection) }` (style.css:73-86): an outline outside
	 * the box takes no room, so the box keeps its closed size and its text stays put
	 */
	.frontmatter-card {
		width: 100%;
		padding-top: var(--size-frontmatter-padding-y);
		padding-bottom: var(--size-frontmatter-padding-y);
		padding-left: var(--size-frontmatter-padding-x);
		padding-right: var(--size-frontmatter-padding-x);
		outline-width: var(--size-frontmatter-focus-ring);
		outline-color: var(--selection);
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
	/* editmd's `.source { font: 14px/1.6 var(--font-mono) }` (style.css:90-103); its min height is set inline */
	.source {
		width: 100%;
		font-family: Menlo;
		font-size: var(--size-source-text);
		line-height: var(--size-source-line-height);
	}
</style>
