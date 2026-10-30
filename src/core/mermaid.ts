import { render } from 'pele'

export type Palette = Record<string, string>

export type MermaidResult =
	| { kind: 'diagram'; svg: string; width: number; height: number }
	| { kind: 'error'; message: string }

const VARIABLE_DECLARATION = /--([a-z0-9_-]+):(var\([^;"]*\)|[^;"]*)/g
const VARIABLE_REFERENCE = /var\(--([a-z0-9_-]+)(?:,([^()]*))?\)/g

/**
 * pele colours its SVG with `--_bg:var(--pele-bg,#fff)` on the root and `fill="var(--_bg)"` on shapes;
 * GPUI's SVG decoder drops every `var()` paint (shapes paint black), so each reference
 * is replaced from `palette` (keys without the leading `--`) or the fallback pele wrote
 */
function inlineVariables(svg: string, palette: Palette): string {
	const resolved: Palette = { ...palette }

	const resolve = (text: string): string => {
		let result = text
		let previous = ''
		// nested references resolve one level per pass
		while (result !== previous && result.includes('var(')) {
			previous = result
			result = result.replace(
				VARIABLE_REFERENCE,
				(_match, name: string, fallback: string | undefined) =>
					resolved[name] ?? fallback?.trim() ?? ''
			)
		}
		return result
	}

	// only where styles are written: a label may spell `var(--x)` or `--x:y` as its text
	const styles: string[] = []
	inStyles(svg, (css) => {
		styles.push(css)
		return css
	})
	for (const [, name, value] of styles.join(';').matchAll(VARIABLE_DECLARATION)) {
		if (name && value && !(name in palette)) resolved[name] = resolve(value)
	}

	return inStyles(svg, resolve)
}

/** `svg` with `transform` applied to the content of every `<style>` element */
const inStyleElements = (svg: string, transform: (css: string) => string): string =>
	svg.replace(
		/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/g,
		(_all, open: string, css: string, close: string) => open + transform(css) + close
	)

/** `svg` with `transform` applied to every attribute value and `<style>` content, never to text between tags */
function inStyles(svg: string, transform: (css: string) => string): string {
	return inStyleElements(svg, transform).replace(/(<[a-zA-Z][^<>]*>)/g, (tag: string) =>
		tag.startsWith('<style')
			? tag
			: tag.replace(
					/(=")([^"]*)(")/g,
					(_all, open: string, value: string, close: string) => open + transform(value) + close
				)
	)
}

/**
 * labels in one concrete family: pele's root style says `font:16px sans-serif` before its
 * `font-family`, and with the generic family unresolved GPUI's decoder falls back to serif;
 * so the shorthand keeps only its size and the family goes on the root element as an attribute
 */
function withFont(svg: string, family: string): string {
	// only where styles are written, never in a label's text
	const styled = (css: string) =>
		css
			.replace(/font:\s*(\d+(?:\.\d+)?px)\s+[^;"]+/g, 'font-size:$1')
			.replaceAll('sans-serif', family)
	return inStyleElements(svg, styled)
		.replace(
			/(\s(?:style|font-family)=")([^"]*)(")/g,
			(_all, open: string, css: string, close: string) => open + styled(css) + close
		)
		.replace(/<svg\b/, `<svg font-family="${family}"`)
}

/** a Mermaid diagram as an SVG GPUI paints in full colour, or the reason it could not be drawn */
export function renderMermaid(source: string, palette: Palette): MermaidResult {
	try {
		const family = palette['pele-font'] ?? 'Helvetica'
		const result = render(source, { responsive: false, fontFamily: family })
		return {
			kind: 'diagram',
			svg: withFont(inlineVariables(result.svg, palette), family),
			width: result.width,
			height: result.height
		}
	} catch (error) {
		return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
	}
}
