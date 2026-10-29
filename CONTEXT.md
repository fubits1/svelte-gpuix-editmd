# editmd-gpuix

A native markdown editor that shows a file as rendered blocks, edits one block's source at a time, and keeps the
file byte-identical wherever the user did not type.

## Language

### Documents and blocks

**Document**:
The open file's text with LF line endings, front matter included.
_Avoid_: buffer, content, model

**Baseline**:
The Document text as last loaded from or saved to disk.
_Avoid_: original, saved copy

**Block**:
One top-level markdown construct of the Document, identified by its start and end offsets into the Document text.
_Avoid_: node, section, paragraph (when meaning any block)

**Gap**:
The text between two Blocks (blank lines), owned by the Document and never changed by a Block edit.
_Avoid_: separator, whitespace block

**Slice**:
The exact source text of one Block.
_Avoid_: snippet, chunk

**Front matter**:
A leading YAML (`---`) or TOML (`+++`) block, kept verbatim with an undo history of its own.
_Avoid_: header, metadata block

### Editing

**Edit session**:
The time one Block is open as source in a text field, from click until blur or Escape; in Source mode, the time the
whole Document is.
_Avoid_: edit mode, focus

**Active block**:
The Block whose Edit session is open; at most one per Document.
_Avoid_: current block, focused block

**Source mode**:
The whole Document shown as one text field instead of Blocks.
_Avoid_: raw mode, markdown view

**Undo step**:
What one Undo takes back: one user change, or all the typing of one Edit session. Disk merges are never undone.
_Avoid_: history entry, snapshot

### Files and agents

**Disk merge**:
Folding text written to the file by someone else into the Document, keeping unsaved edits on both sides.
_Avoid_: reload, sync

**Deferred merge**:
A Disk merge's change to the Active block, held in its Edit session until the open field takes it in, which the field
does at once, keeping the user's typing and caret.
_Avoid_: pending reload

**Agent**:
A coding tool (Claude, Codex, …) that edits files and is named in the editor.
_Avoid_: bot, assistant, author (when meaning the tool)

**Report**:
What an Agent's hook says it is about to edit or has just edited.
_Avoid_: event, notification

**Claim**:
An Agent's time-limited hold on a file, made by a Report, deciding whom a change is credited to.
_Avoid_: lock, lease

**Agent highlight**:
The Agent's colour on a Block a Disk merge changed.
_Avoid_: diff marker, decoration

## Relationships

- A **Document** has exactly one **Baseline** and zero or more **Blocks**, separated by **Gaps**
- A **Document** has at most one **Front matter**, always its first **Block**
- An **Edit session** belongs to exactly one **Active block**, except in **Source mode**, where there is no **Active block**
- Undoing an **Undo step** keeps every **Disk merge** made after it
- A **Disk merge** can produce one **Deferred merge** for the **Active block**
- A **Report** creates or shortens a **Claim**; a **Disk merge** credits its changed **Blocks** to the latest live **Claim**

## Example dialogue

> **Dev:** "When an **Agent** writes the file while the user types in a paragraph, does the paragraph's text field
> jump?"
> **Domain expert:** "No. The **Disk merge** lands in every other **Block** at once. The change to the **Active block**
> is a **Deferred merge**, which the field takes in at once, merged with the typing, the caret where the user left it."
> **Dev:** "And the blank lines between blocks?"
> **Domain expert:** "Those are **Gaps**. Only a **Disk merge** or **Source mode** changes them; a **Block** edit never
> does."

## Flagged ambiguities

- "port" means editmd-gpuix as a whole being derived from kirahowe/editmd, never a network port.
