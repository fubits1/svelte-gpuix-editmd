# ADR-0003: Block click-to-edit over source slices

## Status

Accepted, 2026-10-25 (editing model chosen by the user: "Block click-to-edit (Recommended)")

## Context

editmd edits the rendered document in place with Milkdown on ProseMirror. gpuix has no contenteditable, no caret or selection API, no inline mixed-style text and no text hit-testing. Reading `@gpuix/native` 0.10.0's `renderer.rs` and the 0.11.0 diff showed that every `div` or `text` node becomes its own `StyledText` box, `display` only supports flex and grid, and there is no italic. Only the `<markdown source>` element paints mixed inline runs, and it accepts a source string only.

## Decision

- Render every top-level block read-only ([ADR-0005](0005-rendering-native-markdown-per-block.md))
- Clicking a block (or pressing Enter) swaps it for a `<textarea>` holding the block's exact source slice
- Escape, blur or clicking another block returns to the rendered view
- Cmd-/ toggles a full-document `<textarea>` source mode, as in editmd
- Edits splice the source text. Untouched blocks stay byte-identical. There is no ProseMirror, no Milkdown and no serializer

## Consequences

- Typing markdown syntax works everywhere, through the native textarea
- Block-level format commands (body text, H1 to H6, lists, quote, code block, indent, outdent, table, rule) are text transforms on the focused block
- Inline commands that wrap a selection (bold, italic, strike, code, link) need the textarea's selection, which gpuix does not report (gap G1, [ADR-0009](0009-parity-gaps-native-track.md)); see the 2026-10-30 amendment for how the port learns it
- Untouched blocks keep their exact bytes even when other blocks are edited. That is stricter than editmd, which normalizes the whole file through remark-stringify after any edit

## Amendment, 2026-10-30: the field types as editmd's editor does

The model stays: a Block's field holds its source, and edits splice the text. What the field does with typing now follows editmd's editor:

- Return is editmd's Enter (ProseMirror's base keymap and Milkdown's list and table keymaps, `core/returnKey.ts`). It splits a paragraph or heading into two Blocks, continues a list or a quote and leaves it on an empty line, keeps the newline in code, leaves a table with a paragraph after it, and is one Undo step.
- An input rule (`#`, `-`, `>`, a fence and the others) gives the open field that kind's look at once (`core/inputRules.ts`). The markers stay in the field as source, and deleting them gives the old look back.
- A fenced code block's or diagram's field holds the code alone, as editmd's code block holds no fences (`core/codeField.ts`). The fences stay in the text around it.
- Bold, Italic, Strikethrough, Inline Code and Link act on the field's selection. The port learns the selection by typing a character over it and taking it back with ⌘Z (`core/fieldSelection.ts`), since gpuix reports none (G1).

## Alternatives considered

All of the following sit on `prosemirror-view`, which needs contenteditable and the DOM. Marijn Haverbeke, ProseMirror's author, said the library "has a lot closer relation to the DOM than just rendering stuff":

- Milkdown (what editmd uses)
- tiptap (ueberdosis/tiptap)
- BlockNote (TypeCellOS/BlockNote, maintained by nperez0111, "nickthesick")
- `@handlewithcare/react-prosemirror`

`prosemirror-model`, `prosemirror-state` and `prosemirror-transform` run headless. A native view would still need caret, selection, hit-testing and inline runs, which gpuix lacks. This is revisited when gap G8 (a native rich-text element) lands.

Split pane (source textarea beside a read-only preview) was offered and not chosen.

## Evidence

- Native inline-text analysis (2026-10-25) of `@gpuix/native@0.10.0` `renderer.rs`, `text/paint.rs` and the 0.11.0 diff: no inline display, text runs always `None` for host text, `<markdown>` `supported_props` is `source` and `theme`
- S5 (painter parity) and S6 (textarea behaviour) support this model. See [ADR-0005](0005-rendering-native-markdown-per-block.md) and [ADR-0004](0004-document-model-and-merge.md)
