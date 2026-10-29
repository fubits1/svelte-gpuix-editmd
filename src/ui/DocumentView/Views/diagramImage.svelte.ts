import type { Diagram } from '../../../app/diagrams.ts'

/**
 * the `src` a drawn diagram paints with: its SVG as a base64 data: URL, since GPUI's <img> takes no SVG markup.
 * pele writes its label size only inside the root's `style` (`font-size:16px` once core/mermaid.ts has taken the
 * family out of the shorthand), which GPUI's SVG decoder does not read, so the labels painted at its 12px default
 * (measured in this app's screenshot: "probe" 30px wide, 22px tall at 2x, against 30px tall once sized); the root
 * carries the size as an attribute too
 */
export function diagramImageSrc(diagram: Extract<Diagram, { kind: 'diagram' }>): string {
	const size = /font-size:\s*([\d.]+)px/.exec(diagram.svg)?.[1]
	const sized =
		size === undefined || /<svg\b[^>]*\sfont-size=/.test(diagram.svg)
			? diagram.svg
			: diagram.svg.replace(/<svg\b/, `<svg font-size="${size}"`)
	return `data:image/svg+xml;base64,${Buffer.from(sized).toString('base64')}`
}
