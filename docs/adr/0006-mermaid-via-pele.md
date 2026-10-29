# ADR-0006: Mermaid through pele, shown as an image

## Status

Accepted, 2026-10-25

## Context

editmd renders fenced `mermaid` blocks with Mermaid 11, which needs a DOM for layout. `mermaid` 12.2.0 still needs a DOM, and `@mermaid-js/mermaid-cli` and `mermaid-isomorphic` need Chromium. gpuix's `<svg>` element paints a single-colour tint mask, so it cannot show a multi-colour diagram.

pele 1.10.0 (obsidianmd, MIT, no dependencies) renders Mermaid 12.1 syntax to SVG with a synchronous `render(text)`. It has a pluggable text `measurer` and falls back to a built-in width table outside browsers.

## Decision

- Render diagrams with pele's `render(source, { responsive: false })`
- Resolve every CSS custom property in the SVG to a literal value from the app palette (or pele's fallback) before display
- Show the result through `<img>`, either as a file path or as bytes through `set_image`
- Queue renders serially with a 300ms debounce, as editmd does
- Pass a concrete `fontFamily` and a `pele-font` palette entry so labels use the app font

## Consequences

- Theme changes need a re-render, or at least a re-inline, because colours are baked into the SVG
- Text widths come from pele's built-in width table, unless the measurer is later connected to GPUI text measurement (gpuix has no text measurement API)

## Alternatives considered

- `beautiful-mermaid` 1.1.3: synchronous and DOM-free, but covers only 6 diagram types. Kept as the fallback

## Evidence

S4 (2026-10-25), pass with variable inlining:

- pele renders flowchart, sequence, class, state and gantt in Node with no DOM, 1.6 to 5.0ms each
- pele's SVG uses two levels of variables: `--_bg:var(--pele-bg,#fff)` on the root and `fill="var(--_bg)"` on shapes
- GPUI's `<img>` decoder ignores `var()`. Shown raw, every shape paints black
- resolving every variable to the palette or its fallback before the SVG is shown makes all 5 types render in full colour
- Follow-up: labels render in a serif font, because the generic `sans-serif` does not resolve in the decoder's font database

Socket score for `pele@1.10.0`: 96 overall, no dependencies, only low alerts (`minifiedFile`, `urlStrings`).
