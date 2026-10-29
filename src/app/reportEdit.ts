import { join } from 'node:path'
import { parseAgentEditReport } from '../core/agentEdits.ts'
import { sendReport } from '../host/agentIpc.ts'
import { supportFolder } from './supportFolder.ts'

/** where every open editor listens for Reports (ADR-0008) */
export const SOCKETS_DIRECTORY = join(supportFolder(), 'sockets')

/**
 * `editmd-gpuix --report-edit`: an agent hook's stdin payload, sent to every open editor as a Report.
 * like editmd it never fails the hook: a payload naming no file or session is dropped
 */
export async function reportEdit(
	payload: string,
	environment: Record<string, string | undefined>,
	directory: string = SOCKETS_DIRECTORY
): Promise<void> {
	const report = parseAgentEditReport(payload, environment)
	if (report) await sendReport(directory, report)
}
