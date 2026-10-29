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
