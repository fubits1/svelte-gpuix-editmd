# editmd-gpuix

A port of [kirahowe/editmd](https://github.com/kirahowe/editmd) (macOS markdown editor, Swift + WKWebView +
Milkdown) to Svelte 5 rendered natively by [gpuix-svelte](https://github.com/khromov/gpuix-svelte) (GPUI, no DOM).

Ported from editmd at commit `9e889e6dbfba250242749650c7057933fb7950b5`: the pure logic in `src/core/` (diff,
three-way text merge, front matter, anchors, remote images, image links, link policy, text file encodings,
autosave state machine, agent edit attribution) and its tests. The Format commands (`src/core/formatBlock.ts`), Add
Link with nothing selected (`src/core/linkInsert.ts`) and reference settling (`src/core/references.ts`) write what
editmd's Milkdown editor writes, measured by running editmd's own editor on the same cases. `scripts/make-icon.swift`, which draws the app icon, is
editmd's own, copied unchanged. editmd is MIT licensed, Copyright (c) 2026 Kira Howe;
its licence text is in [LICENSES/editmd-MIT.txt](LICENSES/editmd-MIT.txt).

Architecture, decisions and the parity matrix: [docs/architecture.md](docs/architecture.md),
[docs/adr/](docs/adr/README.md), [docs/parity.md](docs/parity.md).

## Commands

Node 26 (`nvm use`), pnpm.

```bash
pnpm install
pnpm dev [file.md]     # opens the window, remounts it on each saved .svelte file; a .ts, .svelte.ts or .js change needs a restart
pnpm test              # unit tests (Vitest), then the headless gpuix test
pnpm run test:unit     # Vitest only
pnpm run typecheck     # tsc, then svelte-check against GPUI's element types
pnpm run lint          # prettier --check, eslint, knip, svelte-check
pnpm run format        # prettier --write
pnpm run build         # dist/editmd-gpuix.app through gpuix-svelte/build, the bundle to open; macOS only, needs Bun

# end to end, editmd's SelfTest scenarios in real windows (each opens and closes windows)
pnpm exec gpuix-svelte e2e/fileFormats.e2e.ts
pnpm exec gpuix-svelte e2e/coEditing.e2e.ts
pnpm exec gpuix-svelte e2e/links.e2e.ts
pnpm exec gpuix-svelte e2e/remoteImages.e2e.ts
pnpm exec gpuix-svelte e2e/launch.e2e.ts
pnpm exec gpuix-svelte e2e/tab.e2e.ts
pnpm exec gpuix-svelte e2e/typing.e2e.ts
pnpm exec gpuix-svelte e2e/editing.e2e.ts
pnpm exec gpuix-svelte e2e/inline.e2e.ts
pnpm exec gpuix-svelte e2e/differential.e2e.ts   # the same keys as editmd's own editor took (kit fixture)

# headless modes, as editmd's (Headless.swift)
pnpm exec gpuix-svelte standalone.ts --roundtrip FILE    # what Save writes for the untouched file
pnpm exec gpuix-svelte standalone.ts --normalize FILE    # the text as loaded: the port has no serializer
pnpm exec gpuix-svelte standalone.ts --snapshot FILE OUT.png [--dark] [--width N]   # the whole page as a PNG
pnpm exec gpuix-svelte standalone.ts --selftest FILE     # editmd's self-test; it edits and saves FILE: use a copy
```

[docs/parity.md](docs/parity.md) compares every user-facing feature with editmd and marks each one. The
screenshots and scripts behind that comparison are kept outside this repository.

The end-to-end runs keep their files, the agent sockets and Open Recent in a `/tmp/eg-*` folder through
`EDITMD_GPUIX_SUPPORT`, so they never touch the support folder in `~/Library`. With `EDITMD_GPUIX_DRY_RUN=<file>`
the app writes every process it would start (`open` for links and printing, new windows) to that file instead.

Open a file with `dist/editmd-gpuix.app/Contents/MacOS/editmd-gpuix <path>`. Finder and `open -a` do not hand the app
their file yet (gap G6 in [ADR-0009](docs/adr/0009-parity-gaps-native-track.md)).

Every script runs through the `gpuix-svelte` bin, which starts Node (or Bun with `--bun`) with the
`custom-renderer` condition and the `.svelte` loader. Windows and the headless renderer crash under a sandboxed
shell, so run them unsandboxed.

## Caveats

- A Block you edit opens as its markdown source in a field, the `#`, `**` or `-` markers shown, and takes its kind's
  look as you type them. Escape, or a click on another Block, closes the field and paints the Block
  ([ADR-0003](docs/adr/0003-block-click-to-edit.md)).
- Tab writes 2 spaces outside a list, never a tab character. Details and TODOs:
  [ADR-0012](docs/adr/0012-gpuix-svelte-0.3.md).
