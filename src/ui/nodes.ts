import { get_native, type ShadowNode } from 'gpuix-svelte'

/** keys a node into `nodes`; its release leaves the key alone once a newer node holds it */
export const trackIn =
	<K>(nodes: Map<K, ShadowNode>) =>
	(key: K, node: ShadowNode) => {
		nodes.set(key, node)
		return () => {
			if (nodes.get(key) === node) nodes.delete(key)
		}
	}

/** `node`'s box as last painted, null before its first paint */
export const boxOf = (node: ShadowNode | null | undefined) =>
	node?.nativeId == null ? null : (get_native()?.getElementBounds(node.nativeId) ?? null)
