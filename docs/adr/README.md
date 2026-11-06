# Architecture decision records

| ADR                                                 | Title                                                        | Status                                         |
| --------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| [0001](0001-native-host-gpuix-svelte.md)            | Native host on gpuix-svelte                                  | Accepted, 2026-10-25; amended by 0012 and 0013 |
| [0002](0002-markdown-engine-satteri.md)             | Sätteri as the single markdown engine                        | Accepted, 2026-10-25; amended by 0013 and 0017 |
| [0003](0003-block-click-to-edit.md)                 | Block click-to-edit over source slices                       | Accepted, 2026-10-25; amended by 0018          |
| [0004](0004-document-model-and-merge.md)            | Document model and merge                                     | Accepted, 2026-10-25; amended by 0019          |
| [0005](0005-rendering-native-markdown-per-block.md) | Native markdown element per block, custom views for the rest | Accepted, 2026-10-25; amended by 0020          |
| [0006](0006-mermaid-via-pele.md)                    | Mermaid through pele, shown as an image                      | Accepted, 2026-10-25; amended by 0015          |
| [0007](0007-flat-css-exemption.md)                  | Flat CSS rules in gpuix components                           | Accepted, 2026-10-25                           |
| [0008](0008-windows-and-ipc.md)                     | One process per document, agent reports over unix sockets    | Accepted, 2026-10-25; amended by 0016          |
| [0009](0009-parity-gaps-native-track.md)            | Parity gaps and the native track                             | Accepted, 2026-10-25; amended by 0012          |
| [0010](0010-tooling.md)                             | Tooling and supply chain                                     | Accepted, 2026-10-25; amended by 0014          |
| [0011](0011-state-location.md)                      | State location and component composition                     | Accepted, 2026-10-25; amended by 0021          |
| [0012](0012-gpuix-svelte-0.3.md)                    | gpuix-svelte 0.3.0: scrolling and Tab                        | Accepted, 2026-10-29; amended by 0013          |
| [0013](0013-gpuix-svelte-0.4.md)                    | gpuix-svelte 0.4.1 and its build()                           | Accepted, 2026-11-04                           |
| [0014](0014-typescript-6.md)                        | TypeScript 6                                                 | Accepted, 2026-11-05                           |
| [0015](0015-pele-1.13.md)                           | pele 1.13.0                                                  | Accepted, 2026-11-05                           |
| [0016](0016-agent-credit-reported-only.md)          | Agent credit for reported changes only                       | Accepted, 2026-11-05                           |
| [0017](0017-whole-text-reparse.md)                  | Whole-text reparse and Sätteri 0.11.6                        | Accepted, 2026-11-06                           |
| [0018](0018-field-types-as-editmd.md)               | The Block field types as editmd's editor does                | Accepted, 2026-11-06                           |
| [0019](0019-document-as-one-string.md)              | The Document as one string, undo by merges                   | Accepted, 2026-11-06                           |
| [0020](0020-views-by-block-kind.md)                 | Views dispatched by Block kind in a plain Scroller           | Accepted, 2026-11-06                           |
| [0021](0021-find-bar-and-controllers.md)            | The find bar in the window's column, the controllers         | Accepted, 2026-11-06                           |

Spike results S1 to S8 cited in the ADRs come from Phase 0 of the port plan; each ADR states the result it relies on.
