# ADR-0017: Whole-text reparse and Sätteri 0.11.6

## Status

Accepted, 2026-11-06. Amends [ADR-0002](0002-markdown-engine-satteri.md) (the `MarkdownEngine` type, block-local
reparse, the Sätteri version). ADR-0002's two "Amendment" sections of 2026-10-29 and 2026-11-05 recorded these
changes inside the accepted ADR; this ADR is where they belong.

## Context

ADR-0002 decided Sätteri `0.10.5` behind a `MarkdownEngine` type, with a block-local reparse on keystrokes above about
100KB, because a full parse of 1MB took 35.678ms (median) in its S3 benchmark.

## Decision

- `src/engine/blocks.ts` calls Sätteri directly (`parseBlocks`); there is no `MarkdownEngine` type
- The Document reparses its whole text after each change, once per change however many edits it holds; block-local
  reparse is not built and stays the way to documents far above 100KB
- Sätteri is `satteri@0.11.6`, pinned exactly: 0.11.1 and 0.11.3 shipped without their native bindings

## Consequences

- A keystroke in a 100KB document costs one parse of about 2.509ms (median, ADR-0002's S3 table); in a 1MB document
  about 35.678ms, which the port accepts for now
- The `.app` keeps satteri's addon route: its file name and the `NAPI_RS_NATIVE_LIBRARY_PATH` loader are unchanged on
  0.11.6 ([ADR-0013](0013-gpuix-svelte-0.4.md))
- 0.11 parses a numbered list that starts above 1 right after indented code as a list, as CommonMark and editmd's
  Milkdown do; 0.10.5 made it a paragraph

## Evidence

- `src/core/document.ts` reparses the whole text after each change; docs/architecture.md states the cost
- `src/engine/blocks.test.ts`: the numbered list after indented code
- 2026-11-05, on 0.11.6: the headless UI suite gave the same 545 records as on 0.10.5, the end-to-end suites headless
  printed the same check lines, and the layout measurements and the 40 `--snapshot` pages were byte-identical
