# ADR-0020: Views dispatched by Block kind in a plain Scroller

## Status

Accepted, 2026-11-06. Amends [ADR-0005](0005-rendering-native-markdown-per-block.md) (the list component and the
scroller). ADR-0005's "Amendment, 2026-10-29" section recorded this inside the accepted ADR; this ADR is where it
belongs.

## Decision

- `src/ui/DocumentView/Content.svelte` dispatches the views by Block kind; there is no `BlockList`
- The page scrolls in `App.svelte`'s plain `Scroller`, not a virtual list: every Block is laid out every frame

## Consequences

- Long documents lay out every Block each frame; a virtual list remains the way to them
