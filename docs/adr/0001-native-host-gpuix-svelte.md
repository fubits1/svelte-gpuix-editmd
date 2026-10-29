# ADR-0001: Native host on gpuix-svelte

## Status

Accepted, 2026-10-25

## Context

editmd is a Swift/AppKit `NSDocument` app that hosts a WKWebView running Milkdown. The port targets Svelte 5 rendered natively, with no web view.

gpuix-svelte 0.2.0 is a Svelte custom renderer that draws into GPUI windows through `@gpuix/native` (range `>=0.10.0 <0.11.0`). It bundles a vendored Svelte build, `svelte-5.57.2-694f791`, made from the unmerged custom-renderer PR stack (sveltejs/svelte#18042 and follow-ups). It runs on Node 24 or newer or Bun 1.4 or newer, and builds standalone binaries with `Bun.build({compile})`.

## Decision

- Use gpuix-svelte 0.2.0 as the host, replacing Swift and WKWebView
- Never add `svelte` to the project's own dependencies. gpuix-svelte pins every `svelte` import to its bundled build
- Develop on Node 26: `.nvmrc` holds `26`, the same as the gpuix-svelte repo, and `nvm use` runs before every command. `package.json` sets `engines.node` to `>=26`
- Build the shipping binary with Bun through `Bun.build({compile})`

## Consequences

- No DOM: no contenteditable, no inline styled text runs, no text hit-testing, no textarea selection API. The editor layer is redesigned ([ADR-0003](0003-block-click-to-edit.md))
- No element `bind:` and no `{@html}` under the custom renderer. Elements are reached through `{@attach}`
- `.svelte.ts` modules survive hot reload. Edits to plain `.ts` files need a restart. `bun --hot` must never be used
- TypeScript runs through type stripping: no enums, namespaces or parameter properties, `import type` for types, explicit `.ts` import extensions. TypeScript stays on `^5.9`
- Fixed native menu bar, one window per process, no save dialog, no clipboard, open-URL, print or appearance API. These are handled in [ADR-0008](0008-windows-and-ipc.md) and [ADR-0009](0009-parity-gaps-native-track.md)
- Windows and the headless renderer crash under the Claude Code Bash sandbox, so window and headless runs need the sandbox disabled
- The project depends on an experimental renderer and an unmerged Svelte API. Breaking changes are expected between gpuix-svelte minor versions

## Evidence

- S1 (2026-10-25), pass: `pnpm create gpuix-svelte@0.2.0 editmd-gpuix`, then `pnpm --dir . install`. Typecheck: 318 files, 0 errors. The window screenshot shows the starter counter. `pnpm --dir . test` printed `starter ok`
- `gpuix-svelte` `src/compile.ts` (read 2026-10-25): `compile_svelte` calls `compile()` with `runes: true` and `experimental: { customRenderer, async: true }`
- gpuix-svelte `CLAUDE.md` (read 2026-10-25): no `bind:`, `{@html}` incompatible, vendored Svelte must stay out of app dependencies, sandbox crash note
