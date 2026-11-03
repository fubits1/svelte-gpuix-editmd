import { readJxa, type Run } from './jxa.ts'

/** `keyboardFocusIndicatorColor` as `#rrggbbaa` from the eight hex digits the script prints, null for anything else */
export function focusRingFrom(output: string): string | null {
	const digits = output.trim()
	return /^[\da-f]{8}$/i.test(digits) ? `#${digits.toLowerCase()}` : null
}

/** AppKit's focus ring colour in the current appearance, in sRGB */
const SCRIPT = [
	"ObjC.import('AppKit')",
	'const ring = $.NSColor.keyboardFocusIndicatorColor.colorUsingColorSpace($.NSColorSpace.sRGBColorSpace)',
	"[ring.redComponent, ring.greenComponent, ring.blueComponent, ring.alphaComponent].map((part) => Math.round(part * 255).toString(16).padStart(2, '0')).join('')"
].join('; ')

/**
 * the ring AppKit draws round a focused control, as editmd's alert buttons and find field show it: it follows the
 * Mac's accent colour, so it is asked of AppKit, in the appearance the system is in now; null when that fails
 */
export async function readFocusRing(runner?: Run): Promise<string | null> {
	return focusRingFrom(await readJxa(SCRIPT, runner))
}
