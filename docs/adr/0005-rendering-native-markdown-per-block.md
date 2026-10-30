# ADR-0005: Native markdown element per block, custom views for the rest

## Status

Accepted, 2026-10-25

## Context

gpuix's `<markdown source theme onlinkclick>` element is gpuix's own renderer on pulldown-cmark 0.12. It covers CommonMark and GFM tables, strikethrough and autolinks, highlights fenced code with syntect, and allows text selection with Cmd-C. It is the only element that paints mixed inline runs (bold, italic, code pill, underlined link, strikethrough).

What it does not do:

- task list items render as literal `[x]` text, not checkboxes
- images are not rendered
- raw HTML renders as text
- it takes only a source string: no AST input, no source offsets, and `linkClick` gives only the URL
- styling goes through the `theme` object only
- it is laid out in full every frame, so one large element is expensive. gpuix-svelte measured a 226-block page at about 7ms per frame, which dropped below 1ms with one block per row under `<Scroller virtual>`

## Decision

- `BlockList` paints one native `<markdown>` per top-level block, one block per row under `<Scroller virtual>`
- `definition` source is appended to every slice as render-time context, so reference links resolve. A `definition` Block itself paints as its source line, as editmd shows link definitions
- Custom views cover what `<markdown>` lacks:
  - task lists: a checkbox row plus one `<markdown>` per item
  - images: `<img>`; paragraphs that contain images are split into text and image segments
  - mermaid: [ADR-0006](0006-mermaid-via-pele.md)
  - frontmatter: its own box
  - footnotes (amended 2026-10-25 after S9): the engine owns them. Each `[^label]` is rewritten at render time into its label in Unicode superscript characters (`[^1]` paints `¹`), as editmd paints the label alone in a small raised `sup` that links nowhere (preset-gfm `footnote/reference.ts:33-45`, `style.css:370-374`). A character with no superscript form stays as written. (Amended 2026-10-30: the earlier link run `[\[label\]](footnote:label)` scrolled to the definition, which editmd does not do.) The accent colour and the 0.75em size stay gap G9. A `footnoteDefinition` Block gets its own view: the label in bold, then its content as markdown, muted, with a rule above it, as editmd's `dl[data-type="footnote_definition"]`. Footnote definitions are no longer appended as context

## Amendment, 2026-10-29

- `src/ui/DocumentView/Content.svelte` dispatches the views by Block kind (there is no `BlockList`), and the page scrolls in `App.svelte`'s plain `Scroller`, not a virtual one: every Block is laid out every frame. A virtual list remains the way to long documents

## Consequences

- Footnotes needed more design in Phase 3, now settled by S9 (see the Decision). The S5 reading that `<markdown>` renders a reference as `^n` whenever the definition is in the same source was wrong: it does so only inside table cells
- a footnote reference is not superscript: `<markdown>` has no superscript run, so the bracketed label is the nearest match
- Agent highlights can only be block-level for now. The `highlight` prop's explicit ranges are skipped on `<markdown>` (gap G4)

## Evidence

S5 (2026-10-25, headless). Each of the 498 editmd corpus cases was painted two ways and the painted text compared: the whole document in one `<markdown>`, and one `<markdown>` per Sätteri top-level slice. Frontmatter was dropped on both sides.

- `painted()` from `gpuix-svelte/test` does include text painted inside native `<markdown>` (confirmed by a check)
- first run, with only `definition` appended as context: 495 of 498 matched. The 3 mismatches were footnote references painted as `[^1]` instead of `^1`
- second run, with `footnoteDefinition` appended as well: 497 of 498 matched
- the remaining mismatch, `footnote-def-first`, has the same tokens in a different order: the definition comes before its use, and the spike appended context after the slice

S9 (2026-10-25, headless), what one `<markdown>` paints:

- `Text[^1] and[^note].` alone: `Text[^1] and[^note].`
- the same with `[^1]: First note.` and `[^note]: Second note` below it: `Text[^1] and[^note].` then `[^1]: First note. [^note]: Second note`, so neither the references nor the definitions are resolved
- the corpus `footnote-in-table` case: `a`, `x^1`, and the definition `n` is not painted
- editmd (`web/src/style.css`@9e889e6) paints a reference small in the accent colour and a definition as a muted block with a top border, label in bold
