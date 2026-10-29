# ADR-0004: Document model and merge

## Status

Accepted, 2026-10-25

## Context

editmd keeps the document in a Yjs CRDT bound to ProseMirror. When the file changes on disk, the new text is replayed as edits against the last known state, and Yjs merges those edits with unsaved local edits. editmd's `web/src/sync.ts` has a ProseMirror half (block sync through y-prosemirror) and a plain-text half (`mergeText`, a three-way merge that also maps the cursor).

The port edits source text through a native `<textarea>`.

## Decision

- One `Y.Text` holds the document body and one holds the frontmatter
- Disk changes merge through editmd's `mergeText` (three-way via Yjs, cursor kept through a `RelativePosition`). Only the plain-text half of `sync.ts` is ported
- Merges into the focused block are deferred until the block loses focus. Merges into every other block apply at once
- When no field has focus, document-level undo runs through `Y.UndoManager`. Inside a focused block, the textarea's native undo applies

## Amendment, 2026-10-25 (Phase 2 and 3)

- The Document is one plain string, front matter included, held by `src/core/document.ts`. It supersedes the two `Y.Text`s above. Yjs stays inside `mergeText`, where each merge builds its documents and drops them again. Front matter is a Block, edited in its own field with that field's native undo; once its Edit session closes, its typing is a Document Undo step like any other Block's. editmd keeps a separate undo stack for front matter, so Cmd-Z outside a field here can take back a front matter edit, which editmd's body undo never does. The ported `src/core/frontmatter.ts` (`FrontmatterHistory`, split/join) is not wired; wiring it is the way to that parity
- Document-level undo does not use `Y.UndoManager`, since there is no long-lived `Y.Text` to track. An Undo step is a list of the user's own changes, each kept as the text before and after it. Undo merges each change back out of the current text, last first (`mergeText(after, current, before)`), so every Disk merge made since stays. That is what `Y.UndoManager` gives editmd by tracking only the user's origin. One Edit session's typing is one Undo step, and Revert to Saved clears the history
- Source mode is an Edit session over the whole text (`openSourceEdit`). Disk merges defer into it like into an Active block, and typing splices only what changed (`textEdits`), so Agent highlights survive

## Amendment, 2026-10-29

- A Disk merge into the open field no longer waits until the field closes. A user who formats or types in a Block while an Agent changes it saw neither change until something else happened, where editmd shows the merge at once. The Edit session still holds the change (`takeOutsideChange()`), and the controller sets it into the field at once. The field's caret goes back to where the typing ended, through arrow keys that `caretKeys` (`src/core/fieldSelection.ts`) computes, since gpuix has no way to set a field's caret (G1). The cost stays as the Consequences below describe: setting the value clears the field's own undo
- A changed file is merged only once two reads of it agree (`src/host/stableRead.ts`), so a file another program writes in place is never merged half written

## Consequences

- Setting a different `value` on a textarea from code moves the caret to the end and clears that field's native undo. Applying a merge to the focused block would therefore lose the user's caret and undo history, which is why merges into it wait
- Native undo coalesces fast edits, so one Cmd-Z can undo a run of typing. Document-level undo outside a field is a separate history
- y-prosemirror is not a dependency

## Evidence

S6 (2026-10-25), pass 7 of 7 (headless):

- one `onchange` per keystroke, carrying the full `e.value`
- Enter inserts a newline when no `onsubmit` is set
- Escape reaches `onkeydown` as `"escape"`
- a programmatic `value` is applied and the caret moves to the end (confirmed by typing after the set)
- native undo coalesced 21 fast-typed characters into one Cmd-Z, back to the programmatic value
- cost with a 5000-line value (about 230KB): programmatic set 202 to 208ms; keystroke including settle, median 13.6 to 15.8ms, max 15.2 to 18.3ms
- test gotcha: `type("abc")` from `gpuix-svelte/test` arrives as one key event
- IME and spelling cannot be tested headless and need a manual check in a real window (gap G7)

S7 (2026-10-25), pass:

- `src/core/diff.ts` is ported unchanged from editmd `web/src/diff.ts`
- `src/core/merge.ts` holds `EMPTY`, `merge`, `mergeText` and `editText`, using only `yjs`
- the tests in `src/core/{diff,merge}.test.ts` are ported from editmd's `web/test/sync.test.ts` to vitest 5.0.5 and fast-check 4.10.2, and 10 of 10 pass
- one harness change: an expression-bodied `fc.property` callback that returns `expect().toEqual()` fails under vitest, so it uses a block body
