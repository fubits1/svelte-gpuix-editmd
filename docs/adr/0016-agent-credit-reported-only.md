# ADR-0016: Agent credit for reported changes only

## Status

Accepted, 2026-11-05. Amends [ADR-0008](0008-windows-and-ipc.md) (the fallback for changes no agent reported).

## Context

editmd credits a change no agent reported to the one known agent process whose working folder is the deepest folder
above the file (`AgentEdits.swift:29-37`, `EditmdCore/AgentEdits.swift:193-213`), matched by the kernel's short process
name. A user's own edit in another editor, made while an agent works in a folder above the file, is then credited to
that agent.

## Decision

- A change is credited to an agent only when the agent reported it through `--report-edit` (a Claim). Any other change
  is an Outside edit
- The port does not look at running processes: no `ps` or `lsof` runs for an outside change

## Consequences

- An agent without the report hook shows its changes as Outside edit
- `--selftest` runs 51 lines; editmd's agentProcesses group has no counterpart
- `src/host/attribution.ts` holds the Claims only

## Evidence

- `src/host/attribution.test.ts`: a change no agent reported is credited to nobody
- `pnpm test`, 2026-11-05: 96 of 96 files, 2151 tests passed
