# ADR-0011: State location and component composition

## Status

Accepted, 2026-10-25

## Context

The project follows the `composition-svelte` rules, which ask for three decisions up front: composition shape, snippet API and state location. gpuix keeps `.svelte.ts` module instances alive across hot reloads, and edits to plain `.ts` files need a restart.

## Decision

- Shape: composition. `DocumentView` wraps the document, `BlockList` dispatches views by block kind, and `DocumentController` holds the state. Overlays (link dialog, Save As dialog, command palette, find bar) open one at a time through an `OverlayController` handler, inside `Portal`
- Snippet API: block views receive one payload object, `{ block, isActive, activate, highlight }`. Overlays receive `children` and `close`
- State location:
  - the pure TypeScript core holds no runes
  - per-document state lives in classes with `$state` fields in `.svelte.ts` modules: `DocumentController` (text, `blocks` as `$derived`, active block, dirty, source mode), `PersistenceController` (wraps the ported autosave state machine), `AgentController`, `FindController` (wraps `TextSearch`), `ThemeController` (appearance and zoom)
  - component-local `$state` only for transient UI, such as dialog input text

## Consequences

- One process per document ([ADR-0008](0008-windows-and-ipc.md)) means a module-level singleton per process is also a singleton per document
- Controller state survives hot reload during development, because it lives in `.svelte.ts` modules
- `bind:` is unavailable, so inputs report through `onchange` with `e.value` and controllers apply the change

## Amendment, 2026-10-25: the find bar is layout

editmd stacks its `FindBar` above the web view in an `NSStackView`, so the document moves down while it shows. The find bar therefore renders in App's column above the `Scroller`, not in `Portal`, and opens independently of the overlays. `FindController` stays its own class in `src/app/find.svelte.ts`: its query and visibility belong to the window, not to one Document's text, and its matches are read back from native's paint, which `DocumentController` never touches.

## Amendment, 2026-10-29: the controllers as built

- `src/ui/DocumentView/Content.svelte` dispatches the views by Block kind; there is no `BlockList`
- `DocumentController` (`src/ui/DocumentView/controller.svelte.ts`) holds the per-document state, including the open overlay (`overlay`, one at a time) and the autosave through `DocumentFile` and the ported `Persistence` machine (`src/core/persistence.ts`). Agent highlights live in the core `Document`. There is no `OverlayController`, `PersistenceController` or `AgentController`
- `FindController` (`src/app/find.svelte.ts`) and `ThemeController` (`src/app/theme.svelte.ts`) are their own classes, as decided

## Evidence

- gpuix-svelte `CLAUDE.md` (read 2026-10-25): `.svelte.ts` modules survive hot reload, plain `.ts` edits need a restart, no `bind:`
- S2 (2026-10-25): Sätteri runs inside a `.svelte.ts` module that exports `$state` under the gpuix loader on Node and Bun
