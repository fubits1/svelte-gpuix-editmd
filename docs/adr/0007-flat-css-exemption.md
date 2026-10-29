# ADR-0007: Flat CSS rules in gpuix components

## Status

Accepted, 2026-10-25 (user choice: "Exempt gpuix styles (Recommended)")

## Context

The project code style requires nesting CSS with `&`. gpuix-svelte compiles `<style>` blocks into GPUI class rules at load time and accepts only one class or tag per compound selector plus `:hover` and `:active`. Nested rules, combinators, `:global` and at-rules are refused with a warning. Lengths are logical pixels: `px` and `rem` (16px), with `%` and `auto` only on width, height and their min and max.

## Decision

- `.svelte` files rendered by gpuix use flat single-class rules
- Every other code-style rule still applies: key-value data attributes, descriptive names, `#` private members, `type` over `interface`, comment rules
- Colours go through `var(--token)`, with the palette set once from the root through `set_css_vars`

## Consequences

- This exemption needs a note in the project `CLAUDE.md`, so later edits do not "fix" flat rules into nested ones
- Descendant styling must use classes on the child elements, because combinators do not exist

## Alternatives considered

- Write nested CSS and flatten it in a custom pre-compile step. Rejected: extra tooling, and nested selectors still cannot express descendant matching in GPUI

## Evidence

- gpuix-svelte `src/compile.ts` `extract_rules` (read 2026-10-25): a rule is accepted only as classes, at most one tag and `:hover`/`:active`. Anything else gets the warning "has no GPUI equivalent"
