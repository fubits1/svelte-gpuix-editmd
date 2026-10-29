# ADR-0002: Sätteri as the single markdown engine

## Status

Accepted, 2026-10-25

## Context

editmd parses and serializes with remark through Milkdown (remark-gfm, remark-stringify). The port needs one engine for block splitting, node kinds, source offsets, frontmatter, heading slugs and HTML export for printing. It must run in Node and Bun without a DOM, and it must read existing GFM files faithfully.

The original request named "the latest mdsvex (v1)". The user then asked for "one engine for everything", with "absolute parity, with performance gains if possible".

## Decision

Use Sätteri `satteri@0.10.5` as the only markdown engine, behind a `MarkdownEngine` type in `src/engine/engine.model.ts` so it can be swapped.

- Parse with `markdownToMdast(source, { position: true })`. Positions are unist positions with UTF-16 offsets, which match JS string indices
- Full parse on load and on merge. Above about 100KB, keystrokes trigger a block-local reparse (from the previous block start to the next blank line) instead of a full parse
- Use `markdownToHtml` for the print export ([ADR-0009](0009-parity-gaps-native-track.md), gap G5)
- The block editor splices source text, so no serializer is needed ([ADR-0003](0003-block-click-to-edit.md))
- `.svx` and MDX are out of scope. They are not editmd features

## Amendment, 2026-10-29

- Neither the `MarkdownEngine` type nor block-local reparse was built. `src/engine/blocks.ts` calls Sätteri directly (`parseBlocks`), and the Document reparses its whole text after each change, once per change however many edits it holds. Block-local reparse remains the way to large documents (see the 1MB figure below)

## Consequences

- GFM is on by default: tables, footnotes, strikethrough, task lists, autolinks. YAML and TOML frontmatter come back as raw strings
- Extensions are AST transforms only (`defineMdastPlugin`, `defineHastPlugin`). No new syntax can be added, and remark or rehype plugins do not run
- Pre-1.0: breaking changes are expected on minor bumps
- Known open issues: #326 (7 CommonMark edge cases such as `*_*a` and `- [ ]\r\n  b`) and #337 (CRLF spec tests)
- Documented divergences: a task item's paragraph starts after the checkbox, table alignment is emitted as a style, unknown directives are dropped
- A second napi addon ships in the binary. The Bun build needs the `satteri-native` plugin described below
- Bun support is not documented upstream. It works in this project (S2), which is the only verification

## Alternatives considered

- mdsvex v1 (`1.0.0-next.2`, the `next` dist-tag; `latest` is 0.12.8). Rejected:
  - its own "Penguin-Flavoured Markdown" dialect breaks GFM: emphasis is always `_`, strong is always `*`, and there are no setext headings, no indented code, no `~~~` fences, no trailing-space hard breaks, no bare-URL autolinks and no lazy continuation
  - `packages/migrate/README.md@next` says: "mdsvex next has its own parser and runs no remark or rehype plugins."
  - the grammar is a hand-written state machine (`packages/parse/src/main.ts`, reported as about 13k lines, unverified line count) with no compat flag
  - `PLUGINS.md` lists under "What parse plugins cannot do": "Modify the parser itself or affect how tokens become nodes"
  - it has no markdown serializer. pngwn in discussion #293: "PFM will have distinct syntax for emphasis and strong emphasis. This is a hard break from the spec but a necessary one."
  - a GFM-compatible fork was estimated at months of work. That estimate is a subagent's judgement and unverified
- micromark / mdast-util-from-markdown (pure JS, reference CommonMark, syntax extensions, `mdast-util-to-markdown` serializer). Rejected for more glue code. The plan's original note also called it slower, which was never measured

## Evidence

S3 benchmark (2026-10-25, `markdownToMdast(source, { position: true })`, Node 26.6.0, times include JS tree materialization). Fixtures are from kirahowe/editmd@9e889e6 `web/test/`:

| Input                        | Bytes   | Top-level blocks | Median ms | Max ms |
| ---------------------------- | ------- | ---------------- | --------- | ------ |
| corpus cases (498, per case) | 17268   | n/a              | 0.010     | 0.539  |
| sample.md                    | 692     | 19               | 0.054     | 0.243  |
| corpus joined                | 18262   | 511              | 0.486     | 1.012  |
| synthetic 100KB              | 109582  | 3066             | 2.509     | 4.193  |
| synthetic 1MB                | 1022782 | 28616            | 35.678    | 61.365 |

The gate was a 100KB document under 4ms. It passes on the median (2.509ms). The 1MB result makes a full reparse per keystroke too slow above roughly 100KB, hence block-local reparse.

S2 (2026-10-25), pass:

- under gpuix-svelte on Node 26.6.0 and with `--bun` on Bun 1.4.4, Sätteri parses `sample.md` inside a `.svelte.ts` module: 19 blocks, first block `yaml` (frontmatter is on by default)
- A plain `Bun.build({compile})` binary fails at runtime with `Cannot find module '@bruits/satteri-darwin-arm64' from '/$bunfs/root/spike-s2'`. The napi-rs loader uses `createRequire(import.meta.url)`, which Bun.build cannot trace
- Fix: a `satteri-native` onLoad plugin (now in `build.ts`) replaces `nativeBinding = requireNative()` with a static import of the `.node` file named by `@bruits/satteri-${platform}-${arch}`'s `main`. The binary then runs from `/tmp/editmd-gpuix-s2` with no `node_modules` and prints `yaml,heading,list`
- `build.ts` carries this plugin next to gpuix's `resolve_native_cjs`

Registry facts (`pnpm view satteri`): 0.10.5, MIT, published 2026-08-19, napi prebuilds for darwin-arm64, darwin-x64, linux, win32 and wasm32-wasi. Repo bruits/satteri. The parser is a fork of pulldown-cmark, the same parser family as gpuix's `<markdown>` element (pulldown-cmark 0.12).
