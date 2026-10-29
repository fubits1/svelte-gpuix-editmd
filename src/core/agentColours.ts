/** editmd's six Agent colours */
const AGENT_SLOTS = 6

/**
 * editmd's Agents registry: an Agent's colour slot is fixed at first sight for the session, so it
 * stays the same when other Agents' highlights come and go
 */
export class AgentColours {
	#slots = new Map<string, number>()

	slotOf(agentId: string): number {
		let slot = this.#slots.get(agentId)
		if (slot === undefined) {
			slot = this.#slots.size % AGENT_SLOTS
			this.#slots.set(agentId, slot)
		}
		return slot
	}
}
