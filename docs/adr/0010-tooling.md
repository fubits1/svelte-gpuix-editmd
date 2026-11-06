# ADR-0010: Tooling and supply chain

## Status

Accepted, 2026-10-25

## Context

gpuix-svelte's own repo installs with Bun, and its starter documents npm. The project rule is pnpm for installs and a Socket check before any new dependency. gpuix-svelte publishes its vendored Svelte through `bundleDependencies`, and it was not known whether that works under pnpm.

## Decision

- pnpm for installs. Every package-manager command names the project directory explicitly: `pnpm --dir <project> ...`
- Bun only for `Bun.build({compile})` binaries
- vitest and fast-check for pure TypeScript tests, co-located as `*.test.ts`
- `gpuix-svelte/test` for the headless UI suite and `gpuix-svelte/automation` for the end-to-end suites, both run by
  Vitest (2026-11-05): the projects `ui` and `e2e` in `vitest.config.ts` use forks and Node's native module loader
  (`experimental.viteModuleRunner: false`) with the gpuix bin's flags (`--conditions=custom-renderer`,
  `--conditions=development`, `--import=gpuix-svelte/register`). `pnpm test` runs the end-to-end suites headless
  through `e2e/headless-app.ts`; `pnpm test:e2e:window` runs them in real windows
- `socket package score npm <pkg>@<ver> --markdown` before adding a dependency
- Prettier formats the code. Its configuration lives in the project's Prettier config file

## Consequences

- Window and headless runs need the Claude Code Bash sandbox disabled ([ADR-0001](0001-native-host-gpuix-svelte.md))

### devalue advisory

gpuix-svelte 0.2.0 bundles `devalue` 5.9.2 inside its vendored Svelte (`node_modules/gpuix-svelte/node_modules/devalue`). Seven GitHub advisories published 2026-10-01 affect versions up to 5.9.2, four of them high severity (for example GHSA-j22f-vq7h-c4qm). All are fixed in 5.9.3.

- A pnpm `overrides` entry cannot reach a `bundleDependencies` copy. The override did update the registry copy pulled in by `svelte-check` (devalue 5.9.4), but the bundled copy stayed at 5.9.2
- In upstream Svelte, `devalue` is imported only in `src/internal/server/hydratable.js` and `src/internal/server/renderer.js` (SSR serialization). gpuix loads the client build. The vendored PR build itself was not inspected (unverified)
- User decision: "drop override and ignore for now". The override was removed

### Socket checks

| Package                     | Result                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| gpuix-svelte@0.2.0          | deep score 37, high `cve` alert from devalue@5.9.2 (see above)                                                                             |
| create-gpuix-svelte@0.2.0   | deep score 37, no CVE alert                                                                                                                |
| satteri@0.10.5              | shallow 87, deep 38, no CVE; middle `shellAccess`, `usesEval` (from @emnapi on the WASI path)                                              |
| pele@1.10.0                 | 96, no dependencies                                                                                                                        |
| yjs@13.6.33                 | shallow 89, deep 63 (lowest isomorphic.js@0.2.5), no CVE; middle `gptSecurity` on lib0                                                     |
| vitest@5.0.5                | shallow 78, deep 37, no CVE; the deep score counts optional browser-mode peers (happy-dom, edgedriver) this project does not install       |
| fast-check@4.10.2           | shallow 88, deep 83, no alerts                                                                                                             |
| knip@6.44.1                 | 92                                                                                                                                         |
| svelte-check@4.7.8          | shallow 94, deep 64, no CVE                                                                                                                |
| eslint@10.14.0              | shallow 95, deep 68; medium CVE in minimatch@10.2.6 (GHSA-g3hv-75wg-m249, a denial of service, fixed in 11.0.1, outside eslint 10's range) |
| eslint-plugin-svelte@3.24.0 | shallow 95, deep 64; the same minimatch CVE                                                                                                |
| globals@17.14.0             | 85, no alerts                                                                                                                              |
| satteri@0.11.6              | shallow 93, deep 37, no vulnerabilities                                                                                                    |

yjs, vitest and fast-check were pending because the Socket token ran out of quota ("Requires 100, but token has only 35"). User decision: "Install, check later". They were installed then and should have been checked before Phase 1 code landed; they were checked on 2026-10-25 at the end of Phase 3, with the results above and no vulnerability alert in any of them.

## Evidence

- S1 (2026-10-25): pnpm install with the bundled Svelte works. Typecheck 318 files, 0 errors; starter window screenshot; `pnpm --dir . test` prints `starter ok`
- S7 (2026-10-25): vitest 5.0.5 with fast-check 4.10.2 runs the ported editmd property tests, 10 of 10 green
- 2026-11-05: under Vitest 5.1.0 the headless UI suite runs the same 545 checks as the script it replaced, with the
  same values in the same order and the same code covered; the end-to-end suites headless print the same check lines
  as the scripts they replaced. `pnpm test`: 98 files, 2151 tests passed
- TypeScript stays 5.9.3: TypeScript 7.0 ships no compiler API, which svelte-check and typescript-eslint need
