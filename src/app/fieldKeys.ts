import { focus_element, focused_element, get_native, type ShadowNode } from 'gpuix-svelte'

/** how often a freshly mounted field is looked for, and for how many tries (about a second) */
export const FIELD_POLL_MS = 16
export const FIELD_POLL_TRIES = 60

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** sends `keys` to the focused field, as `simulateKeystrokes` types them */
export const sendKeystrokes = (keys: string) => get_native()?.simulateKeystrokes(keys)

/** gives the painted field `node` the keys; true when it has them */
export function takeKeys(node: ShadowNode): boolean {
	focus_element(node)
	return focused_element()?.nativeId === node.nativeId
}

/**
 * sends `keys` to the field `node` once it has the keys: a field mounted with `autofocus` takes them on its first
 * paint, which follows its mount, so it is polled until then. gpuix gives a field no selection API (gap G1), so its
 * own keys select (`cmd-a`) or move its caret (`cmd-up`), as `simulateKeystrokes` sends them. false when
 * the field never took the keys
 */
export async function keysOnceFocused(node: ShadowNode, keys: string): Promise<boolean> {
	for (let attempt = 0; attempt < FIELD_POLL_TRIES; attempt++) {
		if (node.live && node.nativeId !== null && takeKeys(node)) {
			sendKeystrokes(keys)
			return true
		}
		await delay(FIELD_POLL_MS)
	}
	return false
}

/** how often a field's focus is read, as Find reads its matches */
const FOCUS_POLL_MS = 100

/**
 * an attachment that tells `focused` whether its field has the keys, read from native on a poll: an autofocused field
 * reports no focus event (measured headless: native held the field focused, no `focus` reached it), and gpuix has no
 * focus-change event to listen to
 */
export const trackFocus = (focused: (has: boolean) => void) => (node: ShadowNode) => {
	const poll = setInterval(
		() => focused(focused_element()?.nativeId === node.nativeId),
		FOCUS_POLL_MS
	)
	return () => clearInterval(poll)
}
