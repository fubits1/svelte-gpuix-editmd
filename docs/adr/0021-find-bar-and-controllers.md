# ADR-0021: The find bar in the window's column, and the controllers as built

## Status

Accepted, 2026-11-06. Amends [ADR-0011](0011-state-location.md) (where the find bar renders, and which controllers
exist). ADR-0011's "Amendment, 2026-10-25: the find bar is layout" and "Amendment, 2026-10-29: the controllers as
built" sections recorded these inside the accepted ADR; this ADR is where they belong.

## Context

editmd stacks its `FindBar` above the web view in an `NSStackView`, so the document moves down while it shows.

## Decision

- The find bar renders in App's column above the `Scroller`, not in `Portal`, and opens independently of the overlays
- `FindController` (`src/app/find.svelte.ts`) and `ThemeController` (`src/app/theme.svelte.ts`) are their own
  classes: Find's query and visibility belong to the window, not to one Document's text, and its matches are read back
  from native's paint, which `DocumentController` never touches
- `DocumentController` (`src/ui/DocumentView/controller.svelte.ts`) holds the per-document state, including the open
  overlay (`overlay`, one at a time) and the autosave through `DocumentFile` and the ported `Persistence` machine
  (`src/core/persistence.ts`); Agent highlights live in the core `Document`. There is no `OverlayController`,
  `PersistenceController` or `AgentController`
- `src/ui/DocumentView/Content.svelte` dispatches the views by Block kind; there is no `BlockList`
  ([ADR-0020](0020-views-by-block-kind.md))
