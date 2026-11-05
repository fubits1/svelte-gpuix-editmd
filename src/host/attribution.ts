import { AgentEditClaims, type AgentAuthor, type AgentEditReport } from '../core/agentEdits.ts'

/**
 * who changed a file: the latest live Claim from a Report, else nobody (an Outside edit)
 *
 * editmd guesses an agent from the processes working above the file (AgentEdits.swift:29-37); the port does not, so the
 * user's own edit in another editor is never credited to an agent.
 */
export class Attribution {
	#claims = new AgentEditClaims()
	#now: () => number

	/**
	 * `now` is in seconds, like the Claims' policy: by default the process's uptime, as editmd's claims run on the
	 * system's (AgentEdits.swift:33,74), so a wall clock that is set never stretches or cuts a claim
	 */
	constructor(now: () => number = () => performance.now() / 1000) {
		this.#now = now
	}

	report(report: AgentEditReport): void {
		this.#claims.report(
			{ ...report, paths: report.paths.map((path) => AgentEditClaims.key(path)) },
			this.#now()
		)
	}

	/** The lookup takes the resolved path, as editmd's (AgentEdits.swift:32-33). */
	authorOfChange(path: string): AgentAuthor | null {
		return this.#claims.authorOfChange(AgentEditClaims.key(path), this.#now())
	}
}
