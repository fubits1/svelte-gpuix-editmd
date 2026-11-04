# AGENTS.md

This is a gpuix-svelte app: Svelte 5 components rendered
into a native desktop window by GPUI, the GPU-accelerated UI framework behind the Zed editor. It runs
on Node.js >= 26 (package.json `engines`) or Bun >= 1.4.

## Documentation

GPUI's elements, styling and events follow their own rules, so read the docs before writing UI code.
Fetch <https://khromov.github.io/gpuix-svelte/llms.txt>, then the pages it links for the task at hand.

## Commands

```bash
pnpm dev             # opens the window; saving a .svelte file remounts it, a .ts/.svelte.ts/.js change needs a restart
pnpm test            # unit tests, then the headless test (test.ts) through GPUI's real hit testing
pnpm typecheck       # tsc, then svelte-check against GPUI's element types
pnpm build           # dist/editmd-gpuix.app through gpuix-svelte/build; macOS only, needs Bun
```

After a change, run `pnpm typecheck` and `pnpm test`. To see what the window draws,
run `GPUIX_SCREENSHOT=/tmp/app.png pnpm dev`: it writes a PNG after every mount and hot reload.

## Building

**Building standalone executables requires Bun** (>= 1.4), even in a project that uses npm and Node.

`pnpm build` runs `build.ts`, which calls `build()` from `gpuix-svelte/build`. It compiles
`standalone.ts` with Bun into a self-contained executable that carries the Bun runtime, Svelte and
the GPUI addon, and on macOS packages it as `dist/editmd-gpuix.app` (about 109 MB) with editmd's
icon. Open the `.app`: Finder runs a bare executable through Terminal.

- The name, identifier, copyright and icon are the `app` options `standalone.ts` hands `render()`.
  The build reads them from the source, so keep `render()` a top-level call with no spread in its
  options and write each `app` option as a string or a top-level `const` holding one; an `app` value
  computed at runtime fails the build.
  `build.ts` draws the icon to `dist/AppIcon-1024.png` with `scripts/make-icon.swift` first.
- `build()` takes no plugins and no extra files, so on macOS `build.ts` changes the `.app` after it:
  it copies satteri's native addon into `Contents/Resources`, where `src/host/satteriAddon.ts`
  points satteri's loader, sets `LSMinimumSystemVersion` 14.0 and `LSApplicationCategoryType`
  productivity with `plutil`, and signs it ad hoc ([ADR-0013](docs/adr/0013-gpuix-svelte-0.4.md)).
- With `CODESIGN_IDENTITY` set, `build.ts` stops, since its steps after `build()` would void the
  signature `build()` makes. Developer ID signing and notarizing wait for `build()` to take plugins
  or extra files.
- `pnpm build` runs on macOS only and stops elsewhere: the port ships for macOS, its icon is drawn in
  Swift as editmd's is, and `@gpuix/native` ships no Intel Mac build (its macOS package is
  `@gpuix/native-darwin-arm64`), so the output is for macOS arm64.
- `standalone.ts` mounts `App.svelte` with `render` and a static import, since a binary has no
  source files to hot-reload. Keep its window options in step with `app.ts`.
- The app is signed ad hoc, not notarized, so macOS keeps a downloaded copy from opening until it
  is allowed under System Settings → Privacy & Security.

## Writing components

- Elements are GPUI's: `div`, `text`, `img`, `svg`, `input`, `textarea`, `code`, `diff`,
  `markdown`, `virtual-list`, `anchored`. Any other tag (`span`, `button`, `p`) fails the
  typecheck and renders as a `div`. `<img src>` takes a file path, a `data:` URL or an http(s) URL;
  give it a `width` and `height` in its style, or it takes the image's size once loaded and the
  layout jumps.
- Style with `<style>` class rules (`.btn`, `.btn.primary`, `.btn:hover`, `.btn:active`,
  `.btn:focus-visible` with `outline-*` for the keyboard focus ring, on an element with `tabindex`)
  and inline `style=`. Layout is flexbox, or `display: grid` with `grid-template-columns: <count>`,
  in logical pixels: lengths in `px` or `rem` (16 px), and `%`/`auto` only for `width`, `height`,
  `min-*` and `max-*`. Use `flex-grow: 1; flex-basis: 0` for `flex: 1`, and `border-width` plus
  `border-color` for `border`; both shorthands are dropped. The styling page lists every property.
- Colours go in `var(--token)`, with the palette set once from the root through
  `set_css_vars({ token: '#fff' })`.
- Inputs report through events: `<input value={text} onchange={(e) => (text = e.value)} />`;
  `onchange` fires on every edit, and there is no `oninput`. `{@attach (node) => ...}` hands you
  an element.
- Mouse events don't bubble: a click fires on each listening element under the pointer, down to
  and including the first that paints a background or is `position: absolute`, which hides what is
  behind it. Put `hitbox="self"` on a clickable element whose children paint a background, and it
  receives their clicks (children with a handler of their own, inputs, and focusable or scrolling
  elements keep theirs). A clickable child with no background fires along with its clickable
  parent, and `stopPropagation()` can't stop that; give the child a background or
  `pointer-events: auto`. `onclick` is the primary button; right and middle clicks are
  `onauxclick`, and macOS's ctrl+click is an `onclick` with `e.modifiers.ctrl`.
- An element's `onkeydown` fires only while it or a descendant has focus, so a `div` that listens
  needs a `tabindex`.
- App-wide keyboard shortcuts: `on_window_key('keydown', handler)` from `gpuix-svelte`, returned
  from an `$effect` so it unsubscribes; it also hears keys typed into a field, which `e.editing`
  flags. Tab and Shift+Tab already move focus through the tab stops (`tabindex` elements,
  `<input>`, `<textarea>`); don't wire them to `focus_next()`, and call `e.preventDefault()` in any
  handler of that keystroke, the element's or the window's, to keep focus where it is. How a
  Block's field takes Tab is in [ADR-0012](docs/adr/0012-gpuix-svelte-0.3.md).
- Scrolling content goes in `Scroller` (`gpuix-svelte/components/Scroller.svelte`), which draws the
  scrollbar; modals, menus and toasts go in `Portal` (`gpuix-svelte/components/Portal.svelte`),
  which paints on top; hover tips and dropdowns that sit beside a trigger go in `Tooltip` and
  `Popover` from the same directory.
- Only `.svelte` files hot-reload: a saved one remounts the root. State that should survive a
  reload goes in a `.svelte.ts` module; editing one, or any other `.ts` or `.js` module, needs a
  restart.
- Handlers take `GpuixEvent` and `{@attach}` gets a `ShadowNode`, both importable as types from
  `gpuix-svelte`.

## TypeScript

`.ts` files run through Node's and Bun's built-in type stripping, not a compiler, and `tsconfig.json`
enforces what that allows: no enums, namespaces or constructor parameter properties, `import type`
for anything that is only a type, and relative imports spelled with their extension. Write `./util.ts`: tsc
also accepts `./util.js`, which Node then cannot find.

## Dependencies

`gpuix-svelte` brings its own build of Svelte, the one with the custom renderer API, and resolves
every `svelte` import to it. Keep `svelte` itself out of `package.json`.

## Files

- `app.ts` — the entry: `render_hot` opens the window and remounts `App.svelte` on save.
- `App.svelte` — the root component.
- `test.ts` — the headless test (`gpuix-svelte/test`); a plain script that exits 1 on failure, and also when the
  count given to `finish()` is not how many `check()`s ran, so keep it in step.
- `standalone.ts`, `build.ts` — the entry and the build script behind `pnpm build`.
- `startup.ts` — what both entries run before the window opens: the command line's headless modes and agent hook,
  and the Document the window shows.
- `tsconfig.json`, `svelte.d.ts`, `svelte.config.js` — TypeScript and svelte-check setup.
