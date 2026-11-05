# ADR-0013: gpuix-svelte 0.4.1 and its build()

## Status

Accepted, 2026-11-04. Amends [ADR-0001](0001-native-host-gpuix-svelte.md) (host version, build) and [ADR-0012](0012-gpuix-svelte-0.3.md) (host version). Replaces the `satteri-native` Bun plugin of [ADR-0002](0002-markdown-engine-satteri.md).

## Context

gpuix-svelte 0.4.1 stays on `@gpuix/native` 0.11 and adds `build()` in `gpuix-svelte/build`. It takes only `entry` and `outdir`. It compiles the entry with `Bun.build({ compile })` and a fixed plugin list, then packages the executable for the platform. On macOS that is a `.app` with its own Info.plist and icon, signed when `CODESIGN_IDENTITY` is set and notarized when `NOTARY_PROFILE` is set too.

build() reads the app's name, identifier, copyright and icon from the entry's top-level `render()` call in the source, not at runtime. The call's options can hold no spread or computed key, and each `app.*` option has to be a string the source spells out (a literal, an expression-free template literal, a top-level `const` holding one, or `new URL('…', import.meta.url)`; `read_app_options`, app-bundle.js:49-75). The Info.plist it writes sets `LSMinimumSystemVersion` to 13.0 (`MIN_MACOS`) and has no `LSApplicationCategoryType`.

The port's `build.ts` used to run `Bun.build` itself with the `satteri-native` plugin (ADR-0002), which build() has no place for. satteri's napi-rs loader finds its addon through `createRequire`, which Bun's bundler cannot follow. A binary built by build() alone died at start with `Cannot find module '@bruits/satteri-darwin-arm64'`. The loader honours `NAPI_RS_NATIVE_LIBRARY_PATH`. `@gpuix/native`'s napi-rs loader reads the same variable: set for the whole process, it loaded satteri's addon as GPUI's, and the binary died with `undefined is not a constructor (evaluating 'new I0.GpuixRenderer(...)')`.

Other 0.4 changes that reach the port:

- Scroller's thumb follows `onlayout` and `onscrollchange` instead of polling bounds
- `read_native()` is new
- `wait()` from `gpuix-svelte/test` pumps queued events before and after it waits
- `render()`'s `app` option gives the window title fallback and the Linux app id
- `<canvas>` degrades to a `div`. The port has none
- In `pnpm dev`, a saved `.svelte` file remounts the root. Editing a `.svelte.ts` or any other `.ts` or `.js` module needs a restart

## Decision

- Use gpuix-svelte 0.4.1 (pinned in `package.json`)
- `build.ts` calls `build({ entry: './standalone.ts' })`. Before that it draws editmd's icon with editmd's `scripts/make-icon.swift` and keeps the 1024 px PNG as `dist/AppIcon-1024.png`
- `standalone.ts` writes its window options out in its `render()` call. `app` names the app `editmd-gpuix` with identifier `dev.gpuix.editmd`, its copyright line and `./dist/AppIcon-1024.png` as its icon
- build() writes the Info.plist, so the port's `Resources/Info.plist` is deleted
- `build.ts` runs on macOS only and stops elsewhere: the port ships for macOS and its icon is drawn in Swift. After build() it:
  - copies satteri's addon, the `main` of `@bruits/satteri-${platform}-${arch}`, to `Contents/Resources/satteri.node`
  - sets `LSMinimumSystemVersion` to 14.0 and `LSApplicationCategoryType` to `public.app-category.productivity` with `plutil`, the keys editmd's Info.plist sets
  - signs the bundle ad hoc, as editmd's `scripts/build.sh` does
- `standalone.ts` imports `src/host/satteriAddon.ts` first. In a `.app` that holds `Contents/Resources/satteri.node`, it sets `NAPI_RS_NATIVE_LIBRARY_PATH` to that file, imports satteri and deletes the variable again. It does nothing outside a `.app` or when the variable is already set
- The `satteri-native` plugin is removed

## Consequences

- `pnpm build` on macOS writes `dist/editmd-gpuix.app` (build() logs 109.6 MB; after the ad hoc signature the executable is 108.9 MB), identifier `dev.gpuix.editmd`, with editmd's icon. The executable sits only inside the `.app`
- Developer ID signing and notarizing wait. build() signs when `CODESIGN_IDENTITY` is set, but the addon copy and the plist keys change the bundle after that and would void its signature. `build.ts` therefore exits with an error when `CODESIGN_IDENTITY` is set
- The upstream ask is a `plugins` or extra-files option in build(), so the addon goes in before build() signs. Not filed: the user decides
- gpuix-svelte 0.4.1 still vendors `devalue` 5.9.2 (`node_modules/gpuix-svelte/node_modules/devalue`), as 0.3.0 did ([ADR-0012](0012-gpuix-svelte-0.3.md)); `socket package score npm gpuix-svelte@0.4.1` (2026-11-04) reports its high `cve` alert, as [ADR-0010](0010-tooling.md) describes it, and one low `gptAnomaly` alert on `zod` 4.6.7

## Evidence

- gpuix-svelte v0.3.0...v0.4.1 compare (`gh api repos/khromov/gpuix-svelte/compare/v0.3.0...v0.4.1`, read 2026-11-04), its `starter/AGENTS.md` and the gpuix-svelte Guide on hot reload
- `node_modules/gpuix-svelte/lib/build.d.ts` (`BuildOptions`: `entry`, `outdir`) and `app-bundle.d.ts` (`MIN_MACOS = "13.0"`, `read_app_options`)
- 2026-11-04, a binary built by build() with no addon route: `Cannot find module '@bruits/satteri-darwin-arm64'`. With `NAPI_RS_NATIVE_LIBRARY_PATH` set for the whole process: `undefined is not a constructor (evaluating 'new I0.GpuixRenderer(...)')`
- 2026-11-04, `dist/editmd-gpuix.app` from `pnpm build`: `--normalize` headless prints the normalized fixture, a window launch with `GPUIX_SCREENSHOT` painted the opened file, and `codesign --verify` reports it valid
