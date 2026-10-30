# ADR-0012: gpuix-svelte 0.3.0

## Status

Accepted, 2026-10-29. Amends [ADR-0001](0001-native-host-gpuix-svelte.md) (host version) and [ADR-0009](0009-parity-gaps-native-track.md) (G11: the port no longer stays on 0.10.0).

## Context

gpuix-svelte 0.3.0 (released 2026-10-27) moves to `@gpuix/native` 0.11.0. Its breaking changes that reach the port:

- Tab and Shift-Tab move focus between tab stops after every key handler has run, and Tab no longer types a tab character into an `<input>` or `<textarea>`
- `get_native().getElementBounds()` reports the border box, padding and border included

Measured on 0.3.0, a scrolling element's bounds no longer move with its own scroll offset: App's `page-scroller` reports y 24 and height 514 in a 538px window at offsets 0 and -1092. On 0.2.0 the box moved with the offset, and the port corrected for that when it scrolled a Block, an Agent's change, a Find match or the Command Palette's selected entry into view.

In a real window on 0.3.0, Tab in a Block's field typed nothing, Shift-Tab typed nothing, and the field kept focus. Alt-Tab, Ctrl-Tab and Ctrl-I typed no tab character either. gpuix still reports no caret or selection for a text field (G1); a field's selection is not in the window's selection either.

## Decision

- Use gpuix-svelte `^0.3.0` with `@gpuix/native` 0.11.0
- A scrolling element's painted bounds are its viewport. The scroll helpers use them as they are, with no offset correction
- Tab in a Block's field, as editmd's Milkdown takes it (`editor.ts:476-481`, `list-item.ts:212-225`, plugin-indent `index.ts:28-33,52`):
  - in a list item with an item before it, Tab nests it and Shift-Tab un-nests it, through Format > Indent and Outdent, which learn the caret by the probe
  - elsewhere, and in a list's first item, Tab types 2 spaces at the caret as keys, with no probe. A selection is replaced by them, as in VS Code (user decision); editmd keeps the selection and puts the spaces after it
  - Shift-Tab outside a list is taken and changes nothing, so the field keeps focus
- Tab in the front matter field and in Source mode is left to gpuix, as editmd's front matter box and source view have no Tab handler (`frontmatter.ts:33-40`, `editor.ts:159-163`). Measured in a real window, Tab in Source mode types nothing and the field keeps focus
- No tab character is written. gpuix types none, and inserting one would need the probe on every press (user decision: spaces are instant and lose no key)
- `tabNavigation` stays at its default. Turning it off only stops the focus move (gpuix-svelte `renderer.js` `key_default`); it brings no tab character back

## Consequences

- In a list item, a key typed while the probe runs can be lost, as with Format > Indent. TODO: hold the keys typed during a probe and send them after it
- The 2 spaces are sent as keys behind any keys already waiting, so a key that arrives in the same batch as the Tab lands before them. Keys typed one after another keep their order
- TODO: write a literal tab once gpuix reports a text field's caret and selection (G1)
- `@gpuix/native` 0.11.0 adds dashed borders, `outline*`, `onlayout` and `registerFont`. The blocked-image box uses the dashed border, the front matter field's focus ring the outline, and tables, images, mixed paragraphs and diagrams size from `onlayout` instead of 250ms polls (amended 2026-10-30); the deleted-block line keeps its `<svg>` dashes (ADR-0009 G11)
- `--snapshot` of an empty Document paints the open field's caret, which editmd's snapshot does not. TODO: no caret in a snapshot
- gpuix-svelte 0.3.0 still vendors `devalue` 5.9.2 ([ADR-0010](0010-tooling.md))

## Evidence

- gpuix-svelte v0.3.0 release notes (`gh release view v0.3.0 --repo khromov/gpuix-svelte`, read 2026-10-29); the gpuix-svelte Guide: "Tab never types a tab character into an `<input>` or `<textarea>`"
- 2026-10-29, headless on 0.3.0: `page-scroller` bounds at offsets 0 and -1092. `test.ts`: 6 checks failed before the scroll change (5 scroll checks and a shadow that now reports `inset: false`) and 411 of 411 pass after it
- 2026-10-29, real window on 0.3.0: Tab, Shift-Tab and the tab-character keys as stated above; `e2e/tab.e2e.ts` 8 of 8 after the Tab change, 5 of its checks failing before it
- Every real-window suite after both changes: tab 8, launch 11, co-editing 16, file formats 6, links 4, remote images 7, all ok
