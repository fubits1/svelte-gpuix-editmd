import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * where every editor process keeps what they share (the agent sockets, Open Recent).
 * `EDITMD_GPUIX_SUPPORT` moves it, so an end-to-end run and the windows it spawns stay out of the user's
 */
export function supportFolder(env: Record<string, string | undefined> = process.env): string {
	return (
		env.EDITMD_GPUIX_SUPPORT || join(homedir(), 'Library', 'Application Support', 'editmd-gpuix')
	)
}

/** where File > Open Recent is kept, one store for every editor process (ADR-0008), beside the sockets folder */
export const RECENT_STORE = join(supportFolder(), 'recent.json')

/** where the Agent legend's minimized state is kept, one store for every editor process, beside Open Recent's */
export const LEGEND_STORE = join(supportFolder(), 'legend.json')

/** where untitled windows hold their numbers (`UntitledNumbers`), one registry for every editor process */
export const UNTITLED_FOLDER = join(supportFolder(), 'untitled')
