import { join } from 'node:path'
import { supportFolder } from './supportFolder.ts'

/** where the Agent legend's minimized state is kept, one store for every editor process, beside Open Recent's */
export const LEGEND_STORE = join(supportFolder(), 'legend.json')
