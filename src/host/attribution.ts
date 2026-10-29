import {
	AgentEditClaims,
	type AgentAuthor,
	type AgentEditReport,
	type AgentProcess,
	processAuthorOfChange
} from '../core/agentEdits.ts'

/** who changed a file: the latest live Claim from a Report, else the agent process working above it (editmd's order) */
export class Attribution {
	#claims = new AgentEditClaims()
	#listProcesses: () => AgentProcess[]
	#now: () => number

	/**
	 * `now` is in seconds, like the Claims' policy: by default the process's uptime, as editmd's claims run on the
	 * system's (AgentEdits.swift:33,74), so a wall clock that is set never stretches or cuts a claim
	 */
	constructor(
		listProcesses: () => AgentProcess[],
		now: () => number = () => performance.now() / 1000
	) {
		this.#listProcesses = listProcesses
		this.#now = now
	}

	report(report: AgentEditReport): void {
		this.#claims.report(
			{ ...report, paths: report.paths.map((path) => AgentEditClaims.key(path)) },
			this.#now()
		)
	}

	/** both lookups take the resolved path, as editmd's (AgentEdits.swift:32-34): lsof reports folders resolved */
	authorOfChange(path: string): AgentAuthor | null {
		const key = AgentEditClaims.key(path)
		return (
			this.#claims.authorOfChange(key, this.#now()) ??
			processAuthorOfChange(key, this.#listProcesses())
		)
	}
}
