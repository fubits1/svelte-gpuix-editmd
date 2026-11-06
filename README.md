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
pnpm dev [file.md]       # opens the window, remounts it on each saved .svelte file; a .ts, .svelte.ts or .js change needs a restart
pnpm test                # every Vitest project but visual: unit, the headless UI suite, the end-to-end suites headless
pnpm test:unit           # the unit tests, watching
pnpm test:ui             # the headless UI suite (test/ui/) through GPUI's real hit testing
pnpm test:e2e            # the end-to-end suites (e2e/), each app headless behind gpuix's automation protocol
pnpm test:e2e:window     # the same suites against real windows: they take the keyboard while they run
pnpm test:coverage       # the unit tests with coverage and its thresholds
pnpm test:ci             # test:coverage, then the headless UI suite
pnpm test:visual         # measurements and pictures against their references, for upgrades and refactors only
pnpm typecheck           # tsc, then svelte-check against GPUI's element types
pnpm lint                # prettier --check, eslint, knip, svelte-check
pnpm format              # prettier --write
pnpm build               # dist/editmd-gpuix.app through gpuix-svelte/build, the bundle to open; macOS only, needs Bun

# headless modes, as editmd's (Headless.swift)
pnpm exec gpuix-svelte standalone.ts --roundtrip FILE    # what Save writes for the untouched file
pnpm exec gpuix-svelte standalone.ts --normalize FILE    # the text as loaded: the port has no serializer
pnpm exec gpuix-svelte standalone.ts --snapshot FILE OUT.png [--dark] [--width N]   # the whole page as a PNG
pnpm exec gpuix-svelte standalone.ts --selftest FILE     # editmd's self-test; it edits and saves FILE: use a copy
```

[docs/parity.md](docs/parity.md) compares every user-facing feature with editmd and marks each one. The
screenshots and scripts behind that comparison are kept outside this repository.

The UI and end-to-end suites keep their files, the agent sockets and Open Recent in a `/tmp/eg-*` folder through
`EDITMD_GPUIX_SUPPORT`, so they never touch the support folder in `~/Library`. With `EDITMD_GPUIX_DRY_RUN=<file>`
the app writes every process it would start (`open` for links and printing, new windows) to that file instead.

Open a file with `dist/editmd-gpuix.app/Contents/MacOS/editmd-gpuix <path>`. Finder and `open -a` do not hand the app
their file yet (gap G6 in [ADR-0009](docs/adr/0009-parity-gaps-native-track.md)).

The app's own scripts (`dev`, `start`, `visual:measure`) and the headless modes run through the `gpuix-svelte` bin,
which starts Node (or Bun with `--bun`) with the `custom-renderer` condition and the `.svelte` loader; the `ui` and
`e2e` Vitest projects pass Node the same flags (`vitest.config.ts`). App windows and the headless renderer crash under
a sandboxed shell, so run them, `pnpm test` included, unsandboxed.

## Building

`pnpm build` makes `dist/editmd-gpuix.app` (macOS arm64, about 109 MB): Bun compiles `standalone.ts` into one
executable, and `build.ts` then adds the icon, satteri's native addon and the Info.plist keys, and signs the bundle
ad hoc. What it needs and why each step exists is in [AGENTS.md](AGENTS.md#building).

## Caveats

- A Block you edit opens as its markdown source in a field, the `#`, `**` or `-` markers shown, and takes its kind's
  look as you type them. Escape, or a click on another Block, closes the field and paints the Block
  ([ADR-0003](docs/adr/0003-block-click-to-edit.md)).
- Tab writes 2 spaces outside a list, never a tab character. Details and TODOs:
  [ADR-0012](docs/adr/0012-gpuix-svelte-0.3.md).
