import { join } from 'node:path'
import { supportFolder } from './supportFolder.ts'

/** where File > Open Recent is kept, one store for every editor process (ADR-0008), beside the sockets folder */
export const RECENT_STORE = join(supportFolder(), 'recent.json')
