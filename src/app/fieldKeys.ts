import { focus_element, focused_element, get_native, type ShadowNode } from 'gpuix-svelte'

/** how often a freshly mounted field is looked for, and for how many tries (about a second) */
const POLL_MS = 16
const POLL_TRIES = 60

/**
 * sends `keys` to the field `node` once it has the keys: a field mounted with `autofocus` takes them on its first
 * paint, which follows its mount, so it is polled until then. gpuix gives a field no selection API (gap G1), so its
 * own keys select (`cmd-a`) or move its caret (`cmd-up`), as `simulateKeystrokes` sends them. false when
 * the field never took the keys
 */
export async function keysOnceFocused(node: ShadowNode, keys: string): Promise<boolean> {
	for (let attempt = 0; attempt < POLL_TRIES; attempt++) {
		if (node.live && node.nativeId !== null) {
			focus_element(node)
			if (focused_element()?.nativeId === node.nativeId) {
				get_native()?.simulateKeystrokes(keys)
				return true
			}
		}
		await new Promise((resolve) => setTimeout(resolve, POLL_MS))
	}
	return false
}
