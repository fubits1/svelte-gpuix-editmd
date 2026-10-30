import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
	activate_window,
	get_native,
	minimize_window,
	prompt_for_paths,
	set_window_title,
	toggle_fullscreen,
	zoom_window
} from 'gpuix-svelte'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'
import { AgentLegend, type LegendAgent } from '../../app/agentLegend.ts'
import { type FormatCommand, isFormatCommand } from '../../app/commands.ts'
import { sortDrop } from '../../app/drop.ts'
import { findController } from '../../app/find.svelte.ts'
import { deletionTooltip, highlightTooltip, type TimeFormat } from '../../app/highlightTooltip.ts'
import {
	type BarCommand,
	type FieldCommand,
	type MenuCommand,
	menuBar,
	menuEntries
} from '../../app/menu.ts'
import { type OpenFailure, openFailure } from '../../app/openFailure.ts'
import { saveFailure } from '../../app/saveFailure.ts'
import type { Modifiers } from '../../app/shortcuts.ts'
import { LEGEND_STORE, RECENT_STORE } from '../../app/supportFolder.ts'
import { themeController } from '../../app/theme.svelte.ts'
import type { AgentProcess } from '../../core/agentEdits.ts'
import { HORIZONTAL_RULE, TABLE, underLastItem } from '../../core/blockCommands.ts'
import { type ChangedRun, runOffset } from '../../core/changedText.ts'
import { type FenceParts, fenceParts, withFences } from '../../core/codeField.ts'
import { copiedText } from '../../core/copiedText.ts'
import {
	type Deletion,
	Document,
	type EditSession,
	type Highlight,
	caretPastInsertions,
	caretThrough
} from '../../core/document.ts'
import { insertAfterIndexAt, type Row } from '../../core/dropTarget.ts'
import {
	applyKeys,
	caretKeys,
	type InlineFormat,
	lineEndsOf,
	type Range,
	selectionCandidates,
	selectKeys,
	settleSelection,
	takesMarks,
	toggleInlineKeys
} from '../../core/fieldSelection.ts'
import { paintedSlice } from '../../core/paintedSlice.ts'
import { imageSize, type Size } from '../../core/imageSize.ts'
import { linkDestination } from '../../core/linkDestination.ts'
import { firstTextOffset, formatBlock } from '../../core/formatBlock.ts'
import { caretAfterTyping, INPUT_RULE_KINDS, inputRuleKind } from '../../core/inputRules.ts'
import { linkAtSelection } from '../../core/linkInsert.ts'
import { mergeText, textEdits } from '../../core/merge.ts'
import { linkAction, type LinkTarget } from '../../core/linkPolicy.ts'
import { labelDetail, labelText, type SaveLabel } from '../../core/persistence.ts'
import { type ReturnEdit, returnEdit } from '../../core/returnKey.ts'
import { saveAsPath } from '../../core/saveAsPath.ts'
import { pressTab, type TabEffects, tabAction, tableCellStep } from '../../core/tabKey.ts'
import { type Block, type BlockKind, blockKindOf } from '../../engine/blocks.ts'
import { SOCKETS_DIRECTORY } from '../../app/reportEdit.ts'
import {
	bringAllToFront,
	focusWindowFor,
	greetPeers,
	listenForReports,
	sendRename
} from '../../host/agentIpc.ts'
import { listAgentProcesses } from '../../host/agentProcesses.ts'
import { Attribution } from '../../host/attribution.ts'
import { readClipboardUrl, writeClipboard } from '../../host/clipboard.ts'
import { createClockScheduler } from '../../host/clock.ts'
import { DocumentFile } from '../../host/documentFile.ts'
import { describeFile, isImageName, isTextName } from '../../host/fileKinds.ts'
import { FileExistsError, FileLockedError, openTextFile, realPathOf } from '../../host/files.ts'
import { fetchImageHead } from '../../host/imageFetch.ts'
import { ImageSizes } from '../../host/imageSizes.ts'
import { LegendPreference } from '../../host/legendPreference.ts'
import { carryOutLink, type Run, runDetached } from '../../host/openLink.ts'
import { writePrintablePage } from '../../host/print.ts'
import { RecentFiles } from '../../host/recent.ts'
import { type UntitledNumbers, untitledName } from '../../host/untitledNumbers.ts'
import { watchFile } from '../../host/watch.ts'
import { openWindow, type Spawn } from '../../host/windows.ts'

export type RunOptions = {
	/** a text field has focus and gets the same key (`GpuixEvent.editing`) */
	editing?: boolean
}

/** how a followed link reaches outside the editor; tests pass recorders, so nothing is launched */
type LinkOptions = {
	/** runs `open` for web, mail and Finder links; `runDetached` by default */
	run?: Run
	/**
	 * opens a linked text file as a Document, editmd's LinkOpener: by default the file is read here first, and one that
	 * cannot be read alerts in this window and starts nothing, else it opens through `openWindow`, a new editor process.
	 * a recorder in its place (the self-test's) takes the decision itself, as editmd's SelfTest swaps the LinkOpener
	 */
	openInEditor?: (path: string) => void
	/**
	 * what is on disk at a linked or dropped file's path, null for nothing; macOS's UTType through `describeFile` by
	 * default (editmd's LinkPolicy), so a test passes its own and never asks the Mac
	 */
	describeFile?: (path: string) => LinkTarget | null
	/** whether a file is text by its name alone; macOS's type for its extension (`isTextName`) by default */
	isTextName?: (path: string) => boolean
	/** whether a dropped file is an image by its name; macOS's type for its extension (`isImageName`) by default */
	isImageName?: (path: string) => boolean
}

/** how the File menu reaches outside the Document; tests pass recorders, so no picker opens and no window closes */
type WindowOptions = {
	/** Save As's folder; gpuix's `prompt_for_paths({ directories: true })` by default, null when cancelled */
	chooseFolder?: () => Promise<string | null>
	/** ends this window; one process per Document (ADR-0008), so by default the process exits */
	closeWindow?: () => void
	/** the window's title after Save As; gpuix's `set_window_title` by default */
	setWindowTitle?: (title: string) => void
	/**
	 * File > Print's page (gap G5): writes it and returns its path; `writePrintablePage` by default. `folder` is the
	 * Document's, so its relative images print, null for an untitled Document
	 */
	writePrintable?: (text: string, title: string, folder: string | null) => string
	/**
	 * File > New's window, untitled for null, and the window of every other Document opened from here (Open…,
	 * Open Recent, a dropped text file); a new editor process by default (`openWindow`, ADR-0008)
	 */
	openWindow?: (path: string | null) => void
	/** Open…'s files; gpuix's `prompt_for_paths({ files: true, multiple: true })` by default, null when cancelled */
	choosePaths?: () => Promise<string[] | null>
	/** File > Open Recent, which every open and Save As adds to; the shared store at `RECENT_STORE` by default */
	recentFiles?: RecentFiles
	/** Window > Minimize; gpuix's `minimize_window` by default */
	minimizeWindow?: () => void
	/** Window > Zoom; gpuix's `zoom_window` by default */
	zoomWindow?: () => void
	/** Window > Bring All to Front; gpuix's `activate_window` by default, as one window is all a process has */
	activateWindow?: () => void
	/** View > Enter Full Screen, which AppKit appends to editmd's View menu; gpuix's `toggle_fullscreen` by default */
	toggleFullScreen?: () => void
	/** the pasteboard's URL that prefills Add Link's field, null for none; `readClipboardUrl` (pbpaste) by default */
	readClipboardUrl?: () => string | null
	/** puts Edit > Copy's text on the pasteboard, false when it could not; `writeClipboard` (pbcopy) by default */
	writeClipboard?: (text: string) => boolean
	/**
	 * takes the handler that saves before the process ends (`process.on('exit')` by default): gpuix has no close
	 * hook, so closing the window, its Close Window and Quit all end in the process exiting. a test passes a
	 * recorder and calls the handler itself
	 */
	onExit?: (handler: () => void) => void
	/** the Agent legend's minimized state, shared by every window; the shared store at `LEGEND_STORE` by default */
	legendPreference?: LegendPreference
	/** the locale and time zone a highlight's tooltip writes its time in; the user's own by default */
	timeFormat?: TimeFormat
	/**
	 * the window was opened by File > New (its process started with NEW_WINDOW_ENV): AppKit replaces only the untouched
	 * untitled window it opened at launch, so Open… opens beside this one, never into it
	 */
	startedByNew?: boolean
	/** sends keystrokes to the focused field; gpuix's `simulateKeystrokes` by default */
	sendKeys?: (keys: string) => void
	/** how long a probe waits for the field's reply before it gives up, in ms; FIELD_REPLY_MS by default */
	fieldReplyMs?: number
	/**
	 * a remote image's bytes, for its natural size once View > Load Remote Images allows it: by default its first MiB
	 * through `fetch`, given up after 10s (`fetchImageHead`), so a huge or stalled image never holds the window. a test
	 * passes its own, and nothing goes to the network
	 */
	fetchImage?: (url: string) => Promise<Uint8Array>
	/**
	 * the numbers every untitled window holds, NSDocument's Untitled, Untitled 2, …: an untitled window takes one and
	 * frees it once it has a file or ends. none by default, so a window that is given none is plain Untitled; the entry
	 * passes the shared one at `UNTITLED_FOLDER`
	 */
	untitledNumbers?: UntitledNumbers
}

export type OpenOptions = LinkOptions &
	WindowOptions & {
		/** where agent hooks send their Reports; tests pass their own folder */
		socketsDirectory?: string
		/**
		 * the agent processes a change nobody reported is credited to; `ps` through `listAgentProcesses` by
		 * default, so tests pass their own and spawn nothing
		 */
		listAgentProcesses?: () => AgentProcess[]
	}

/** a dialog over the Document; at most one is open, through `#showOverlay` */
export type Overlay =
	/** editmd asks before a link of another scheme starts whichever app claims it (LinkPolicy `.confirm`) */
	| { kind: 'confirmLink'; url: string }
	/**
	 * File > Save As in place of NSSavePanel: `name` prefills the field, `folder` is where it saves.
	 * `replacing` is the existing file the user is asked about, `failure` why the last write failed, and
	 * `closeAfter` closes the window once saved (Close's Save… on an untitled Document)
	 */
	| {
			kind: 'saveAs'
			name: string
			folder: string
			replacing: string | null
			failure: string | null
			closeAfter: boolean
	  }
	/** NSDocument's alert when a Document with unsaved edits closes and could not save itself */
	| { kind: 'saveChanges'; documentName: string; untitled: boolean }
	/** NSDocument's alert before File > Revert to Saved drops the unsaved edits */
	| { kind: 'revert'; documentName: string }
	/** File > Open Recent's submenu as a list: `paths` newest first, then Clear Menu */
	| { kind: 'openRecent'; paths: readonly string[] }
	/**
	 * the command palette (Cmd-Shift-/): every menu item, searchable, beside the in-window menu bar that stands
	 * in for the native one gpuix cannot extend (gap G2, src/ui/MenuBar.svelte)
	 */
	| { kind: 'commandPalette' }
	/** NSDocumentController's alert for a file Open…, Open Recent, a drop or the launch could not open (`openFailure`) */
	| ({ kind: 'openFailed' } & OpenFailure)
	/** NSDocument's alert for a File > Save that could not write (`saveFailure`); an autosave failure only says Not Saved */
	| ({ kind: 'saveFailed' } & OpenFailure)
	/**
	 * NSDocument's question when a save meets a locked file (no write permission), File > Save's or the close
	 * question's: editmd asks to save it anyway, Cancel the default; `documentName` is the file's name, and
	 * `closeAfter` closes the window once Save Anyway writes it (the close question's Save)
	 */
	| { kind: 'saveLocked'; documentName: string; closeAfter: boolean }
	/**
	 * editmd's "Saved in a Different Encoding" sheet (EditorWindowController `showNotice`): a save went through
	 * but had to change the file's encoding, `message` saying how (`DocumentFile.onNotice`)
	 */
	| { kind: 'saveNotice'; message: string }
	/** a menu of the in-window menu bar (gap G2) dropped down under its title: `index` into `menus` */
	| { kind: 'menu'; index: number }
	/**
	 * Format > Link…'s Add Link sheet (EditorWindowController.swift:115-150): `url` prefills its field, the
	 * pasteboard's text when it is a web or mail address
	 */
	| { kind: 'addLink'; url: string }

/** what a menu click carries: a menu bar item, or a Help search match (a MenuEntry) */
export type MenuChoice = { command: BarCommand | null; enabled: boolean; path?: string }

/**
 * what NSDocument puts after the name in the title while the Document has unsaved edits: AppKit's own " — "
 * (Document.loctable) and "Edited" (AutosaveButton.loctable)
 */
const EDITED = ' — Edited'

/** editmd's SaveStatusView fades out over 0.4s (EditorWindowController.swift:363); its text stays up until then */
const STATUS_FADE_OUT_MS = 400

const NO_LABEL: SaveLabel = { kind: 'none' }

/**
 * how far, in px, the pointer may move between a Block's press and its release for the release to stay a click:
 * further is a drag, which selects text instead of opening the Block
 */
const DRAG_DISTANCE = 3

/** where the view scrolls a Block it reveals: a followed link's to the top, an Agent's change to the middle */
export type RevealPlace = 'top' | 'middle'

/** what File > New's opener tells the process it starts, read at launch as `startedByNew` */
export const NEW_WINDOW_ENV = 'EDITMD_GPUIX_NEW'

/**
 * how long a field may take to report what a key did before a probe gives up: about 5ms in a window, on the next
 * frame
 */
const FIELD_REPLY_MS = 1000

/** how often the open field is looked for after it was mounted afresh, and for how many tries */
const FIELD_POLL_MS = 16
const FIELD_POLL_TRIES = 60

/** how many field polls an outside change waits for field work in flight before it shows */
const MERGE_WAIT_TRIES = 120

/** the characters a selection probe types: the second only when the first matches the text beside it */
const SENTINELS = ['a', 'b'] as const

/** each Edit key a menu sends the focused field, as AppKit sends its action to the first responder */
const FIELD_KEYS: Record<FieldCommand, string> = {
	cut: 'cmd-x',
	paste: 'cmd-v',
	// the field pastes plain text either way
	pasteAndMatchStyle: 'cmd-v',
	selectAll: 'cmd-a'
}

/** how long after Copy sends the field its ⌘C the same key heard by the window is taken as that one */
const ECHO_MS = 300

const sendKeystrokes = (keys: string) => get_native()?.simulateKeystrokes(keys)

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** `a` and `b` name one file: the same real path, or the same device and inode */
function isSameFile(a: string, b: string): boolean {
	if (realPathOf(a) === realPathOf(b)) return true
	try {
		const [first, second] = [statSync(a), statSync(b)]
		return first.dev === second.dev && first.ino === second.ino
	} catch {
		return false
	}
}

/** an Agent's colour class, as editmd's `colorClass`: `agent-<slot>`, or `agent-unknown` for Outside edit */
const slotClassOf = ({ slot }: LegendAgent) => (slot === null ? 'agent-unknown' : `agent-${slot}`)

/**
 * a new editor process (`openWindow`, ADR-0008), File > New's (`path` null) told so through NEW_WINDOW_ENV, which
 * every other leaves out; `spawn` is `openWindow`'s, a detached process by default
 */
export function openEditorWindow(path: string | null, spawn?: Spawn): void {
	const inherited = process.env[NEW_WINDOW_ENV]
	if (path === null) process.env[NEW_WINDOW_ENV] = '1'
	else delete process.env[NEW_WINDOW_ENV]
	try {
		openWindow(path, spawn)
	} finally {
		if (inherited === undefined) delete process.env[NEW_WINDOW_ENV]
		else process.env[NEW_WINDOW_ENV] = inherited
	}
}

const chooseFolderWithPicker = async () =>
	(await prompt_for_paths({ directories: true, prompt: 'Choose' }))?.[0] ?? null

/** gpuix's picker takes no file types, so it cannot hold Open… to markdown as editmd's NSOpenPanel does */
const choosePathsWithPicker = () =>
	prompt_for_paths({ files: true, multiple: true, prompt: 'Open' })

const sharedRecentFiles = () => new RecentFiles(RECENT_STORE)

const sharedLegendPreference = () => new LegendPreference(LEGEND_STORE)

const onProcessExit = (handler: () => void) => void process.on('exit', handler)

/**
 * gpuix has no call that closes the window: its frame loop exits the process once the last window has closed
 * (`process.exit(0)` in render.js), so closing this Document's window does the same
 */
const exitProcess = () => process.exit(0)

/** reactive mirror of the one open Document (one window per process, ADR-0008) */
export class DocumentController {
	#document = new Document('')
	#documentFile: DocumentFile | null = null
	#unwatch: (() => void) | null = null
	#stopReports: (() => void) | null = null
	/**
	 * who the window's Reports credit outside writes to: its file's, or, while untitled, one of its own that Save As
	 * hands the new file, so a Report heard before keeps its Claim
	 */
	#attribution = new Attribution(listAgentProcesses)
	#session: EditSession | null = null
	/** the Edit session Return opened for a new Block (`openEditAfter`), which `activeIsNew` asks after */
	#newBlockSession: EditSession | null = null
	/** Return was pressed in the open Block field (`pressReturn`): the field's next report is read as its newline */
	#returnPressed = false
	/**
	 * what the open field shows right now, which a Format command or Add Link rewrites; `activeSource` only holds what
	 * it started with
	 */
	#field = ''
	/**
	 * the open field's fences when it holds a fenced code or mermaid Block's code alone, as editmd's code block node holds
	 * the code and no fence (`fenceParts`): its reports go to the session between them (`#sourceOf`), and its offsets sit
	 * the opening fence's length before the Block source's; null for any other field. set as a field opens
	 * (`#fieldOf`), so a fence typed into a paragraph's field stays in its text until the field opens again
	 */
	#fence: FenceParts | null = null
	#run: Run = runDetached
	#openInEditor: (path: string) => void = (path) => this.#openLinkedFile(path)
	#chooseFolder: () => Promise<string | null> = chooseFolderWithPicker
	#closeWindow: () => void = exitProcess
	#setWindowTitle: (title: string) => void = set_window_title
	#writePrintable: (text: string, title: string, folder: string | null) => string =
		writePrintablePage
	#openWindow: (path: string | null) => void = openEditorWindow
	#choosePaths: () => Promise<string[] | null> = choosePathsWithPicker
	#recentFiles: RecentFiles = sharedRecentFiles()
	#minimizeWindow: () => void = minimize_window
	#zoomWindow: () => void = zoom_window
	#activateWindow: () => void = activate_window
	#toggleFullScreen: () => void = toggle_fullscreen
	#readClipboardUrl: () => string | null = readClipboardUrl
	#writeClipboard: (text: string) => boolean = writeClipboard
	#describeFile: (path: string) => LinkTarget | null = describeFile
	#isTextName: (path: string) => boolean = isTextName
	#isImageName: (path: string) => boolean = isImageName
	#startedByNew = false
	#sendKeys: (keys: string) => void = sendKeystrokes
	#fieldReplyMs = FIELD_REPLY_MS
	/**
	 * set by the view: gives the open field (a Block's or Source mode's) the keys, true once it has them; false while no
	 * field mounted for `fieldRevision` is painted yet
	 */
	#focusField: ((revision: number) => boolean) | null = null
	/**
	 * while a probe reads the field's selection, what the field reports goes here and never reaches the Edit session:
	 * the sentinel and its cmd-z are no edit, so they neither autosave nor mark the Document edited
	 */
	#probing = false
	#probeListener: ((value: string) => void) | null = null
	/** field work in flight (a probe and the keys or value it leads to), which a second command waits out by doing nothing */
	#fieldWork = $state(false)
	/** where the pointer went down on a Block, so the click its release makes can be told from a drag's */
	#pressedAt: { x: number; y: number } | null = null
	/** kept from `load`, so an untitled Document saved later listens where the window was told to */
	#socketsDirectory = SOCKETS_DIRECTORY
	/** what the window was opened with, so a file opened into it later keeps the same outside effects */
	#options: OpenOptions = {}
	/**
	 * the link a <markdown> just reported clicked: its `linkClick` carries only the URL, and the Block's own
	 * click, which GPUI delivers right after it, carries the modifiers that decide whether it is followed
	 */
	#clickedLink: string | null = null
	/** set by the view, which alone holds the Blocks' nodes to scroll; `run` is a changed run's text to scroll to */
	#revealBlock: ((index: number, place: RevealPlace, run?: ChangedRun) => void) | null = null
	/**
	 * the registrars the exit handler has gone to, so each takes it once however often the window rebinds; nothing
	 * renders from it, so it is no SvelteSet
	 */
	#exitRegistrars = new WeakSet<(handler: () => void) => void>()
	/** the close question's Don't Save was chosen: the exit that follows must not save after all */
	#discarded = false
	/** the exit handler is saving: the window is gone, so nothing is retitled */
	#exiting = false
	/** what the window's title shows, so it is set only when the name or the Edited mark changes */
	#shownTitle = untitledName(1)
	/** the untitled window's number and the registry it is held in, null once the Document has a file or for none */
	#untitled: { numbers: UntitledNumbers; number: number } | null = null
	/** a DocumentFile is being made for this window: it reports before it is bound, and its maker syncs after */
	#adopting = false
	/** clears the save-status text once its fade-out is over */
	#statusFade: ReturnType<typeof setTimeout> | undefined = undefined
	#legendPreference: LegendPreference = sharedLegendPreference()
	/** set by the legend's – and pill; null until then, so the stored state is read only once a legend shows */
	#legendMinimized = $state<boolean | null>(null)
	/** the stored state, read on the first look and kept: a window that never shows a legend never reads it */
	#storedMinimized: boolean | null = null
	#timeFormat: TimeFormat = {}
	#imageSizes = new ImageSizes()
	/**
	 * the names the user gave Agents, here or in another window, by id, for the window's life: editmd's app-wide
	 * `AgentEdits.names`, which names a later change's author
	 */
	#agentNames = new SvelteMap<string, string>()
	/** this window's agent socket, which a rename sent from here leaves out; null while it has none */
	#ownSocket: string | null = null
	/** the Agents seen since the Document was bound: their colour slots, names and where Reveal got to */
	#agentLegend = new AgentLegend(this.#agentNames)
	/**
	 * notices that arrived while another dialog was up, oldest first: AppKit queues a sheet begun over another
	 * and shows it once that one is dismissed, so each waits for `#showNextNotice`
	 */
	#pendingNotices: string[] = []
	text = $state.raw('')
	blocks = $state.raw<readonly Block[]>([])
	highlights = $state.raw<readonly Highlight[]>([])
	/** the Deletion lines between Blocks (`Document.deletions`), in document order */
	deletions = $state.raw<readonly Deletion[]>([])
	/**
	 * the body holds no text: no Block, or front matter only, as editmd's "Start writing…" shows for an empty body
	 * (style.css:394-399, frontmatter.ts:104)
	 */
	bodyBlank = $derived(this.blocks.every((block) => block.kind === 'frontmatter'))
	/** the Active block's index, null when no Edit session is open */
	activeIndex = $state<number | null>(null)
	/**
	 * the open field is a new Block's that holds no text yet (Return's `openEditAfter`): it covers no Block, and sits
	 * before Block `activeIndex`, or after the last Block when `activeIndex` is their count. once typed into, it is an
	 * ordinary Active block
	 */
	activeIsNew = $state(false)
	/** what the Active block's field starts with */
	activeSource = $state('')
	/**
	 * the Active block's kind as its field was mounted, which picks the field's look (a code card or plain): typing that
	 * changes the kind keeps the field it is typed in, as a new look would mount a fresh field over the typing, except
	 * an input rule's text typed at the Block's start (`# `, `- `, a fence and a space), which takes the new look at once
	 * as editmd's input rules do (`#typeField`); a Format command, which mounts a fresh field anyway, takes the new kind
	 */
	activeKind = $state<BlockKind>('paragraph')
	/** bumped when code replaces the field's text, so the view mounts a fresh field showing `activeSource` */
	fieldRevision = $state(0)
	/** Source mode (editmd View > Source): the whole Document in one field instead of the Blocks */
	sourceMode = $state(false)
	/** the save-status label text: '', 'Saving…', 'Saved' or 'Not Saved' */
	label = $state('')
	/** what the save-status label paints: the label's text, kept while it fades out after the label goes */
	statusText = $state('')
	/** the label shows (fades in) or has gone (fades out), as editmd's SaveStatusView animates its alpha */
	statusShown = $state(false)
	/** Not Saved, which editmd paints in systemRed */
	statusFailed = $state(false)
	/** the label's tooltip: why the save failed (`labelDetail`), null for none */
	statusDetail = $state<string | null>(null)
	/** the Document has unsaved edits, as NSDocument's `isDocumentEdited` */
	edited = $state(false)
	/** the Document has a file, which Revert to Saved can go back to */
	hasFile = $state(false)
	/** the open file's folder, which relative image paths resolve against; null for an untitled Document */
	folder = $state<string | null>(null)
	/**
	 * per window, like editmd's View > Load Remote Images (EditorBridge.swift:140-146): a window starts blocked, and a
	 * file opened into it later keeps what the window was set to
	 */
	remoteImagesAllowed = $state(false)
	/** the open dialog, null when none is */
	overlay = $state.raw<Overlay | null>(null)
	/**
	 * the painted text the window's selection holds (gpuix's `on_selection_change`), null for none: Edit > Copy and ⌘C
	 * outside a field put it on the pasteboard
	 */
	selectedText = $state<string | null>(null)
	/** bumped each time the window takes another Document, whose views then draw afresh, as editmd's new node views do */
	documentGeneration = $state(0)

	/**
	 * the legend's rows: every Agent with a highlight, in order of arrival with Outside edit last, each with its
	 * colour slot from first sight, its shown name and its count (`AgentLegend`). set with the highlights in
	 * `#sync`, not a $derived, because seeing an Agent records it, and by a rename
	 */
	agents = $state.raw<readonly LegendAgent[]>([])
	/**
	 * the legend shrunk to editmd's pill of dots, remembered for every window and launch as editmd keeps it in
	 * localStorage (highlights.ts:221-229): the legend's own choice, else the store's, read once a legend asks
	 */
	get legendMinimized(): boolean {
		return this.#legendMinimized ?? (this.#storedMinimized ??= this.#legendPreference.minimized())
	}

	/**
	 * a window's untitled Document: nothing is saved or watched until Save As gives it a file. like `open`, it starts
	 * the window, so View > Load Remote Images starts blocked
	 */
	load(text: string, options: OpenOptions = {}): void {
		this.#bind(null, new Document(text), options)
		this.folder = null
		this.remoteImagesAllowed = false
	}

	/**
	 * a window's file at `path`: autosaved, and merged when someone else writes it, credited to the Agent that did.
	 * it starts the window, so View > Load Remote Images starts blocked; a file opened into the window later keeps it
	 */
	open(path: string, options: OpenOptions = {}): void {
		this.#openFile(path, options)
		this.remoteImagesAllowed = false
	}

	/** the file at `path` as this window's Document, everything the window was set to kept */
	#openFile(path: string, options: OpenOptions): void {
		const attribution = new Attribution(options.listAgentProcesses ?? listAgentProcesses)
		this.#adopting = true
		let documentFile: DocumentFile
		try {
			documentFile = new DocumentFile(path, ...this.#fileHooks(attribution))
		} finally {
			this.#adopting = false
		}
		this.#bind(documentFile, documentFile.document, options)
		this.#follow(documentFile, attribution)
	}

	/**
	 * the file a process was started with (`parseLaunch`: a path from a shell, or a window `openWindow` spawned for
	 * Open…, Open Recent or a drop), opened and noted in Open Recent, as NSDocumentController notes every
	 * document it opens. a file that cannot be read as text shows NSDocumentController's alert over an empty untitled
	 * Document, stays out of Open Recent, and the alert's dismissal ends the window, as editmd opens no window for it
	 * (`dismissOpenFailure`); returns whether the file opened, so the entry titles the window after it or Untitled
	 */
	openAtLaunch(path: string, options: OpenOptions = {}): boolean {
		try {
			this.open(path, options)
		} catch (error) {
			this.load('', options)
			this.#showOpenFailure(path, error)
			this.#openedNothing = true
			return false
		}
		this.#recentFiles.add(path)
		return true
	}

	/**
	 * the launch file could not be opened (`openAtLaunch`), so the window holds no Document of its own and goes with
	 * the alert; a Document bound since clears it. nothing renders from it
	 */
	#openedNothing = false

	/** the open-failure alert's OK, Return or Escape: after a failed launch it ends the window too */
	dismissOpenFailure(): void {
		this.closeOverlay()
		if (this.#openedNothing) this.#closeWindow()
	}

	/** NSDocumentController's alert for the file at `path`, which could not be read as text because of `error` */
	#showOpenFailure(path: string, error: unknown): void {
		const failure = openFailure(
			basename(path),
			error instanceof Error ? error : new Error(String(error))
		)
		this.#showOverlay({ kind: 'openFailed', ...failure })
	}

	/**
	 * what a DocumentFile calls back: its clock, a repaint, which also shows an outside change in the open field
	 * (`#showOutsideChange`), and the Agent an outside write is credited to, which the legend sees at once, as
	 * editmd's mergeNow names it before it looks for changes (editor.ts:226): an Agent whose merge changes nothing
	 * still takes its colour slot. Source mode names nobody, as editmd's source merge (editor.ts:210-216)
	 */
	#fileHooks(attribution: Attribution) {
		return [
			createClockScheduler(),
			() => {
				this.#sync()
				this.#showOutsideChange()
			},
			(changedPath: string) => {
				const author = attribution.authorOfChange(changedPath)
				if (author && !this.sourceMode) this.#agentLegend.see(author)
				return author
			}
		] as const
	}

	/**
	 * an outside change (another program, an agent) reached the open field's Block, or Source mode's whole text: the
	 * field shows it at once, merged with the typing (`takeOutsideChange`), as editmd's editor shows it live. the field
	 * is set to the merged text and its caret put back where the merge moved it (`caretThrough`): the caret the last
	 * typing left (`#lastCaret`), not a selection probe, whose sentinel would race the user's own keys and a field that
	 * closes meanwhile. a programmatic value clears the field's native undo, which is the price of showing
	 * the change. field work in flight (a probe, a command's keys) is waited out first, so the change lands after it
	 */
	#showOutsideChange(): void {
		const session = this.#session
		if (!session?.hasDeferredMerge || this.#mergePending) return
		this.#mergePending = true
		void (async () => {
			try {
				for (let tries = 0; this.#fieldWork && tries < MERGE_WAIT_TRIES; tries++)
					await delay(FIELD_POLL_MS)
				if (this.#session !== session || this.#fieldWork) return
				const change = session.takeOutsideChange()
				if (!change) return
				// the change's edits count in the Block source, the field's caret in its text: code alone sits past the fence
				const at = caretThrough(change.edits, (this.#lastCaret ?? this.#field.length) + this.#shift)
				this.#replaced = { session, revision: this.fieldRevision, shown: this.#field }
				const field = this.#fieldOf(change.text, this.#fence !== null)
				this.#remountField(field)
				const revision = this.fieldRevision
				const caret = this.#fieldCaret(at)
				this.#lastCaret = caret
				this.#sessionEnd = session.end
				this.#sync()
				// a field mounted afresh since (`#typeLate`) puts its own caret, so these keys would be stale
				if (
					await this.#fieldReady(() => this.#session === session && this.fieldRevision === revision)
				)
					this.#sendKeys(caretKeys(field, caret))
			} finally {
				this.#mergePending = false
			}
			// a change that came in while this one was on its way
			if (this.#session?.hasDeferredMerge) this.#showOutsideChange()
		})()
	}

	/** an outside change is on its way into the open field (`#showOutsideChange`); nothing renders from it */
	#mergePending = false

	/**
	 * the field the last outside change replaced (`#showOutsideChange`): its Edit session, the `fieldRevision` it was
	 * mounted at, and the text it showed as last reported, which a key it took on its way out was typed over
	 * (`#typeLate`); nothing renders from it
	 */
	#replaced: { session: EditSession; revision: number; shown: string } | null = null

	/**
	 * where the open field's caret was last seen: at the end of what the last typing changed (`typeInActive`), at the
	 * end of a field mounted afresh, which is where a remounted field puts it; null for none. a caret moved
	 * by arrows or the pointer since is not seen, gpuix reports none (gap G1)
	 */
	#lastCaret: number | null = null

	/**
	 * the window works on `documentFile`'s file: watched, its folder for links and images, Reports credited through
	 * `attribution`, and a save that had to change the file's encoding shown as editmd's notice
	 */
	#follow(documentFile: DocumentFile, attribution: Attribution): void {
		this.#attribution = attribution
		documentFile.onNotice = (message) => {
			// a file this window has since let go of keeps its timers, but no longer speaks here
			if (this.#documentFile === documentFile) this.#showNotice(message)
		}
		/**
		 * another program renamed or moved the file, as NSDocument follows it (`presentedItemDidMove`): the window takes
		 * its new name, the watcher and the folder follow it, and Open Recent holds the new path
		 */
		documentFile.onMoved = (path) => {
			if (this.#documentFile !== documentFile) return
			this.#watch(documentFile)
			this.#recentFiles.add(path)
			this.#sync()
		}
		this.#watch(documentFile)
	}

	/**
	 * the window hears the agent sockets from the moment it binds a Document, untitled too, as editmd's
	 * `AgentEdits.shared` is app-wide (AgentEdits.swift:39-45): Reports, renames, greetings, Bring All to Front, and a
	 * window about to open this one's file, which only a window with a file answers
	 */
	#listen(): void {
		const directory = this.#socketsDirectory
		// without a socket the editor still works: outside writes fall back to the agent processes
		const listening = listenForReports(
			directory,
			(report) => this.#attribution.report(report),
			({ id, name }) => this.#renamed(id, name),
			// a window opened later asks for these: every name the user gave here or another window sent
			() => [...this.#agentNames].map(([id, name]) => ({ id, name })),
			// a window about to open this file asks first, and this one comes forward instead (`#openInNewWindow`)
			{
				owns: (path) => this.#documentFile !== null && isSameFile(path, this.#documentFile.path),
				focus: () => this.#activateWindow()
			}
		).catch((error: Error) => this.#reportsUnreachable(error))
		const stop = () => void listening.then((close) => close?.())
		this.#stopReports = stop
		void listening.then((listener) => {
			if (this.#stopReports !== stop || !listener) return
			// the socket a rename from here leaves out, while this listener is still the window's
			this.#ownSocket = listener.socket
			/**
			 * editmd keeps renames for the app's life (AgentEdits.swift:18-19,35), so this window asks the open ones
			 * for the names they know; each answer arrives as a rename through the listener above
			 */
			void greetPeers(directory, listener.socket)
		})
	}

	/**
	 * the window cannot hear agent Reports (`listenForReports` rejected, say a socket path past macOS's 104
	 * bytes): its reason goes to stderr once, since nothing else would say why an Agent's edits come in as
	 * Outside edit, and the window keeps working without a listener
	 */
	#reportsUnreachable(error: Error): null {
		console.error(error.message)
		return null
	}

	/** watches the file `documentFile` now lives at, in place of any earlier one, and resolves paths in its folder */
	#watch(documentFile: DocumentFile): void {
		this.#unwatch?.()
		this.folder = dirname(documentFile.path)
		this.#unwatch = watchFile(documentFile.path, () => documentFile.diskChanged())
	}

	/** the name NSDocument shows in its title and alerts: the file's, or the untitled window's, Untitled 2 for the second */
	get #documentName(): string {
		return this.#documentFile
			? basename(this.#documentFile.path)
			: untitledName(this.#untitled?.number ?? 1)
	}

	/** the window's title as set last, which the entry opens the window with */
	get windowTitle(): string {
		return this.#shownTitle
	}

	/** frees the untitled window's number, once its Document has a file or the window ends */
	#releaseUntitled(): void {
		this.#untitled?.numbers.release(process.pid)
		this.#untitled = null
	}

	sliceOf(block: Block): string {
		return this.text.slice(block.start, block.end)
	}

	/**
	 * Block `index` lies inside the open field's text after the Active block: a Format command (Heading 4 on two
	 * lines writes a heading and a paragraph) or typing a blank line made it, and the field shows it until it closes,
	 * as editmd's one editable node does, so the view paints it nowhere else. the field's text starts where the
	 * Active block does and runs as long as what it holds
	 */
	coveredByField(index: number): boolean {
		if (this.activeIndex === null || this.sourceMode || index <= this.activeIndex) return false
		const block = this.blocks[index]
		if (!block || !this.#session) return false
		return block.start < this.#sessionEnd
	}

	/**
	 * where the open field's text ends in the Document, as of the last sync: the Edit session's own range, which a Disk
	 * merge moves with its text (`EditSession.end`). state, so the Blocks it covers repaint when it moves
	 */
	#sessionEnd = $state(0)

	/**
	 * the Block the open field stands for: the first one the Edit session's range reaches, wherever a Disk merge moved
	 * it. an index kept from the click went stale when a write from outside added or removed a Block above, and put the
	 * field on another Block, whose text the next keystroke then replaced. a range a merge emptied sits
	 * where its Block was, so the Block after it stands for it, or the last one at the end; a new Block's empty field
	 * (`activeIsNew`) past the last Block gets the Blocks' count. null when nothing is open,
	 * in Source mode, and 0 for an empty Document's first field (`startWriting`), which has no Block yet
	 */
	#activeIndexOfSession(): number | null {
		const session = this.#session
		if (!session || this.sourceMode) return null
		const blocks = this.#document.blocks
		if (blocks.length === 0) return 0
		const reached = blocks.findIndex((block) => block.end > session.start)
		if (reached < 0) return this.activeIsNew ? blocks.length : blocks.length - 1
		return reached
	}

	/**
	 * the colour class of the Block's tint and bar: the latest of the Agent highlights marking `block` whole, as editmd's
	 * nested decorations paint the innermost, its last: `agent-<slot>`, or `agent-unknown` for Outside edit, as
	 * editmd's `colorClass`; null when none marks it whole. a highlight of changed runs takes no tint or bar
	 * (`changedRunsOf`)
	 */
	agentClassOf(block: Block): string | null {
		// a list's or quote's new children and the ones taken away mark their own rows (`rowAgentClassOf`, `gapsAt`)
		const whole = this.#highlightsOf(block).filter(
			({ highlight }) => !highlight.runs?.length && !highlight.gaps?.length
		)
		const latest = whole.reduce<(typeof whole)[number] | null>(
			(found, each) => (found && found.highlight.at > each.highlight.at ? found : each),
			null
		)
		return latest?.agent ? slotClassOf(latest.agent) : null
	}

	/**
	 * the colour class the open field of Block `index` is marked in: the latest Agent highlight overlapping the Block,
	 * whole or by its changed runs, as editmd marks an agent's change live in the text being edited. a <textarea> paints
	 * no `highlight` of its own (measured headless), so the field takes the tint and bar a Block marked whole
	 * takes; null when no Agent's change touches the Block, and for a new Block's field (`activeIsNew`), whose index
	 * is the Block after it
	 */
	fieldAgentClassOf(index: number): string | null {
		if (this.activeIsNew && index === this.activeIndex) return null
		const block = this.blocks[index]
		if (!block) return null
		const latest = this.#highlightsOf(block).reduce<{
			highlight: Highlight
			agent: LegendAgent | undefined
		} | null>(
			(found, each) => (found && found.highlight.at > each.highlight.at ? found : each),
			null
		)
		return latest?.agent ? slotClassOf(latest.agent) : null
	}

	/**
	 * the changed text of every Agent highlight that marks runs inside `block` rather than the whole Block
	 * (`Highlight.runs`, editmd's `.agent-change`, highlights.ts:185-188), in document order: each run as the nth
	 * occurrence of its text in the Block's painted text, with its Agent's colour class (`agent-<slot>`, or
	 * `agent-unknown`), whose `-change` token washes it and `-deleted` token (70%) underlines it. a `whole` run is no
	 * wash: its row takes the tint (`rowAgentClassOf`). empty when none does
	 */
	changedRunsOf(block: Block): readonly { runs: readonly ChangedRun[]; agentClass: string }[] {
		return this.#highlightsOf(block).flatMap(({ highlight, agent }) => {
			const runs = highlight.runs?.filter((run) => !run.whole) ?? []
			return agent && runs.length > 0 ? [{ runs, agentClass: slotClassOf(agent) }] : []
		})
	}

	/**
	 * where Agents changed the children of lists and quotes, as editmd's `block` and `deleted` changes inside them
	 * (changes.ts:38-44, 49-50): each `whole` run by the Document offset its first painted character comes from, with
	 * its Agent's colour class and time, and each gap by the offset of the child after it (null past the last), with its
	 * top-level Block's index, its Agent's `-deleted` class and its tooltip
	 */
	#changedRows = $derived.by(() => {
		const whole: { offset: number; at: number; agentClass: string }[] = []
		const gaps: { index: number; offset: number | null; colour: string; tooltip: string }[] = []
		for (const highlight of this.highlights) {
			const index = this.blocks.findIndex(
				({ start, end }) => highlight.start < end && highlight.end > start
			)
			const block = this.blocks[index]
			const agent = this.agents.find(({ id }) => id === highlight.author.id)
			if (!block || !agent) continue
			const source = this.text.slice(block.start, block.end)
			const offsetOf = (run: ChangedRun) => {
				const offset = runOffset(source, run)
				return offset === null ? null : block.start + offset
			}
			for (const run of highlight.runs ?? []) {
				const offset = run.whole ? offsetOf(run) : null
				if (offset !== null)
					whole.push({ offset, at: highlight.at, agentClass: slotClassOf(agent) })
			}
			for (const gap of highlight.gaps ?? []) {
				gaps.push({
					index,
					offset: gap.before ? offsetOf(gap.before) : null,
					colour: `${slotClassOf(agent)}-deleted`,
					tooltip: deletionTooltip(agent.name, highlight.at, gap.text, this.#timeFormat)
				})
			}
		}
		return { whole, gaps }
	})

	/**
	 * the colour class that tints and bars the row of a list or quote painting the Document from `start` to `end`: the
	 * latest Agent's change that made a child new there or another node (a `whole` run), as editmd marks such a child
	 * as a block, with the tokens a whole Block takes; null for none
	 */
	rowAgentClassOf(start: number, end: number): string | null {
		const inside = this.#changedRows.whole.filter(({ offset }) => offset >= start && offset < end)
		return (
			inside.reduce<(typeof inside)[number] | null>(
				(found, each) => (found && found.at > each.at ? found : each),
				null
			)?.agentClass ?? null
		)
	}

	/**
	 * the lines for children taken away from a list or quote, as editmd's `between` line: those above the row painting
	 * the Document from `start` to `end`, or with no range those after the last row of top-level Block `index`
	 */
	gapsAt(range: { start: number; end: number } | { index: number }) {
		return this.#changedRows.gaps.filter(({ index, offset }) =>
			'index' in range
				? offset === null && index === range.index
				: offset !== null && offset >= range.start && offset < range.end
		)
	}

	/**
	 * the tooltip of the Agent highlights overlapping `block`, as editmd titles each highlight (highlights.ts:184,
	 * 214-219): a line per highlight with its Agent's shown name, renamed or not, and the time of the change, or "Deleted
	 * by" and the text for one that only took text away (`Highlight.removed`); null when none overlaps it
	 */
	highlightTooltipOf(block: Block): string | null {
		// children taken away from a list or quote are titled on their own lines (`gapsAt`), not on the Block
		const found = this.#highlightsOf(block).filter(
			({ highlight }) => !highlight.gaps?.length || highlight.runs?.length
		)
		if (found.length === 0) return null
		return found
			.map(({ highlight, agent }) => {
				const name = agent?.name ?? highlight.author.name
				// text taken away inside the Block is titled as editmd titles a deletion (highlights.ts:189-219)
				return highlight.removed === undefined || highlight.gaps?.length
					? highlightTooltip(name, highlight.at, this.#timeFormat)
					: deletionTooltip(name, highlight.at, highlight.removed, this.#timeFormat)
			})
			.join('\n')
	}

	/** a Deletion line's colour class: `agent-<slot>-deleted`, or `agent-unknown-deleted` for Outside edit */
	deletionClassOf(deletion: Deletion): string {
		const slot = this.agents.find(({ id }) => id === deletion.author.id)?.slot ?? null
		return slot === null ? 'agent-unknown-deleted' : `agent-${slot}-deleted`
	}

	/**
	 * a Deletion line's tooltip as editmd titles a deleted change (highlights.ts:217-218): "Deleted by <name>,
	 * <time>:" and the removed text, the name as the legend shows it
	 */
	deletionTooltipOf(deletion: Deletion): string {
		const name =
			this.agents.find(({ id }) => id === deletion.author.id)?.name ?? deletion.author.name
		return deletionTooltip(name, deletion.at, deletion.text, this.#timeFormat)
	}

	/** every Agent highlight overlapping `block`, in document order, each with the legend's row for its Agent */
	#highlightsOf(block: Block): { highlight: Highlight; agent: LegendAgent | undefined }[] {
		return this.highlights
			.filter(({ start, end }) => start < block.end && end > block.start)
			.map((highlight) => ({
				highlight,
				agent: this.agents.find(({ id }) => id === highlight.author.id)
			}))
	}

	/**
	 * every definition in the Document, one per line, or '' when there is none: joined once per `blocks`
	 * change, not once per painted Block, so a keystroke costs one pass over the Blocks
	 */
	#definitions = $derived(
		this.blocks
			.filter((block) => block.kind === 'definition')
			.map((block) => this.sliceOf(block))
			.join('\n')
	)

	/**
	 * what a <markdown> paints for `source`: the source plus every definition in the Document, since each
	 * Block is painted on its own and reference links resolve only within one source
	 */
	renderSource(source: string): string {
		return this.#definitions === '' ? source : `${source}\n\n${this.#definitions}`
	}

	/**
	 * the Document text from `start` to `end` inside `block` as native <markdown> should paint it (`paintedSlice`):
	 * each footnote reference in that range as a link run, each link with no text as its own source in code;
	 * apply before `renderSource`, so only the Block's own text is rewritten
	 */
	paintedSliceOf(block: Block, start = block.start, end = block.end): string {
		return paintedSlice(this.text.slice(start, end), start, block)
	}

	renderSourceOf(block: Block): string {
		return this.renderSource(this.paintedSliceOf(block))
	}

	toggleTask(mark: number): void {
		this.#document.toggleTask(mark)
		this.#documentFile?.changed()
		this.#sync()
	}

	openBlock(index: number): void {
		this.#dropEmptyPair()
		this.#session?.close()
		this.#session = this.#document.openEdit(index)
		this.activeIndex = index
		this.activeIsNew = false
		this.activeKind = this.#document.blocks[index]?.kind ?? 'paragraph'
		this.activeSource = this.#field = this.#fieldOf(this.#session.source, this.#codeKind)
		this.#lastCaret = this.#field.length
		this.#sessionEnd = this.#session.end
	}

	/**
	 * a click on an empty Document's "Start writing…" hint: an Edit session as Block 0, so the view shows its field
	 * before any Block exists, and the first keystroke makes the first Block. a session over the whole text is exactly
	 * that, since the text is empty or blank lines only; with any text, front matter included (whose body has no field
	 * of its own to open: the hint's click does nothing there), or in Source mode, it does nothing
	 */
	startWriting(): void {
		if (this.#document.text.trim() !== '' || this.sourceMode) return
		this.#session?.close()
		this.#session = this.#document.openSourceEdit()
		this.activeIndex = 0
		this.activeIsNew = false
		this.activeKind = 'paragraph'
		this.activeSource = this.#field = this.#fieldOf(this.#session.source, false)
		this.#sessionEnd = this.#session.end
	}

	/** a <markdown> reported a click on the link to `href`; the Block's click that follows decides what it does */
	linkClicked(href: string): void {
		this.#clickedLink = href
	}

	/** the window's text selection changed: `text` is what it holds now, null when it is empty */
	selectionChanged(text: string | null): void {
		this.selectedText = text === '' ? null : text
	}

	/** the pointer went down on a Block at window point (`x`, `y`), so its release can be told from a drag's */
	pressBlock(x: number | undefined, y: number | undefined): void {
		this.#pressedAt = x === undefined || y === undefined ? null : { x, y }
	}

	/**
	 * a click on Block `index`: with Cmd on a link it follows the link and opens nothing, as editmd's onClick
	 * (`if (!event.metaKey) return`); the release of a drag that selected text opens nothing either, as editmd keeps
	 * the selection; any other click opens the Block for editing. `x` and `y` are where it was released
	 */
	clickBlock(index: number, { cmd, x, y }: { cmd: boolean; x?: number; y?: number }): void {
		const href = this.#clickedLink
		this.#clickedLink = null
		const pressed = this.#pressedAt
		this.#pressedAt = null
		const dragged =
			pressed !== null &&
			x !== undefined &&
			y !== undefined &&
			Math.hypot(x - pressed.x, y - pressed.y) > DRAG_DISTANCE
		if (cmd && href !== null) this.#followLink(href)
		else if (!dragged) this.openBlock(index)
	}

	/**
	 * the view scrolls Block `index` into view when a link points at it (to the top) or the legend reveals an
	 * Agent's change in it (to the middle); returns the unsubscribe
	 */
	onRevealBlock(reveal: (index: number, place: RevealPlace, run?: ChangedRun) => void): () => void {
		this.#revealBlock = reveal
		return () => {
			if (this.#revealBlock === reveal) this.#revealBlock = null
		}
	}

	/**
	 * where `href` goes (`linkDestination`): a heading in this Document scrolls into view, a footnote reference goes
	 * nowhere, anything else is carried out by `linkAction`'s policy. a link that policy ignores beeps, as editmd's
	 * LinkOpener plays `NSSound.beep()` for `.ignore` (LinkOpener.swift:19-20)
	 */
	#followLink(href: string): void {
		const destination = linkDestination(href, this.blocks, this.folder)
		if (destination.kind === 'block') {
			this.#revealBlock?.(destination.index, 'top')
			return
		}
		if (destination.kind === 'none') return
		const action =
			destination.kind === 'ignore'
				? destination
				: linkAction(destination.href, this.#describeFile, this.#isTextName)
		if (action.kind === 'confirm') this.#showOverlay({ kind: 'confirmLink', url: action.url })
		else if (action.kind === 'ignore') this.#run('osascript', ['-e', 'beep'])
		else carryOutLink(action, this.#run, this.#openInEditor)
	}

	/**
	 * a linked text file opens in an editor of its own only once it reads here: one that is missing, binary or
	 * unreadable shows the open-failure alert in this window and starts nothing, as editmd's LinkOpener only alerts
	 * (LinkOpener.swift:11-14), where a new process would leave an empty untitled window behind its alert
	 */
	#openLinkedFile(path: string): void {
		try {
			openTextFile(path)
		} catch (error) {
			this.#showOpenFailure(path, error)
			return
		}
		void this.#openInNewWindow(path)
	}

	/**
	 * a Document opens in a window of its own (Open…, Open Recent, a ⌘-clicked or dropped text file), unless another
	 * window already has the file: that one comes forward and nothing starts, as editmd brings a document's window
	 * forward instead of opening it twice (`focusWindowFor` asks every window listening for Reports)
	 */
	async #openInNewWindow(path: string): Promise<void> {
		const real = realPathOf(path)
		if (await focusWindowFor(this.#socketsDirectory, real, this.#ownSocket)) return
		this.#openWindow(path)
	}

	/**
	 * the one way a dialog opens, so a second replaces the first instead of stacking on it; a notice waits its
	 * turn instead (`#showNotice`)
	 */
	#showOverlay(overlay: Overlay): void {
		this.overlay = overlay
	}

	/**
	 * editmd's notice sheet: shown at once over a bare Document, and queued behind any dialog already up, as
	 * AppKit queues a sheet begun while another is up
	 */
	#showNotice(message: string): void {
		if (this.overlay === null) this.#showOverlay({ kind: 'saveNotice', message })
		else this.#pendingNotices.push(message)
	}

	/** the oldest queued notice, once no dialog is up */
	#showNextNotice(): void {
		const message = this.overlay === null ? this.#pendingNotices.shift() : undefined
		if (message !== undefined) this.#showOverlay({ kind: 'saveNotice', message })
	}

	/** Cancel, Escape, or a dialog done with its work; a queued notice shows next */
	closeOverlay(): void {
		this.overlay = null
		this.#showNextNotice()
	}

	/**
	 * close the dialog to do `action`, which may open a dialog of its own: a queued notice waits until `action`
	 * is done, then shows only when it opened none, so a dialog it opens does not replace the notice
	 */
	#closeOverlayFor(action: () => void): void {
		this.overlay = null
		action()
		this.#showNextNotice()
	}

	/** the link dialog's Open: the URL goes to `open`, as editmd hands it to NSWorkspace */
	openConfirmedLink(): void {
		if (this.overlay?.kind !== 'confirmLink') return
		const { url } = this.overlay
		this.closeOverlay()
		this.#run('open', [url])
	}

	closeEdit(): void {
		this.#dropEmptyPair()
		const index = this.activeIndex
		const untouchedNew = this.activeIsNew
		this.#session?.close()
		this.#session = null
		this.activeIndex = null
		this.activeIsNew = false
		const block =
			index === null || this.sourceMode || untouchedNew ? undefined : this.#document.blocks[index]
		this.#lastPlace = block
			? { index: index ?? 0, text: this.#document.text.slice(block.start, block.end) }
			: null
		// closed untouched, a new Block takes its blank line back out of the text
		if (untouchedNew) this.#sync()
	}

	/**
	 * where editmd's caret stayed when the last Edit session closed: its Block's index and that Block's text then, so a
	 * command with no field open acts there (`#openAtLoadCaret`); dropped once that Block is gone or changed, by a
	 * Disk merge or anything else
	 */
	#lastPlace: { index: number; text: string } | null = null

	/**
	 * the open field reported `field`; while a probe reads its selection, the probe takes it instead. `revision` is the
	 * `fieldRevision` the reporting field was mounted at: a field since mounted afresh (a probe that gave up sets the
	 * field to its text again) is no longer the open one, so what it still reports, a late sentinel included, is dropped,
	 * but for a key the field an outside change replaced took on its way out (`#typeLate`).
	 * a newline Return or Shift-Return typed into a Block's field does what editmd's Enter does (`#typeReturn`)
	 */
	typeInActive(field: string, revision?: number): void {
		if (revision !== undefined && revision !== this.fieldRevision) {
			this.#typeLate(field, revision)
			return
		}
		const returnPressed = this.#returnPressed
		this.#returnPressed = false
		if (this.#probing) {
			this.#probeListener?.(field)
			return
		}
		const caret = caretAfterTyping(this.#field, field)
		this.#lastCaret = caret
		const at = caret - 1
		// a newline that lands while a command works on the field is kept as typed: only the user's own Return splits
		const typedNewline =
			!this.#fieldWork &&
			!this.sourceMode &&
			this.activeIndex !== null &&
			field.length === this.#field.length + 1 &&
			field[at] === '\n' &&
			field.slice(0, at) + field.slice(caret) === this.#field
		// Return reads the Block's kind from its text, so a field holding code alone hands it the fences too
		if (typedNewline)
			this.#typeReturn(
				returnEdit(this.#sourceOf(field), at + this.#shift, !returnPressed),
				field,
				caret
			)
		else this.#typeField(field, caret)
	}

	/**
	 * the field an outside change replaced (`#replaced`) reported `field`, typing it took between its last report and its
	 * replacement, still on its way from GPUI then: typed over the text it showed, so merged onto the open field's text,
	 * which the field shows afresh, its caret after the typing. a report from any other replaced field, a probe's or a
	 * command's, is dropped, and so is one that comes while field work runs, which a remount would cut short
	 */
	#typeLate(field: string, revision: number): void {
		const replaced = this.#replaced
		if (replaced?.revision !== revision || replaced.session !== this.#session || this.#fieldWork)
			return
		const merged = mergeText(
			replaced.shown,
			field,
			this.#field,
			caretAfterTyping(replaced.shown, field)
		)
		// a second late report from the same field goes on from this one
		replaced.shown = field
		if (merged.text === this.#field) return
		this.#writeField(merged.text)
		this.#remountField(merged.text)
		this.#putCaret(merged.text, merged.cursor)
	}

	/**
	 * the user's typing, which left the open field holding `field` with its caret at `caret`: written to the Document, and
	 * once it is an input rule's text at the Block's start (`inputRuleKind`) the field is mounted afresh in the new kind's
	 * look, its caret put back after the typing, as editmd turns the Block into a heading, list, quote, code block or rule
	 * the moment the rule's text is typed. the look follows the text back too: once a deletion leaves the field's text
	 * no longer the rule kind it shows (`# Title` lost its `# `), it takes the kind the text now is, as editmd's heading
	 * turns back into a paragraph. only a deletion: text typed in front of the syntax passes through other kinds on the
	 * way (`-` then a space before `- Body`), and each remount's caret comes back by keys a frame later. keys a command
	 * sends the field (`#fieldWork`) change no look
	 */
	#typeField(field: string, caret: number): void {
		const deleted = field.length < this.#field.length
		this.#writeField(field)
		if (this.#fieldWork || this.sourceMode || this.activeIndex === null) return
		const source = this.#sourceOf(field)
		const lost = deleted && INPUT_RULE_KINDS.has(this.activeKind)
		const kind = inputRuleKind(source, caret + this.#shift) ?? (lost ? blockKindOf(source) : null)
		if (kind === null || kind === this.activeKind) return
		this.activeKind = kind
		this.#remountField(field)
		this.#putCaret(field, caret)
	}

	/**
	 * Return in the open Block field, which the field hands over as a submit (`onsubmit`) instead of typing its newline:
	 * Shift-Return is sent to the field in its place, so the newline it types shows where the caret was (gpuix reports no
	 * caret, gap G1), and the report that brings it is read as Return's (`typeInActive`). a newline the field reports
	 * with no Return pressed came from the user's own Shift-Return
	 */
	pressReturn(): void {
		this.#returnPressed = true
		this.#sendKeys('shift-enter')
	}

	/**
	 * Return typed into the open Block field, which reported `field` with its newline, as editmd's Enter does
	 * (`returnEdit`): the newline stays as typed, the caret at `caret` after it (`#typeField`), the field's text is
	 * rewritten with the caret put after the change, or the Block splits at the caret (`#splitField`)
	 */
	#typeReturn(edit: ReturnEdit, field: string, caret: number): void {
		if (edit.kind === 'newline') this.#typeField(field, caret)
		else if (edit.kind === 'field') {
			this.#replaceField(edit.field)
			this.#putCaret(edit.field, edit.caret)
		} else this.#splitField(edit.head, edit.tail)
	}

	/**
	 * the open Block ends at the caret, as editmd's splitBlock: the field's text becomes `head`, and the field moves on to
	 * a new Block after it holding `tail`, its caret at the start, the split one Undo step with the field's last change
	 * when that came within 500ms, as editmd's one transaction Yjs captures with it (`EditSession.split`); with no
	 * `tail`, an empty field opens after the Block (`openEditAfter`), which leaves nothing in the text when closed
	 * untouched. Return at the field's start splits nothing: the field keeps its text, the caret before it
	 */
	#splitField(head: string, tail: string): void {
		const session = this.#session
		if (!session) return
		if (head.trim() === '') {
			this.#replaceField(head + tail)
			this.#putCaret(head + tail, head.length)
			return
		}
		if (head !== this.#field) this.#writeField(head)
		if (tail.trim() === '') {
			const end = session.end
			session.close()
			const last = this.#document.blocks.findLastIndex((block) => block.start < end)
			this.#session = this.#document.openEditAfter(last)
			this.#newBlockSession = this.#session
			this.activeKind = 'paragraph'
		} else {
			this.#session = session.split(tail)
			this.#documentFile?.changed()
			this.activeKind =
				this.#document.blocks[this.#activeIndexOfSession() ?? -1]?.kind ?? 'paragraph'
		}
		this.activeSource = this.#field = this.#fieldOf(this.#session.source, this.#codeKind)
		this.fieldRevision++
		this.#sync()
		this.#putCaret(this.#field, 0)
	}

	/**
	 * the open field's caret goes to `at` in `text`, which the field was just mounted afresh with: a remounted field's
	 * caret is at its end, so only a caret before the end takes keys, once the field has them
	 */
	#putCaret(text: string, at: number): void {
		this.#lastCaret = at
		if (at === text.length) return
		const session = this.#session
		void this.#fieldReady(() => this.#session === session).then((ready) => {
			if (ready) this.#sendKeys(caretKeys(text, at))
		})
	}

	#writeField(field: string): void {
		this.#field = field
		this.#session?.update(this.#sourceOf(field))
		this.#documentFile?.changed()
		this.#sync()
	}

	/** the open field holds a code or mermaid Block, whose field shows its code alone once its fences are set */
	get #codeKind(): boolean {
		return this.activeKind === 'code' || this.activeKind === 'mermaid'
	}

	/**
	 * what a field opening on the Block source `source` shows: with `fenced`, a fenced Block's code alone, as editmd's code
	 * block node holds it (an indented code block has no fences and shows as it is), else `source`. sets `#fence`
	 */
	#fieldOf(source: string, fenced: boolean): string {
		this.#fence = fenced ? fenceParts(source) : null
		return this.#fence?.code ?? source
	}

	/** the Block source the open field's text `field` stands for: its code back between its fences (`withFences`) */
	#sourceOf(field: string): string {
		return this.#fence ? withFences(this.#fence, field) : field
	}

	/** how far into its Block source the open field's text starts: past the opening fence of a field holding code alone */
	get #shift(): number {
		return this.#fence?.open.length ?? 0
	}

	/** the open field's offset for `at` in its Block source, a fence's offset kept inside the code */
	#fieldCaret(at: number): number {
		return Math.min(Math.max(at - this.#shift, 0), this.#field.length)
	}

	/**
	 * the view gives the open field the keys through `focus`, which says whether the field mounted for `revision` (the
	 * `fieldRevision` it was mounted at) was there to take them
	 */
	onFocusField(focus: (revision: number) => boolean): () => void {
		this.#focusField = focus
		return () => {
			if (this.#focusField === focus) this.#focusField = null
		}
	}

	/**
	 * a click on the open mermaid Block's live diagram: the field gets the keys back with its caret at the end of the
	 * diagram's source, before its closing fence, as editmd's `editSource` puts it (diagrams.ts:169-177)
	 */
	caretToSourceEnd(): void {
		if (this.activeIndex === null || !this.#refocusField()) return
		const trailing = this.#field.endsWith('\n')
		const lines = this.#field.replace(/\n$/, '').split('\n')
		const fenced = lines.length > 2 && /^\s*(`{3,}|~{3,})\s*$/.test(lines.at(-1) ?? '')
		// from the field's end, up past a last empty line and the closing fence, then to that line's end
		const ups = (trailing ? 1 : 0) + (fenced ? 1 : 0)
		this.#sendKeys(`cmd-down${' up'.repeat(ups)}${ups > 0 ? ' cmd-right' : ''}`)
	}

	/** where each Block paints, one row per Block in order, as the view measures them; none until a view sets it */
	#blockRows: () => readonly Row[] = () => []

	/** set by the view: `rows` measures where the Blocks paint, for a drop's place among them; returns the unsubscribe */
	onBlockRows(rows: () => readonly Row[]): () => void {
		this.#blockRows = rows
		return () => {
			if (this.#blockRows === rows) this.#blockRows = () => []
		}
	}

	/**
	 * a probe, or the keys or value a command sends the open field, is in flight, or an outside change on its way into
	 * the field (`#showOutsideChange`)
	 */
	get fieldBusy(): boolean {
		return this.#fieldWork || this.#mergePending
	}

	/** the open field's keys go back to it, from a menu or a dialog that took them; false when no field is painted */
	#refocusField(): boolean {
		return this.#focusField?.(this.fieldRevision) ?? false
	}

	/**
	 * the open field once it has the keys, polled while a field mounted afresh has no node yet; false when none came,
	 * or once `still` says the field it waits for is gone (Source mode left, the Block's field closed) or a dialog is up,
	 * so a late poll never takes the keys from whatever has them since. a remounted field's caret is at its end until
	 * keys move it
	 */
	async #fieldReady(
		still: () => boolean = () => this.activeIndex !== null && !this.sourceMode
	): Promise<boolean> {
		for (let attempt = 0; attempt < FIELD_POLL_TRIES; attempt++) {
			if (!still() || this.overlay !== null) return false
			if (this.#refocusField()) return true
			await delay(FIELD_POLL_MS)
		}
		return false
	}

	/**
	 * send `keys` to the focused field and wait for the first value it reports that `accept` takes, while a probe
	 * holds what it reports; the last value reported, or null for none, when none is taken within `fieldReplyMs`
	 */
	#probeKeys(keys: string, accept: (value: string) => boolean): Promise<string | null> {
		return new Promise((resolve) => {
			let last: string | null = null
			const timer = setTimeout(() => finish(last), this.#fieldReplyMs)
			const finish = (value: string | null) => {
				clearTimeout(timer)
				this.#probeListener = null
				resolve(value)
			}
			this.#probeListener = (value) => {
				last = value
				if (accept(value)) finish(value)
			}
			this.#sendKeys(keys)
		})
	}

	/**
	 * the open field's selection, which gpuix does not report (gap G1), learnt through its keys: a sentinel typed
	 * over the selection shows where it was in the value the field reports, and cmd-z puts the text and the selection
	 * back. a second sentinel settles a first that matched the text beside it, or that was the selection itself: typed
	 * over itself it leaves the value as it was, which the field still reports, and its cmd-z still puts the selection
	 * back, so any report is the sentinel's answer. what the field reports meanwhile never
	 * reaches the Edit session. a cmd-z that took more than the sentinel (the field grouped it with typing just before
	 * it, as headless GPUI does) leaves the field set to its text again programmatically, the selection put back by keys.
	 * null when no field has the keys or the field did not answer. HAZARD: ⇧⌘Z after a probe brings the sentinel back,
	 * so a probe must be followed by an edit, or by `#settleProbe` when the command changes nothing
	 */
	async readSelection(): Promise<Range | null> {
		if (this.#probing || !this.#refocusField()) return null
		const before = this.#field
		const probes: Range[][] = []
		this.#probing = true
		try {
			for (const sentinel of SENTINELS) {
				const typed = await this.#probeKeys(sentinel, () => true)
				if (typed === null) {
					/**
					 * no reply in time: the sentinel may still be in the field and report late, so the field is set to the
					 * text from before the probe, mounted afresh, and the old field's reports are dropped (`typeInActive`)
					 */
					this.#remountField(before)
					return null
				}
				probes.push(selectionCandidates(before, typed, sentinel))
				const settled = settleSelection(probes)
				// cmd-z's one report, whatever it took back
				const restored = await this.#probeKeys('cmd-z', () => true)
				if (restored !== before) {
					this.#remountField(before)
					if (!settled || !(await this.#fieldReady())) return null
					this.#sendKeys(selectKeys(before, settled))
					return settled
				}
				if (settled) return settled
			}
			return null
		} finally {
			this.#probing = false
		}
	}

	/**
	 * the open field shows `field` afresh, a programmatic value with no undo or redo of its own, the Edit
	 * session left as it is; remounted, since an unchanged `value` prop would not reach the field
	 */
	#remountField(field: string): void {
		this.activeSource = field
		this.#field = field
		this.#lastCaret = field.length
		this.fieldRevision++
	}

	/**
	 * a probe was made and the command then changed nothing: the field is set to its own text again, which clears its
	 * undo and redo, so ⇧⌘Z cannot bring the probe's sentinel back, and its selection is put back where the probe found it
	 */
	async #settleProbe(range: Range): Promise<void> {
		const text = this.#field
		this.#remountField(text)
		if (await this.#fieldReady()) this.#sendKeys(selectKeys(text, range))
	}

	/** `work` on the open field, one at a time: a command that comes while one runs does nothing */
	async #onField(work: () => Promise<void>): Promise<void> {
		if (this.#fieldWork) return
		this.#fieldWork = true
		try {
			await work()
		} finally {
			this.#fieldWork = false
		}
	}

	/**
	 * Format > Bold, Italic, Strikethrough and Inline Code on the open Block field's selection, as editmd toggles a mark
	 * (editor.ts:95-99): the selection is read through the field's keys, then the keys that toggle the marks go to the
	 * field, so the selection and its native undo stay the field's own. editmd enables them only in its rich editor, so
	 * nothing happens in Source mode; with no Block's field open they act at editmd's load caret
	 */
	#toggleInline(format: InlineFormat): void {
		if (this.sourceMode) return
		if (this.activeIndex === null) {
			this.#toggleInlineAtLoadCaret(format)
			return
		}
		// editmd refuses marks in code, and its front matter box never takes Format: no probe, no sentinel
		if (!takesMarks(this.#sourceOf(this.#field))) return
		void this.#onField(async () => {
			this.#cutUndoStep()
			const range = await this.readSelection()
			if (!range) return
			const state = { text: this.#field, anchor: range.start, focus: range.end }
			const keys = toggleInlineKeys(state, format)
			// a selection of whitespace only gets no marks: no keys, and the probe settled so ⇧⌘Z brings no sentinel back
			if (keys === '') await this.#settleProbe(range)
			else this.#sendKeys(keys)
		})
	}

	/**
	 * an inline toggle with no field open, at editmd's load caret (`#openAtLoadCaret`), where editmd's caret sits: that
	 * Block's field opens and the toggle types its empty pair at the caret (`toggleInlineKeys`), so typing goes between
	 * the marks. editmd's mark at a caret is a stored mark, no text, so the pair comes out again if the field closes
	 * untouched (`#emptyPair`). where editmd takes no mark (code, Inline Code at a caret) the field closes again
	 */
	#toggleInlineAtLoadCaret(format: InlineFormat): void {
		const at = this.#openAtLoadCaret()
		if (at === null) return
		const state = { text: this.#field, anchor: at, focus: at }
		// a field holding code alone takes no marks, so `at` counts in its text only where that is the Block's own
		const keys = takesMarks(this.#sourceOf(state.text)) ? toggleInlineKeys(state, format) : ''
		if (keys === '') {
			this.closeEdit()
			return
		}
		this.#emptyPair = { text: applyKeys(state, keys).text, without: state.text }
		void this.#onField(async () => {
			if (await this.#fieldReady()) this.#sendKeys(`${caretKeys(state.text, at)} ${keys}`)
		})
	}

	/**
	 * the field's text with the empty pair an inline toggle typed at the load caret, and without it; null for none.
	 * nothing renders from it
	 */
	#emptyPair: { text: string; without: string } | null = null

	/** the open field is closing: an empty pair it still holds untouched comes out, as editmd's stored mark leaves no text */
	#dropEmptyPair(): void {
		if (this.#emptyPair?.text === this.#field) this.#writeField(this.#emptyPair.without)
		this.#emptyPair = null
	}

	/**
	 * Edit > Cut, Paste, Paste and Match Style and Select All, and Copy in a field: the field's own key, sent to it as
	 * AppKit sends the action to the first responder; the key itself (`editing`) the field already took
	 */
	#fieldKey(command: FieldCommand | 'copy', editing: boolean): void {
		if (editing || !this.#refocusField()) return
		if (command === 'copy' || command === 'paste') this.#echo = { command, at: Date.now() }
		this.#sendKeys(command === 'copy' ? 'cmd-c' : FIELD_KEYS[command])
	}

	/**
	 * the ⌘C or ⌘V a command last sent the field, and when: the window's key listener may hear it again as the Copy or
	 * Paste shortcut, which must not run twice
	 */
	#echo: { command: 'copy' | 'paste'; at: number } | null = null

	/**
	 * Edit > Paste and ⌘V: a focused field takes ⌘V as its own paste (`editing`) and an open one gets it from the menu;
	 * with no field open the field opens at editmd's caret (`#openAtLoadCaret`) and gets ⌘V there, as editmd pastes at
	 * its caret
	 */
	#paste(editing: boolean): void {
		if (editing || this.#fieldOpen) {
			this.#fieldKey('paste', editing)
			return
		}
		const at = this.#openAtLoadCaret()
		if (at === null) return
		const text = this.#field
		void this.#onField(async () => {
			if (!(await this.#fieldReady())) return
			this.#sendKeys(caretKeys(text, at))
			this.#fieldKey('paste', false)
		})
	}

	/** a field of the Document is open: a Block's or Source mode's, which has the keys unless a dialog took them */
	get #fieldOpen(): boolean {
		return this.activeIndex !== null || this.sourceMode
	}

	/**
	 * carry out a menu Command, from its shortcut (`commandFor`) or the command palette, which also runs the
	 * MenuOnlyCommands `commandFor` never returns (menu.ts lists them): the entries with no key in editmd
	 * (MainMenu.swift), such as Revert to Saved, and Open Recent, a submenu there, which joins them since there
	 * is no menu bar to hold the submenu (gap G2). `editing` is the key event's own flag, true while a text field
	 * has focus and gets the same key
	 */
	run(command: MenuCommand, { editing = false }: RunOptions = {}): void {
		// the Format commands are listed once, in app/commands.ts
		if (isFormatCommand(command)) this.#format(command)
		else this.#commands[command]({ editing })
	}

	/**
	 * what every other Command does in this window, so the table lists each one. undo and redo do nothing while a
	 * field is focused, so it keeps its native undo; bold, italic, strikethrough and code read the field's selection
	 * through its keys and toggle their marks with more keys
	 */
	#commands: Record<Exclude<MenuCommand, FormatCommand>, (options: Required<RunOptions>) => void> =
		{
			revert: () => this.revert(),
			openRecent: () => this.#showOverlay({ kind: 'openRecent', paths: this.#recentFiles.list() }),
			table: () => this.#insertBlock(TABLE),
			horizontalRule: () => this.#insertBlock(HORIZONTAL_RULE),
			loadRemoteImages: () => this.allowRemoteImages(),
			commandPalette: () => this.#showOverlay({ kind: 'commandPalette' }),
			save: () => this.#save(),
			saveAs: () => this.#showSaveAs(false),
			open: () => void this.#open(),
			// one Document per window and process (ADR-0008), so New is a new editor with no file
			new: () => this.#openWindow(null),
			close: () => this.#close(),
			/**
			 * ⌘Q: one Document per process (ADR-0008), so quitting is closing this window as NSDocument's quit closes each
			 * window: a file's unsaved edits are written first, an untitled Document's asked about, then the process ends
			 * through `closeWindow`. this runs only where GPUI's dispatch reaches it (headlessly): in a real window GPUI's
			 * own Quit takes ⌘Q before any listener and ends the process without Node's `exit` event, so the last second
			 * of typing is lost (gap G17, measured in a real window)
			 */
			quit: () => this.#close(),
			print: () => this.#print(),
			// the browser's print dialog, which Print opens, holds page setup too
			pageSetup: () => this.#print(),
			undo: ({ editing }) => this.#history('undo', editing),
			redo: ({ editing }) => this.#history('redo', editing),
			copy: ({ editing }) => this.#copy(editing),
			paste: ({ editing }) => this.#paste(editing),
			/**
			 * ⌥⇧⌘V: a focused field takes the key as its own paste, plain text either way; from the palette an open field
			 * gets ⌘V, as the menu sends it; with no field open it does nothing and is greyed
			 */
			pasteAndMatchStyle: ({ editing }) => this.#fieldKey('pasteAndMatchStyle', editing),
			// Find's bar is window chrome around the Document, so it goes to the window's FindController
			find: () => findController.show(),
			findNext: () => findController.findAgain('next'),
			findPrevious: () => findController.findAgain('previous'),
			bold: () => this.#toggleInline('bold'),
			italic: () => this.#toggleInline('italic'),
			strikethrough: () => this.#toggleInline('strikethrough'),
			code: () => this.#toggleInline('code'),
			link: () => this.#showAddLink(),
			toggleSource: () => this.#toggleSource(),
			// AppKit's View > Enter Full Screen, ⌃⌘F
			toggleFullScreen: () => this.#toggleFullScreen(),
			// View > Zoom scales the window's whole page, so it goes to the window's ThemeController
			zoomIn: () => themeController.zoomIn(),
			zoomOut: () => themeController.zoomOut(),
			actualSize: () => themeController.actualSize()
		}

	/** every menu item for the command palette, titled and enabled for this Document as editmd's `validateMenuItem` */
	paletteEntries = $derived(
		menuEntries({
			sourceMode: this.sourceMode,
			remoteImagesAllowed: this.remoteImagesAllowed,
			hasFile: this.hasFile,
			hasSelection: this.selectedText !== null,
			fieldFocused: this.#fieldOpen
		})
	)

	/**
	 * the command palette's Return or click on the entry for `command`: the palette closes first, so a command
	 * that opens a dialog of its own (Save As, Open Recent, Revert) replaces it, a queued notice waiting behind
	 * that dialog, and otherwise the notice shows once the command has run; a disabled entry does nothing
	 * and leaves the palette open, as a disabled menu item does
	 */
	runPaletteEntry(command: MenuCommand): void {
		if (this.overlay?.kind !== 'commandPalette') return
		const entry = this.paletteEntries.find((each) => each.command === command)
		if (!entry?.enabled) return
		this.#closeOverlayFor(() => this.run(command))
	}

	/** Open Recent's files as the menu bar lists them, newest first: read from the store each time a menu opens */
	recent = $state.raw<readonly string[]>([])

	/** the in-window menu bar's menus (gap G2), titled and enabled for this Document as editmd's `validateMenuItem` */
	menus = $derived(
		menuBar({
			sourceMode: this.sourceMode,
			remoteImagesAllowed: this.remoteImagesAllowed,
			recent: this.recent,
			hasFile: this.hasFile,
			hasSelection: this.selectedText !== null,
			fieldFocused: this.#fieldOpen
		})
	)

	/** a click on menu `index`'s title, or the pointer moving onto it while another menu is open: it drops down */
	openMenu(index: number): void {
		this.recent = this.#recentFiles.list()
		this.#showOverlay({ kind: 'menu', index })
	}

	/**
	 * a key equivalent: run as `run` does, except that a dialog keeps the keys from the Document, as editmd's
	 * sheets do, while an open menu closes first, as AppKit's menu tracking ends on a key equivalent
	 */
	runShortcut(command: MenuCommand, options: RunOptions = {}): void {
		// a probe's cmd-z, and the ⌘C or ⌘V a command sent the field, are the field's own, whichever listener hears them too
		if (this.#probing) return
		if (command === this.#echo?.command && Date.now() - this.#echo.at < ECHO_MS) return
		if (this.overlay?.kind === 'menu') this.#closeOverlayFor(() => this.run(command, options))
		else if (this.overlay === null) this.run(command, options)
	}

	/**
	 * a click (or Return) on an open menu's item, or on a Help search match: the menu closes first, so a command
	 * that opens a dialog of its own replaces it, as `runPaletteEntry`. a disabled item, or one that only holds a
	 * submenu, does nothing and leaves the menu open, as AppKit's
	 */
	runMenuItem({ command, enabled, path }: MenuChoice): void {
		if (this.overlay?.kind !== 'menu' || !enabled || command === null) return
		this.#closeOverlayFor(() => this.#runBarCommand(command, path))
	}

	/** what a menu bar item does: a window action, an Open Recent entry, or a MenuCommand through `run` */
	#runBarCommand(command: BarCommand, path: string | undefined): void {
		if (command === 'minimize') this.#minimizeWindow()
		else if (command === 'zoomWindow') this.#zoomWindow()
		// every window comes forward, as editmd's `arrangeInFront` raises every window of its one process (MainMenu.swift:121)
		else if (command === 'bringAllToFront') {
			this.#activateWindow()
			void bringAllToFront(this.#socketsDirectory, this.#ownSocket)
		} else if (command === 'clearRecent') this.#recentFiles.clear()
		else if (command === 'cut' || command === 'pasteAndMatchStyle' || command === 'selectAll')
			this.#fieldKey(command, false)
		// an Open Recent file opens as the Open Recent list's choosing does
		else if (command === 'openRecent' && path !== undefined) this.#openDocument(path)
		else this.run(command)
	}

	/**
	 * Edit > Undo and Redo: a focused field (`editing`) keeps its native undo (ADR-0004). from the menu or the palette
	 * with a field open (a Block's, or Source mode's, which holds the whole text) the field gets its own ⌘Z or ⇧⌘Z,
	 * as Cut and Paste send theirs, so one step goes back and the field stays open, as editmd undoes one step in its
	 * editor. with no field open the Document takes back its last Undo step
	 */
	#history(direction: 'undo' | 'redo', editing: boolean): void {
		if (editing) return
		if (this.#fieldOpen) {
			if (this.#refocusField()) this.#sendKeys(direction === 'undo' ? 'cmd-z' : 'cmd-shift-z')
			return
		}
		const changed = direction === 'undo' ? this.#document.undo() : this.#document.redo()
		if (!changed) return
		this.#documentFile?.changed()
		this.#sync()
	}

	/**
	 * Edit > Copy and ⌘C: the painted text's selection goes on the pasteboard as editmd's clipboard serializer writes it
	 * (`copiedText`: as it reads inside one text node, else as markdown with a final newline). a focused field copies its
	 * own selection natively (`editing`); from the menu, an open field with no painted text selected gets its own ⌘C.
	 * with nothing selected nothing happens
	 */
	#copy(editing: boolean): void {
		if (editing) return
		if (this.selectedText !== null) this.#writeClipboard(copiedText(this.text, this.selectedText))
		else if (this.#fieldOpen) this.#fieldKey('copy', false)
	}

	/**
	 * File > Save: the open file is written now; the label follows through the file's `onUpdate`. a save that fails
	 * presents its error as editmd's `save(_:)` does (Document.swift:168-178), NSDocument's alert over the window;
	 * an autosave that fails only says Not Saved, as in editmd
	 */
	#save(): void {
		// an untitled Document has nowhere to go yet, so Save is Save As, as NSDocument's
		if (!this.#documentFile) {
			this.#showSaveAs(false)
			return
		}
		const error = this.#documentFile.save()
		if (error) this.#showSaveError(error, false)
	}

	/**
	 * a save's error as NSDocument presents it, on File > Save and on the close question's Save alike: a locked file
	 * asks to save anyway, closing the window once written when `closeAfter`; any other failure alerts
	 */
	#showSaveError(error: Error, closeAfter: boolean): void {
		if (error instanceof FileLockedError)
			this.#showOverlay({ kind: 'saveLocked', documentName: this.#documentName, closeAfter })
		else this.#showOverlay({ kind: 'saveFailed', ...saveFailure(this.#documentName, error) })
	}

	/**
	 * the locked-file question's Save Anyway: the file is written all the same and keeps its mode, as editmd's NSDocument
	 * does (`DocumentFile.saveAnyway`), and the window closes when the close question asked; a write that still fails
	 * shows the save alert
	 */
	saveAnyway(): void {
		if (this.overlay?.kind !== 'saveLocked' || !this.#documentFile) return
		const documentFile = this.#documentFile
		const { closeAfter } = this.overlay
		this.#closeOverlayFor(() => {
			const error = documentFile.saveAnyway()
			if (error)
				this.#showOverlay({ kind: 'saveFailed', ...saveFailure(this.#documentName, error) })
			else if (closeAfter && !this.#document.isDirty) this.#closeWindow()
		})
	}

	/** File > Open…: every picked file opens as a Document of its own (`#openDocument`); a cancel opens nothing */
	async #open(): Promise<void> {
		const paths = await this.#choosePaths()
		for (const path of paths ?? []) this.#openDocument(path)
	}

	/**
	 * open the file at `path` as NSDocumentController does: into this window while it holds an untouched
	 * untitled Document, which AppKit opens at launch and replaces with the first file opened, and into a new
	 * window otherwise, a window File > New opened included (`startedByNew`); either way it goes to the top of Open Recent. AppKit's replacing is read from its
	 * documented behaviour and not checked against a running editmd. a file that cannot be read as text stays
	 * out of Open Recent, leaves the window as it was and shows NSDocumentController's alert; a new window's
	 * file is read here first, so the alert shows in the window that asked rather than a window that never opens
	 */
	#openDocument(path: string): void {
		// a window File > New opened is never the launch's untitled one, so AppKit opens beside it
		const intoThisWindow =
			!this.#startedByNew && this.#documentFile === null && !this.#document.isDirty
		try {
			// the window stays the same window, so what it was set to (Load Remote Images) holds for the file
			if (intoThisWindow) this.#openFile(path, this.#options)
			else openTextFile(path)
		} catch (error) {
			this.#showOpenFailure(path, error)
			return
		}
		if (intoThisWindow) this.#setWindowTitle(basename(path))
		else void this.#openInNewWindow(path)
		this.#recentFiles.add(path)
	}

	/** an entry of the Open Recent list: it opens as Open… would open it, and the list closes */
	openRecentFile(path: string): void {
		if (this.overlay?.kind !== 'openRecent') return
		this.#closeOverlayFor(() => this.#openDocument(path))
	}

	/** Open Recent's Clear Menu: the list is emptied for every window, and closes */
	clearRecentFiles(): void {
		if (this.overlay?.kind !== 'openRecent') return
		this.#recentFiles.clear()
		this.closeOverlay()
	}

	/**
	 * files dropped at height `y` (window coordinates) on the Blocks painted at `rows`, one per Block in order,
	 * as editmd's EditorBridge `drop`: the images go in as one run of links after the Block nearest the drop
	 * (`insertAfterIndexAt`), as one Undo step; every other file opens as a link to it would, a text file as a
	 * Document. outside Source mode an image's drop closes any Edit session first, so its typing stays an Undo step
	 * of its own; a drop that inserts nothing leaves the open field as it was, as editmd's drop of a non-image never
	 * touches its editor. GPUI turns a drop on an element with a click and no file drop of its own into that click
	 * (measured headless), so every element in a Block that takes clicks takes drops too. `rows` defaults to where
	 * the view last painted the Blocks (`onBlockRows`), for a drop on an element inside a Block
	 */
	dropFiles(paths: readonly string[], y: number, rows: readonly Row[] = this.#blockRows()): void {
		const { markdown, others } = sortDrop(paths, this.folder, this.#isImageName)
		if (markdown !== null) {
			if (!this.sourceMode) this.closeEdit()
			if (this.sourceMode) this.#dropIntoSource(markdown)
			else this.#document.insertBlockAfter(insertAfterIndexAt(y, rows), markdown)
			this.#documentFile?.changed()
			this.#sync()
		}
		for (const path of others) this.#openDropped(path)
	}

	/**
	 * Source mode's field has no caret to drop at (gap G1), so the images go after the last Block; its session
	 * closes around the insert and opens again on the new text, which the field then shows
	 */
	#dropIntoSource(markdown: string): void {
		this.#session?.close()
		this.#document.insertBlockAfter(this.#document.blocks.length - 1, markdown)
		this.#session = this.#document.openSourceEdit()
		this.activeSource = this.#field = this.#fieldOf(this.#session.source, false)
	}

	/** a dropped file that is no image: a text file opens as a Document, anything else is shown in Finder (LinkPolicy) */
	#openDropped(path: string): void {
		const action = linkAction(pathToFileURL(path).href, this.#describeFile, this.#isTextName)
		if (action.kind === 'openInEditor') this.#openDocument(action.path)
		else carryOutLink(action, this.#run, this.#openInEditor)
	}

	/**
	 * File > Save As: the panel starts on the file's own name in its folder, or on the untitled window's name
	 * (Untitled.md, Untitled 2.md) in ~/Documents, where NSSavePanel starts an untitled document
	 */
	#showSaveAs(closeAfter: boolean): void {
		const path = this.#documentFile?.path ?? null
		this.#showOverlay({
			kind: 'saveAs',
			name: path ? basename(path) : `${this.#documentName}.md`,
			folder: path ? dirname(path) : join(homedir(), 'Documents'),
			replacing: null,
			failure: null,
			closeAfter
		})
	}

	/**
	 * File > Close, as editmd's Document `canClose`: a file with unsaved edits saves them instead of asking,
	 * and asks only when that save fails, so nothing is lost silently; an untitled Document with edits asks;
	 * an untouched Document closes at once
	 */
	#close(): void {
		if (this.#document.isDirty) this.#documentFile?.save()
		this.#sync()
		if (!this.#document.isDirty) {
			this.#closeWindow()
			return
		}
		this.#showOverlay({
			kind: 'saveChanges',
			documentName: this.#documentName,
			untitled: this.#documentFile === null
		})
	}

	/**
	 * the close question's Save (Save… for an untitled Document, which goes through Save As and closes once
	 * written); the window closes when the save worked. a save that fails again shows its error in place of the
	 * question and keeps the window, as NSDocument presents it once editmd hands it the question
	 * (Document.swift:195-197)
	 */
	saveChanges(): void {
		if (this.overlay?.kind !== 'saveChanges') return
		if (!this.#documentFile) {
			this.#showSaveAs(true)
			return
		}
		const error = this.#documentFile.save()
		this.#sync()
		if (error) {
			this.#closeOverlayFor(() => this.#showSaveError(error, true))
			return
		}
		if (this.#document.isDirty) return
		this.closeOverlay()
		this.#closeWindow()
	}

	/** the close question's Don't Save: the window closes, the edits go with it, the exit that follows saving nothing */
	discardChanges(): void {
		if (this.overlay?.kind !== 'saveChanges') return
		this.#discarded = true
		this.closeOverlay()
		this.#closeWindow()
	}

	/**
	 * the process is exiting (the window's close button, gpuix's Close Window or Quit: gpuix has no close hook, and
	 * its frame loop exits the process once the last window has closed). a file with unsaved edits saves them, as
	 * editmd's `canClose` saves instead of asking (Document.swift:180-204); the save is synchronous, so it lands
	 * before the process ends. an untitled Document's edits cannot be kept: asking needs a window, and by the time
	 * the process exits gpuix has closed it, so they go, which only a close hook in gpuix could prevent
	 */
	#saveBeforeExit(): void {
		if (!this.#documentFile || !this.#document.isDirty || this.#discarded) return
		this.#exiting = true
		this.#documentFile.save()
	}

	/**
	 * File > Print (gap G5: GPUI cannot print): the Document as a standalone HTML page, rendered by the one
	 * markdown engine and titled with the Document's name, handed to `open`, so the browser prints it
	 */
	#print(): void {
		this.#run('open', [this.#writePrintable(this.text, this.#documentName, this.folder)])
	}

	/**
	 * File > Revert to Saved asks first, as NSDocument does; editmd enables it only for a file with unsaved
	 * edits, so it does nothing otherwise
	 */
	revert(): void {
		if (!this.#documentFile || !this.#document.isDirty) return
		this.#showOverlay({ kind: 'revert', documentName: this.#documentName })
	}

	/**
	 * the revert question's Revert: the text on disk replaces the unsaved edits (`DocumentFile.revert`). any
	 * Edit session closes first and Source mode ends, so no field keeps showing the dropped text. a file that cannot
	 * be read (deleted, unreadable) keeps the Document as it was, and its failure shows as NSDocument presents a
	 * failed revert, in NSDocumentController's open-failure alert
	 */
	revertConfirmed(): void {
		if (this.overlay?.kind !== 'revert' || !this.#documentFile) return
		this.closeOverlay()
		this.closeEdit()
		this.sourceMode = false
		const error = this.#documentFile.revert()
		this.#sync()
		if (error) this.#showOpenFailure(this.#documentFile.path, error)
	}

	/** the Save As dialog's folder button: the picker's choice replaces the folder, a cancel keeps it */
	async chooseSaveFolder(): Promise<void> {
		const folder = await this.#chooseFolder()
		if (folder === null || this.overlay?.kind !== 'saveAs') return
		this.overlay = { ...this.overlay, folder, failure: null }
	}

	/**
	 * the Save As dialog's Save with the typed `name` (`saveAsPath`: a bare name gets the document's own type, `.md`
	 * for markdown or untitled, a text file's own extension); a blank name, or one that would leave the folder, saves
	 * nothing. ignored while the replace question is up, so a second Return cannot answer it
	 */
	saveAs(name: string): void {
		if (this.overlay?.kind !== 'saveAs' || this.overlay.replacing !== null) return
		// a text document keeps its type as NSDocument does: its own extension, `.md` when untitled
		const path = saveAsPath(this.overlay.folder, name, this.#documentFile?.path ?? null)
		if (path) this.#saveTo(path, false)
	}

	/** the replace question's Replace: write over the existing file after all */
	replaceFile(): void {
		if (this.overlay?.kind !== 'saveAs' || this.overlay.replacing === null) return
		this.#saveTo(this.overlay.replacing, true)
	}

	/** the replace question's Cancel: back to the Save As dialog, its name kept, nothing written */
	cancelReplace(): void {
		if (this.overlay?.kind !== 'saveAs') return
		this.overlay = { ...this.overlay, replacing: null }
	}

	/**
	 * write the Document to `path` and work on that file from now on: an opened file moves there
	 * (`DocumentFile.saveAs`), an untitled Document gets its first file with the same Document, so its undo
	 * history and highlights carry over (`DocumentFile.create`). an existing file is only written over with
	 * `replace`; without it the dialog asks first. any other failure stays in the dialog, as presentError would
	 */
	#saveTo(path: string, replace: boolean): void {
		const overlay = this.overlay
		if (overlay?.kind !== 'saveAs') return
		try {
			if (this.#documentFile) {
				this.#documentFile.saveAs(path, { replace })
				this.#watch(this.#documentFile)
			} else {
				// the untitled window's own, so a Report it heard before Save As still credits the file's first writes
				const attribution = this.#attribution
				this.#adopting = true
				try {
					this.#documentFile = DocumentFile.create(
						path,
						this.#document,
						...this.#fileHooks(attribution),
						{
							replace
						}
					)
				} finally {
					this.#adopting = false
				}
				this.#follow(this.#documentFile, attribution)
				this.#releaseUntitled()
			}
		} catch (error) {
			this.overlay =
				error instanceof FileExistsError
					? { ...overlay, replacing: path, failure: null }
					: {
							...overlay,
							replacing: null,
							failure: error instanceof Error ? error.message : String(error)
						}
			this.#sync()
			return
		}
		this.closeOverlay()
		// NSDocument notes a saved-as file as recent, as it does an opened one
		this.#recentFiles.add(path)
		// the window's title follows the file through the sync, its name and no Edited mark now it is saved
		this.#sync()
		if (overlay.closeAfter) this.#closeWindow()
	}

	/**
	 * View > Source: entering closes any Edit session and opens one over the whole text, so the source field
	 * types through `typeInActive` and a Disk merge defers into it like a Block's; leaving closes it, and the
	 * Blocks paint the Document again. only Cmd-/ toggles, as in editmd. entering drops every highlight, and with
	 * them the legend, as editmd's `destroyRich` does (web/src/editor.ts:313, 537-548); `#sync` keeps them dropped.
	 * either way the undo history starts over, as editmd builds its editor anew (web/src/editor.ts:303-320)
	 */
	#toggleSource(): void {
		this.#dropEmptyPair()
		this.#session?.close()
		this.#session = null
		this.activeIndex = null
		this.activeIsNew = false
		this.#document.forgetHistory()
		if (this.sourceMode) {
			this.sourceMode = false
			return
		}
		this.#session = this.#document.openSourceEdit()
		this.activeSource = this.#field = this.#fieldOf(this.#session.source, false)
		this.sourceMode = true
		this.#sync()
		// editmd puts Source mode's caret at the start (`setSelectionRange(0, 0)`, editor.ts:318-322)
		void this.#fieldReady(() => this.sourceMode).then((ready) => {
			if (ready) this.#sendKeys('cmd-up')
		})
	}

	/**
	 * the Block of the last closed Edit session (`#lastPlace`) while it is as that session left it, where editmd's caret
	 * stayed with no field open; null once it changed or with none
	 */
	#lastPlaceIndex(): number | null {
		const last = this.#lastPlace
		const block = last ? this.#document.blocks[last.index] : undefined
		if (!last || !block) return null
		return this.#document.text.slice(block.start, block.end) === last.text ? last.index : null
	}

	/**
	 * Format > Table and Horizontal Rule: `source` goes in as a new Block after the Active block; with none active,
	 * after the Block of the last closed Edit session while it is as that session left it, where editmd's caret stayed
	 * (`#lastPlaceIndex`, as the other Format commands find it), else before the first Block, where editmd's caret sits
	 * once a Document loads (measured in editmd's own editor: its table and rule go in above the first paragraph). one
	 * Undo step; the Edit session closes first, so its typing stays an Undo step of its own. no field opens on the new
	 * Block: a focused <textarea> takes Cmd-Z as its own native undo before any listener hears it (measured headless),
	 * and editmd's one Cmd-Z takes the insert back. editmd disables Format in Source mode, so it does nothing there.
	 * a table at a list goes under the list's last item instead (`underLastItem`), as editmd nests it there (measured
	 * in editmd's own editor); a rule keeps a Block of its own
	 */
	#insertBlock(source: string): void {
		if (this.sourceMode) return
		// a new Block's empty field sits after the Block before its index
		const active = this.activeIndex === null ? null : this.activeIndex - (this.activeIsNew ? 1 : 0)
		const index = active ?? this.#lastPlaceIndex() ?? -1
		this.closeEdit()
		const block = this.#document.blocks[index]
		if (source === TABLE && block?.kind === 'list') {
			const list = this.#document.text.slice(block.start, block.end)
			this.#document.editBlock(index, underLastItem(list, TABLE))
		} else this.#document.insertBlockAfter(index, source)
		this.#documentFile?.changed()
		this.#sync()
	}

	/**
	 * where editmd's caret sits with no field open, whose Block's field opens so a command acts there: in the Block of
	 * the last closed Edit session while it is as that session left it (`#lastPlace`), at the end of its text, where the
	 * port's field leaves its caret (gpuix reports no caret, gap G1); else editmd's load caret, the start of the text of
	 * the first Block that holds text (`firstTextOffset`; front matter, rules and definitions have none); an empty
	 * Document's first field opens as its hint's click would. with no Block holding text editmd's caret sits in the empty
	 * paragraph Milkdown's `trailing` plugin keeps after the last Block (web/src/editor.ts:482), so a new Block's empty
	 * field opens there, as Return's does (`openEditAfter`), and goes again when closed untouched. the caret's offset in
	 * that Block's text, or null in Source mode, when nothing opens
	 */
	#openAtLoadCaret(): number | null {
		if (this.sourceMode) return null
		const blocks = this.#document.blocks
		const lastIndex = this.#lastPlaceIndex()
		if (lastIndex !== null) {
			this.openBlock(lastIndex)
			return this.#shift + this.#field.length
		}
		this.#lastPlace = null
		if (blocks.length === 0) {
			this.startWriting()
			return this.activeIndex === null ? null : 0
		}
		for (const [index, block] of blocks.entries()) {
			const at = firstTextOffset(this.#document.text.slice(block.start, block.end))
			if (at === null) continue
			this.openBlock(index)
			return at
		}
		this.#session?.close()
		this.#session = this.#document.openEditAfter(blocks.length - 1)
		this.#newBlockSession = this.#session
		this.activeKind = 'paragraph'
		this.activeSource = this.#field = this.#fieldOf('', false)
		this.#lastCaret = 0
		this.#sync()
		return 0
	}

	/**
	 * Tab or Shift-Tab in the open Block field (`pressTab`), which gpuix would take to move focus: true when the key is
	 * taken here, so the view keeps the field focused. the Block's kind is read as it is now, so a list typed into a
	 * paragraph's field takes Indent; Indent and Outdent run as Format's do. a new Block's empty field has no kind yet,
	 * the Block at its index being the one after it. in a table the key goes to the next cell, Shift to the one before
	 * (`#tabInTable`)
	 */
	tabInField(key: string, modifiers: Modifiers): boolean {
		const kind = this.activeIsNew ? undefined : this.blocks[this.activeIndex ?? -1]?.kind
		const effects: TabEffects = {
			type: this.#sendKeys,
			focus: () => this.#refocusField(),
			format: (command, refused) => this.#format(command, refused)
		}
		if (kind !== 'table' || tabAction(key, modifiers, kind) === null)
			return pressTab(key, modifiers, kind, effects)
		this.#tabInTable(modifiers.shift, () => pressTab(key, modifiers, kind, effects))
		return true
	}

	/**
	 * Tab in a table field selects the next cell's text, Shift-Tab the previous one's, as editmd's table keymap's
	 * goToNextCell (preset-gfm table/input.ts:229-246): the caret is read first (`readSelection`). before the first cell
	 * and past the last `outside` runs, today's Tab; a probe followed by no edit is settled, so ⇧⌘Z brings no sentinel back
	 */
	#tabInTable(backward: boolean, outside: () => void): void {
		void this.#onField(async () => {
			const range = await this.readSelection()
			if (!range) return
			const cell = tableCellStep(this.#field, range.start, backward)
			if (cell) await this.#settleProbe(cell)
			else if (backward) await this.#settleProbe(range)
			else outside()
		})
	}

	/**
	 * a Format command rewrites the Active block's field; with none open it acts at editmd's load caret
	 * (`#openAtLoadCaret`). in Source mode it does nothing, and so does a command editmd refuses or that changes nothing
	 * (`formatBlock` gives null): no remount, no change, and a field opened for it closes again. on an open field it is an
	 * Undo step of its own (`#cutUndoStep`). the open field's caret is read first (`readSelection`), as it decides what
	 * the command does in an item or a paragraph of a list or quote, and the caret is put back where the command moved
	 * its text; a command no caret changes still runs when the field does not answer. `refused` runs once an open field's
	 * command gives null
	 */
	#format(command: FormatCommand, refused?: () => void): void {
		if (this.sourceMode) return
		if (this.activeIndex === null) {
			const caret = this.#openAtLoadCaret()
			if (caret === null) return
			const before = this.#sourceOf(this.#field)
			const result = formatBlock(command, before, caret)
			if (result !== null) this.#formatTo(before, result, caret)
			else this.closeEdit()
			return
		}
		this.#cutUndoStep()
		const source = this.#sourceOf(this.#field)
		const outcomes = lineEndsOf(source).map((caret) => formatBlock(command, source, caret))
		const caretFree = outcomes.every((outcome) => outcome === outcomes[0])
		// a command refused at every caret needs no probe, so ⇧⌘Z has no sentinel to bring back
		if (caretFree && outcomes[0] === null) {
			refused?.()
			return
		}
		void this.#onField(async () => {
			const range = await this.readSelection()
			if (!range && !caretFree) return
			const before = this.#sourceOf(this.#field)
			const caret = range ? range.start + this.#shift : undefined
			const result = formatBlock(command, before, caret)
			if (result === null) {
				if (range) await this.#settleProbe(range)
				refused?.()
				return
			}
			this.#formatTo(before, result, caret)
		})
	}

	/**
	 * the open field shows `result`, a Format command's rewrite of the Block source `before`, its caret at `at` mapped
	 * through the command, as editmd's ProseMirror maps a cursor (assoc 1): syntax put in right at the caret goes before
	 * it, so typing goes on after `## `. with no caret known the field's caret stays at its end
	 */
	#formatTo(before: string, result: string, at: number | undefined): void {
		this.#replaceField(result)
		if (at !== undefined)
			this.#putCaret(
				this.#field,
				this.#fieldCaret(caretPastInsertions(textEdits(before, result), at))
			)
	}

	/**
	 * a command run while a Block's field is open is an Undo step of its own, as editmd's commands are: the Edit session
	 * closes, keeping the typing before it as one step, and opens again on the same Block. the field stays mounted
	 * unless the Block's text changed on closing (a reference written inline) or the field held several Blocks, when it
	 * shows the Block's text afresh. a new Block's empty field (`activeIsNew`) has nothing typed to keep, and closing it
	 * would take the Block away, so it stays open
	 */
	#cutUndoStep(): void {
		const index = this.activeIndex
		if (index === null || this.sourceMode || !this.#session || this.activeIsNew) return
		this.#session.close()
		this.#session =
			this.#document.blocks.length === 0
				? this.#document.openSourceEdit()
				: this.#document.openEdit(Math.min(index, this.#document.blocks.length - 1))
		this.#sessionEnd = this.#session.end
		const { source } = this.#session
		if (source !== this.#sourceOf(this.#field))
			this.#remountField(this.#fieldOf(source, this.#fence !== null))
		this.#sync()
	}

	/**
	 * Format > Link… (⌘K): editmd's Add Link sheet, its field prefilled with the pasteboard's URL
	 * (EditorWindowController.swift:115-150). editmd disables it in Source mode with the rest of Format
	 * (`validateMenuItem`), so it opens nothing there
	 */
	#showAddLink(): void {
		if (this.sourceMode) return
		this.#showOverlay({ kind: 'addLink', url: this.#readClipboardUrl() ?? '' })
	}

	/**
	 * the sheet's Add with the typed `url`: the sheet closes. with a Block's field open, the field takes the keys back,
	 * its selection is read (`readSelection`) and the link goes in there as editmd's `toggleLink` puts it
	 * (`linkAtSelection`: the selection its text, a caret its own link, Edit Link inside one), an Undo step of its own;
	 * the field shows it afresh, its caret moved to just after the link. an empty URL takes the link at the caret or
	 * across the selection off, as editmd's Add with nothing in the field does (EditorWindowController.swift:133-134,
	 * web/src/editor.ts:380-386). with no Active block it goes in at editmd's load caret (`#openAtLoadCaret`), the URL
	 * its own link text there, and that Block's field opens on it
	 */
	addLink(url: string): void {
		if (this.overlay?.kind !== 'addLink') return
		this.#closeOverlayFor(() => {
			if (this.sourceMode) return
			if (this.activeIndex !== null) {
				this.#linkAtSelection(url)
				return
			}
			const at = this.#openAtLoadCaret()
			if (at === null) return
			const source = linkAtSelection(this.#sourceOf(this.#field), { start: at, end: at }, url)
			if (source !== null) this.#replaceField(source)
			else this.closeEdit()
		})
	}

	/**
	 * Add Link on the open Block field's selection, read when Add is pressed, never on ⌘K (a redo hazard). a
	 * Block that takes no link anywhere (front matter, a definition, a rule: `linkAtSelection` refuses even a caret)
	 * changes nothing and reads nothing, and so does an empty URL on a field holding no link to take off. a selection in
	 * code, which it refuses only once read, and a caret outside any link for an empty URL set the field to its own
	 * text again (`#settleProbe`), so ⇧⌘Z cannot bring the probe's sentinel back
	 */
	#linkAtSelection(url: string): void {
		const unlinking = url.trim() === ''
		const whole = this.#sourceOf(this.#field)
		const anywhere = { start: 0, end: unlinking ? whole.length : 0 }
		if (linkAtSelection(whole, anywhere, url) === null) return
		void this.#onField(async () => {
			this.#cutUndoStep()
			const range = await this.readSelection()
			if (!range) return
			const before = this.#sourceOf(this.#field)
			const end = range.end + this.#shift
			const source = linkAtSelection(before, { start: range.start + this.#shift, end }, url)
			if (source === null) {
				await this.#settleProbe(range)
				return
			}
			this.#replaceField(source)
			if (!(await this.#fieldReady())) return
			/**
			 * a link taken off keeps the caret in the same text, the syntax around it gone; a link put in ends where the
			 * text after the selection, which stays as it was, now starts
			 */
			const caret = unlinking
				? caretThrough(textEdits(before, source), end)
				: source.length - (before.length - end)
			this.#sendKeys(caretKeys(this.#field, this.#fieldCaret(caret)))
		})
	}

	/**
	 * put the Block source `source` into the open field and the Document. a programmatic value moves the field's caret
	 * to the end and clears its native undo (ADR-0004); acceptable for a Format command, which rewrites the
	 * whole Block anyway. the field is remounted rather than handed a new `value`: when `source` equals what
	 * the field opened with, the prop would not change and the field would keep its typed text (measured
	 * headlessly, also with `flushSync` and `commit` between two writes). the field takes the new kind, a code
	 * Block's code alone (`#fieldOf`)
	 */
	#replaceField(source: string): void {
		this.#fence = null
		this.#writeField(source)
		const kind = this.activeIndex === null ? undefined : this.blocks[this.activeIndex]?.kind
		if (kind) this.activeKind = kind
		this.#remountField(this.#fieldOf(source, this.#codeKind))
	}

	/** drop one Agent's highlights and Deletion lines, or every Agent's: the legend's × and Clear all */
	clearHighlights(authorId?: string): void {
		this.#document.clearHighlights(authorId)
		this.#sync()
	}

	/**
	 * the legend's rename field kept `name`: the Agent shows it from now on, its later changes included, as
	 * editmd's `Agents.rename`. a blank or unchanged name, or Outside edit, which has no id, renames nothing.
	 * as editmd's `AgentEdits.rename` (AgentEdits.swift:39-45), every other window hears of it over the agent
	 * sockets, each its own process (ADR-0008)
	 */
	renameAgent(id: string, name: string): void {
		const trimmed = name.trim()
		const shown = this.agents.find((agent) => agent.id === id)?.name
		if (trimmed === '' || trimmed === shown || !this.#agentLegend.rename(id, trimmed)) return
		this.#agentNames.set(id, trimmed)
		this.agents = this.#agentLegend.agents(this.highlights, this.deletions)
		void sendRename(this.#socketsDirectory, { id, name: trimmed }, this.#ownSocket)
	}

	/**
	 * another window renamed the Agent `id`: its row here, if it has one, shows `name`, and so does its first change
	 * here if it has none yet, as editmd's `Document.agentRenamed` and `AgentEdits.names`
	 */
	#renamed(id: string, name: string): void {
		this.#agentNames.set(id, name)
		if (this.#agentLegend.rename(id, name))
			this.agents = this.#agentLegend.agents(this.highlights, this.deletions)
	}

	/**
	 * the legend's click on an Agent's name: its next changed Block scrolls into view, cycling back to the first,
	 * as editmd's `reveal` (highlights.ts:131-142), which scrolls the change's top to the middle of the window: one of
	 * several changes in a Block puts its own first run there (`coordsAtPos(at)`), the only change of runs its first
	 * run, any other the Block's top; it opens no editor. a Deletion's stop is the Block below its line
	 */
	revealAgent(id: string): void {
		// one stop per change and per Deletion, as editmd's reveal steps (`nextStop`)
		const stop = this.#agentLegend.nextStop(id, this.highlights, this.blocks, this.deletions)
		if (stop) this.#revealBlock?.(stop.index, 'middle', stop.run ?? stop.highlight?.runs?.[0])
	}

	/**
	 * the legend's – shrinks it to the pill, and a click on the pill shows the rows again; either is kept in the
	 * store, so the next window and the next launch start the same, as editmd keeps it in localStorage
	 */
	minimizeLegend(minimized: boolean): void {
		this.#legendMinimized = minimized
		this.#legendPreference.setMinimized(minimized)
	}

	/** a local image's natural size, read once per path while this Document is open; null when unknown */
	imageSizeOf(path: string): Size | null {
		return this.#imageSizes.sizeOf(path)
	}

	/**
	 * no file at a local image's path, read once per path as `imageSizeOf`: the View paints its alt text, small, as
	 * WebKit paints a broken image, where a file of unknown size keeps the fallback box
	 */
	isImageMissing(path: string): boolean {
		return this.#imageSizes.isMissing(path)
	}

	/**
	 * a loaded remote image's natural size, read from its bytes as a local image's header is (`imageSize`), since GPUI's
	 * <img> needs explicit dimensions; null until they came, or when they hold no image. its bytes are asked for once
	 * per URL while this Document is open
	 */
	remoteImageSizeOf(url: string): Size | null {
		if (!this.#remoteAsked.has(url)) {
			this.#remoteAsked.add(url)
			const sizes = this.#remoteSizes
			const failed = this.#remoteFailed
			this.#fetchImage(url).then(
				(bytes) => {
					const size = imageSize(bytes)
					if (size) sizes.set(url, size)
					else failed.add(url)
				},
				// an image that cannot be fetched (a 404, no answer) is a broken one, which paints its alt text
				() => void failed.add(url)
			)
		}
		return this.#remoteSizes.get(url) ?? null
	}

	/**
	 * a remote image that could not be loaded once allowed: no answer, an error such as a 404, or bytes that hold no
	 * image. ImageView paints its alt text, as for a missing local file, where GPUI's <img> would paint its own
	 * "img: load failed" box in the fixed size and push the text aside
	 */
	isRemoteImageFailed(url: string): boolean {
		return this.#remoteFailed.has(url)
	}

	/** the remote images' sizes as they come, which the views repaint from; reset with each Document */
	#remoteSizes = new SvelteMap<string, Size>()
	/** the remote images that failed to load (`isRemoteImageFailed`), which the views repaint from */
	#remoteFailed = new SvelteSet<string>()
	/** the URLs asked for already, so a repaint never asks again; nothing renders from it */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it
	#remoteAsked = new Set<string>()
	#fetchImage: (url: string) => Promise<Uint8Array> = fetchImageHead

	/** View > Load Remote Images: fetch this Document's blocked images */
	allowRemoteImages(): void {
		this.remoteImagesAllowed = true
	}

	#bind(documentFile: DocumentFile | null, document: Document, options: OpenOptions): void {
		const {
			run = runDetached,
			openInEditor = (path: string) => this.#openLinkedFile(path),
			chooseFolder = chooseFolderWithPicker,
			closeWindow = exitProcess,
			setWindowTitle = set_window_title,
			writePrintable = writePrintablePage,
			openWindow = openEditorWindow,
			choosePaths = choosePathsWithPicker,
			recentFiles = sharedRecentFiles(),
			minimizeWindow = minimize_window,
			zoomWindow = zoom_window,
			activateWindow = activate_window,
			toggleFullScreen = toggle_fullscreen,
			readClipboardUrl: readClipboard = readClipboardUrl,
			writeClipboard: writeToClipboard = writeClipboard,
			describeFile: describe = describeFile,
			isTextName: textName = isTextName,
			isImageName: imageName = isImageName,
			startedByNew = false,
			sendKeys = sendKeystrokes,
			fieldReplyMs = FIELD_REPLY_MS,
			fetchImage = fetchImageHead,
			socketsDirectory = SOCKETS_DIRECTORY,
			listAgentProcesses: listProcesses = listAgentProcesses,
			onExit = onProcessExit,
			legendPreference = sharedLegendPreference(),
			timeFormat = {},
			untitledNumbers
		} = options
		this.#options = options
		/**
		 * once per registrar, however often the window rebinds; the handler saves whichever Document is open then, and
		 * an untitled window's number is free again once it ends
		 */
		if (!this.#exitRegistrars.has(onExit)) {
			this.#exitRegistrars.add(onExit)
			onExit(() => {
				this.#saveBeforeExit()
				this.#releaseUntitled()
			})
		}
		// an untitled window takes the next number NSDocument gives (Untitled 2, …); one that gets a file frees its own
		this.#releaseUntitled()
		if (!documentFile && untitledNumbers)
			this.#untitled = { numbers: untitledNumbers, number: untitledNumbers.take(process.pid) }
		this.#discarded = false
		this.#exiting = false
		this.#openedNothing = false
		this.#legendPreference = legendPreference
		// the store holds what any window chose last, so a new Document reads it again on its first legend
		this.#legendMinimized = null
		this.#storedMinimized = null
		this.#timeFormat = timeFormat
		this.#unwatch?.()
		this.#unwatch = null
		this.#stopReports?.()
		this.#stopReports = null
		this.#ownSocket = null
		this.#documentFile = documentFile
		this.#document = document
		this.#session = null
		this.#field = this.#fieldOf('', false)
		this.#emptyPair = null
		this.#run = run
		this.#openInEditor = openInEditor
		this.#chooseFolder = chooseFolder
		this.#closeWindow = closeWindow
		this.#setWindowTitle = setWindowTitle
		this.#writePrintable = writePrintable
		this.#openWindow = openWindow
		this.#choosePaths = choosePaths
		this.#recentFiles = recentFiles
		this.#minimizeWindow = minimizeWindow
		this.#zoomWindow = zoomWindow
		this.#activateWindow = activateWindow
		this.#toggleFullScreen = toggleFullScreen
		this.#readClipboardUrl = readClipboard
		this.#writeClipboard = writeToClipboard
		this.#describeFile = describe
		this.#isTextName = textName
		this.#isImageName = imageName
		this.#startedByNew = startedByNew
		this.#sendKeys = sendKeys
		this.#fieldReplyMs = fieldReplyMs
		this.#fetchImage = fetchImage
		// a fresh cache per Document, as for local images
		this.#remoteSizes = new SvelteMap()
		this.#remoteFailed = new SvelteSet()
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it
		this.#remoteAsked = new Set()
		this.#lastPlace = null
		this.#probing = false
		this.#probeListener = null
		this.documentGeneration++
		this.#pressedAt = null
		this.selectedText = null
		this.#socketsDirectory = socketsDirectory
		// a file's own takes over in `#follow`
		this.#attribution = new Attribution(listProcesses)
		this.#listen()
		this.#clickedLink = null
		// the notices were about the file this window has let go of
		this.#pendingNotices = []
		this.overlay = null
		this.activeIndex = null
		this.activeIsNew = false
		this.#returnPressed = false
		this.sourceMode = false
		// a fresh cache per Document, so reopening a file picks up images changed in between
		this.#imageSizes = new ImageSizes()
		// the names given in any window stay for the window's life, as editmd's app-wide `AgentEdits.names`
		this.#agentLegend = new AgentLegend(this.#agentNames)
		this.agents = []
		// the window was titled with this Document's name when it opened or when the file came into it
		this.#shownTitle = this.#documentName
		this.#sync()
		/**
		 * editmd focuses its editor once a Document loads (main.ts:80-84): an empty one takes typing at once, its
		 * field showing "Start writing…" until the first character
		 */
		this.startWriting()
	}

	#sync(): void {
		// a DocumentFile still being made reports before it is this window's; whoever makes it syncs after
		if (this.#adopting) return
		// Source mode has no highlights, as editmd's has none without its rich editor: a merge there adds none
		if (
			this.sourceMode &&
			(this.#document.highlights.length > 0 || this.#document.deletions.length > 0)
		)
			this.#document.clearHighlights()
		this.text = this.#document.text
		this.blocks = this.#document.blocks
		// the open field follows its Edit session's text, which a Disk merge may have moved past Blocks added or removed
		if (this.#session && !this.sourceMode) {
			this.activeIsNew =
				this.#session === this.#newBlockSession && this.#session.start === this.#session.end
			this.activeIndex = this.#activeIndexOfSession()
			this.#sessionEnd = this.#session.end
		}
		// a merge, a clear or a revert hands over new lists; typing only moves the offsets in the same ones
		const marksChanged =
			this.#document.highlights !== this.highlights || this.#document.deletions !== this.deletions
		this.highlights = this.#document.highlights
		// typing moves a Deletion's offset in place, as a highlight's; the view places its line again from the new Blocks
		this.deletions = this.#document.deletions
		if (marksChanged) this.agents = this.#agentLegend.agents(this.highlights, this.deletions)
		const label = this.#documentFile?.label ?? NO_LABEL
		this.label = labelText(label)
		this.#showStatus(label)
		this.edited = this.#document.isDirty
		this.hasFile = this.#documentFile !== null
		this.#retitle()
	}

	/**
	 * the save-status label as editmd's SaveStatusView shows a label (EditorWindowController.swift:355-366): a label
	 * fades in with its text, and when it goes the text stays while it fades out, then leaves; the tooltip is the
	 * label's detail, a failed save's reason
	 */
	#showStatus(label: SaveLabel): void {
		this.statusDetail = labelDetail(label)
		if (label.kind !== 'none') {
			clearTimeout(this.#statusFade)
			this.#statusFade = undefined
			this.statusText = labelText(label)
			this.statusFailed = label.kind === 'failed'
			this.statusShown = true
			return
		}
		if (!this.statusShown) return
		this.statusShown = false
		this.#statusFade = setTimeout(() => {
			this.statusText = ''
			this.#statusFade = undefined
		}, STATUS_FADE_OUT_MS)
	}

	/**
	 * the window's title as NSDocument's: the Document's name, with " — Edited" while it has unsaved edits; set only
	 * when that changes, and not once the exit handler runs, the window being gone by then
	 */
	#retitle(): void {
		const title = `${this.#documentName}${this.#document.isDirty ? EDITED : ''}`
		if (title === this.#shownTitle || this.#exiting) return
		this.#shownTitle = title
		this.#setWindowTitle(title)
	}
}

export const documentController = new DocumentController()
