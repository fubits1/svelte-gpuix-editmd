// editmd's View > Zoom In / Zoom Out: pageZoom ×1.1 per step, clamped to 0.5-3

const STEP = 1.1
const MINIMUM = 0.5
const MAXIMUM = 3

const clamp = (zoom: number) => Math.min(MAXIMUM, Math.max(MINIMUM, zoom))

export function zoomIn(zoom: number): number {
	return clamp(zoom * STEP)
}

export function zoomOut(zoom: number): number {
	return clamp(zoom / STEP)
}
