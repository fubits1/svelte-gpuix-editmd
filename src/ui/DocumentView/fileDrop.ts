import type { GpuixEvent } from 'gpuix-svelte'
import { documentController } from './controller.svelte.ts'

/**
 * a Finder drop on the page, or on an element inside a Block that takes clicks: its absolute paths and where it
 * landed, in window coordinates, placed among the Blocks where the view last measured them. GPUI hands a drop on an
 * element with a click and no file drop of its own to that click (measured headless), which would open the Block
 */
export function dropFiles(event: GpuixEvent): void {
	if (!event.paths || event.y === undefined) return
	documentController.dropFiles(event.paths, event.y)
}
