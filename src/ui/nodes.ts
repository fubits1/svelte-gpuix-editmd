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

/**
 * the first ancestor of `node` that reports a scroll offset, with its viewport, the painted box of what it scrolls
 * (its child on the way to `node`) and `node`'s painted box
 */
export function scrollingAncestorOf(node: ShadowNode) {
	const native = get_native()
	const target = boxOf(node)
	if (!native || !target) return null
	let content = target
	for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
		if (ancestor.nativeId === null) continue
		const offset = native.getScrollOffset(ancestor.nativeId)
		const box = native.getElementBounds(ancestor.nativeId)
		if (offset && box)
			return { native, id: ancestor.nativeId, offset, viewport: box, target, content }
		if (box) content = box
	}
	return null
}
