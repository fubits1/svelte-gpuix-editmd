# ADR-0008: One process per document, agent reports over unix sockets

## Status

Accepted, 2026-10-25

## Context

gpuix-svelte supports one window per process: `render.ts` keeps the window in a single `globalThis` slot. editmd opens many documents in tabs and windows.

editmd receives agent edit reports through `editmd --report-edit`. The command reads the agent hook's JSON on stdin and posts a macOS `DistributedNotificationCenter` notification named `com.kirahowe.editmd.agentEdit` with `{id, name, phase, paths}`. Node has no DistributedNotificationCenter.

## Decision

- Each document runs in its own process. New and Open spawn `gpuix-svelte app.ts <path>` detached
- `editmd-gpuix --report-edit` reads the hook JSON on stdin and writes the report to every live instance's unix socket in `~/Library/Application Support/editmd-gpuix/sockets/`
- The report format, the claim timing (before: 600s, after: 3s) and the fallback that attributes a change to the running agent whose cwd is the deepest prefix of the file path are ported from editmd's `AgentEdits.swift`

## Consequences

- No window tabs and no shared-process windows (gap G3)
- Stale sockets from crashed instances must be detected and skipped
- Each instance owns its own file watcher and autosave state, which matches editmd's per-document `NSDocument` model

## Evidence

- gpuix-svelte `CLAUDE.md` and `src/render.ts` (read 2026-10-25): one window per process
- editmd `Sources/EditmdCore/AgentEdits.swift` and `Sources/editmd/AgentEdits.swift` inventory (2026-10-25): report parsing, claims, process fallback, notification name
- The unix-socket design itself is not yet tested
