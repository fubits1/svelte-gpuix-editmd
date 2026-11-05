# ADR-0014: TypeScript 6

## Status

Accepted, 2026-11-05. Amends [ADR-0010](0010-tooling.md) (TypeScript version).

## Context

The port type-checks with `tsc` and `svelte-check`, and lints through typescript-eslint. TypeScript 6.0.3 (2026-04-16)
is the last release of the compiler written in TypeScript. TypeScript 7.0.2 (2026-07-08) is the compiler written in Go
and ships no programmatic API yet.

What the tools in use accept, read from their `package.json`:

- svelte-check 4.7.8: `typescript` `^5.0.0 || ^6.0.0`
- typescript-eslint 8.72.1: `typescript` `>=4.8.4 <6.1.0`
- eslint-plugin-svelte 3.24.0: no TypeScript requirement
- knip 6.44.1: no TypeScript dependency; it parses with oxc

The port's `tsconfig.json` sets none of the options TypeScript 6.0 deprecates (`baseUrl`, `moduleResolution: node10`
or `classic`, `target: es5`, `esModuleInterop: false`, `outFile`), and it sets `types` and `strict` explicitly, whose
defaults 6.0 changes.

svelte-check 4.7.8 can run its TypeScript diagnostics through TypeScript 7 with `--tsgo`. That needs TypeScript 7
installed next to TypeScript 6 (as `@typescript/native` or `@typescript/native-preview`) and writes translated Svelte
files to a `.svelte-check` folder.

## Decision

- TypeScript 6.0.3, as `~6.0.3`: typescript-eslint supports up to 6.0.x
- `svelte-check --tsgo` is not used. TypeScript 7 is not installed

## Consequences

- `pnpm typecheck` is unchanged: `tsc` and `svelte-check` run on TypeScript 6
- TypeScript 7 waits for svelte-check and typescript-eslint to run on it without a second TypeScript, and for
  svelte-check's `--tsgo` to check gpuix's elements
- `.svelte-check` is listed in `.gitignore`, for a `--tsgo` run

## Evidence

- 2026-11-05, on TypeScript 6.0.3 with no change to the code or `tsconfig.json`: `pnpm typecheck` 0 errors (931 files),
  `pnpm lint` clean, `pnpm test` 96 of 96 files and 2151 tests passed, unit coverage at or above the thresholds
- 2026-11-05, `svelte-check --tsgo` with TypeScript 7.0.2 installed as `@typescript/native`: 164 errors in 31 of 36
  Svelte files, where the check on TypeScript 6 reports none. Those read were gpuix's own attributes and events
  (`testid`, `hitbox`, `highlight`, `onchange`, `onmousemove`, an event's `value` and `modifiers`) checked against the
  browser's HTML types: `--tsgo` does not take
  `svelteOptions.namespace` (`gpuixHTML`) from `tsconfig.json`
- With TypeScript 7.0.2 installed as `@typescript/native`, its `tsc` command takes the place of TypeScript 6's in
  `node_modules/.bin`
- sveltejs/language-tools#3127 (open, 2026-09-29): with `--tsgo`, a TypeScript 7 process that is killed is reported as
  "found 0 errors and 0 warnings", exit code 0
- Socket, 2026-11-05: typescript@6.0.3 100, no dependencies; typescript@7.0.2 shallow 88, deep 77, no vulnerabilities
