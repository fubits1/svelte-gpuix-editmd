/**
 * the headless suite's own support folder: imported first, before any module reads `EDITMD_GPUIX_SUPPORT`
 * (src/app/supportFolder.ts, src/app/reportEdit.ts), so its sockets, Open Recent and legend never reach the user's. it
 * sits in the temp folder because a socket path in it must stay under the 104 bytes a unix socket address holds
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

const support = mkdtempSync(join(tmpdir(), 'eg-ui-'))
process.env.EDITMD_GPUIX_SUPPORT = support
// removed after the run, not on exit: Vitest ends the fork with SIGTERM, which runs no exit handler
afterAll(() => rmSync(support, { recursive: true, force: true }))
