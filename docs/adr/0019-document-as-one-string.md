# ADR-0019: The Document as one string, undo by merges, outside changes shown at once

## Status

Accepted, 2026-11-06. Amends [ADR-0004](0004-document-model-and-merge.md) (the Document's form, undo, Source mode and
when a Disk merge reaches the open field). ADR-0004's "Amendment, 2026-10-25 (Phase 2 and 3)" and "Amendment,
2026-10-29" sections recorded these inside the accepted ADR; this ADR is where they belong.

## Context

ADR-0004 kept the document in two `Y.Text`s with `Y.UndoManager` for undo, and merged outside writes into an open
Block when its field closed.

## Decision

- The Document is one plain string, front matter included, held by `src/core/document.ts`; Yjs stays inside
  `mergeText`, where each merge builds its documents and drops them again
- Front matter is a Block, edited in its own field with that field's native undo; once its Edit session closes, its
  typing is a Document Undo step like any other Block's
- An Undo step is a list of the user's own changes, each kept as the text before and after it; Undo merges each change
  back out of the current text, last first (`mergeText(after, current, before)`), so every Disk merge made since stays.
  One Edit session's typing is one Undo step, and Revert to Saved clears the history
- Source mode is an Edit session over the whole text (`openSourceEdit`): Disk merges defer into it as into an Active
  block, and typing splices only what changed (`textEdits`), so Agent highlights survive
- A Disk merge into the open field shows at once: the Edit session holds the change (`takeOutsideChange()`), the
  controller sets it into the field, and the field's caret goes back to where the typing ended through arrow keys
  (`caretKeys` in `src/core/fieldSelection.ts`), since gpuix cannot set a field's caret (gap G1)
- A changed file is merged only once two reads of it agree (`src/host/stableRead.ts`), so a file another program
  writes in place is never merged half written

## Consequences

- editmd keeps a separate undo stack for front matter; here ⌘Z outside a field can take back a front matter edit,
  which editmd's body undo never does (docs/parity.md e-undo, e-frontmatter-edit)
- Setting the merged text into the field clears the field's own undo

## Evidence

- `src/core/document.test.ts` (undo by merges, deferred merges, Source mode), `src/core/merge.test.ts`,
  `src/host/stableRead.test.ts`, the co-editing end-to-end suite
