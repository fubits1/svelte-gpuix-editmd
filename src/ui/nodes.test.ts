import type { ShadowNode } from 'gpuix-svelte'
import { describe, expect, it, vi } from 'vitest'
import { boxOf, trackIn } from './nodes.ts'

const box = { x: 1, y: 2, width: 3, height: 4 }
let native: { getElementBounds: (id: number) => typeof box | null } | null = null

// gpuix-svelte loads only under its custom renderer, so the window's handle is a stand-in
vi.mock('gpuix-svelte', () => ({ get_native: () => native }))

const nodeWith = (nativeId: number | null) => ({ nativeId }) as ShadowNode

describe('trackIn', () => {
	it('keys a node in and takes it out on release', () => {
		const nodes = new Map<number, ShadowNode>()
		const node = nodeWith(1)
		const release = trackIn(nodes)(3, node)
		expect(nodes.get(3)).toBe(node)
		release()
		expect(nodes.has(3)).toBe(false)
	})

	it('leaves the key to a newer node on an older node’s release', () => {
		const nodes = new Map<number, ShadowNode>()
		const track = trackIn(nodes)
		const releaseOld = track(3, nodeWith(1))
		const newer = nodeWith(2)
		track(3, newer)
		releaseOld()
		expect(nodes.get(3)).toBe(newer)
	})
})

describe('boxOf', () => {
	it('is null for no node, a node not painted yet, and with no window', () => {
		native = null
		expect(boxOf(null)).toBeNull()
		expect(boxOf(undefined)).toBeNull()
		expect(boxOf(nodeWith(null))).toBeNull()
		expect(boxOf(nodeWith(1))).toBeNull()
	})

	it('is the painted box native reports for the node, null where it reports none', () => {
		native = { getElementBounds: (id) => (id === 1 ? box : null) }
		expect(boxOf(nodeWith(1))).toBe(box)
		expect(boxOf(nodeWith(2))).toBeNull()
	})
})
