# ADR-0018: The Block field types as editmd's editor does

## Status

Accepted, 2026-11-06. Amends [ADR-0003](0003-block-click-to-edit.md) (what the field does with typing). ADR-0003's
"Amendment, 2026-10-30" section recorded this inside the accepted ADR; this ADR is where it belongs.

## Context

ADR-0003 opens a Block as its markdown source in a text field and splices the edit into the text. editmd's Milkdown
editor turns Return, input rules, code fences and marks into rich-text edits as they are typed.

## Decision

The model stays: a Block's field holds its source, and edits splice the text. What the field does with typing follows
editmd's editor:

- Return is editmd's Enter (ProseMirror's base keymap and Milkdown's list and table keymaps, `core/returnKey.ts`): it
  splits a paragraph or heading into two Blocks, continues a list or a quote and leaves it on an empty line, keeps the
  newline in code, leaves a table with a paragraph after it, and is one Undo step
- An input rule (`#`, `-`, `>`, a fence and the others) gives the open field that kind's look at once
  (`core/inputRules.ts`); the markers stay in the field as source, and deleting them gives the old look back
- A fenced code block's or diagram's field holds the code alone, as editmd's code block holds no fences
  (`core/codeField.ts`); the fences stay in the text around it
- Bold, Italic, Strikethrough, Inline Code and Link act on the field's selection, which the port learns by typing a
  character over it and taking it back with ⌘Z (`core/fieldSelection.ts`), since gpuix reports none (gap G1)

## Consequences

- The field shows markdown markers where editmd shows rich text (gap G8, docs/parity.md e-wysiwyg)
- A selection probe types into the field and takes it back, so it must be followed by an edit (a redo hazard)

## Evidence

- `src/core/returnKey.test.ts`, `src/core/inputRules.test.ts`, `src/core/codeField.test.ts`,
  `src/core/fieldSelection.test.ts`; the typing, editing and inline end-to-end suites
