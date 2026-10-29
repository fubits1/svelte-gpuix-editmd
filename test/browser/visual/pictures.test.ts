import { expect, test } from 'vitest'
import { commands, page } from 'vitest/browser'

declare module 'vitest/browser' {
	interface BrowserCommands {
		pictures: () => Promise<{ name: string; url: string }[]>
	}
}

/**
 * the open field's blinking caret on the empty document's window picture: 2×26pt at the column's left edge, which a
 * capture catches lit or dark at random. A box around it is painted over in both pictures before they are compared.
 */
const CARET_MASKS: Record<string, { left: number; top: number; width: number; height: number }> = {
	'window-r-empty-doc': { left: 196, top: 136, width: 20, height: 68 }
}

const pictures = await commands.pictures()

test.each(pictures.map((picture) => [picture.name, picture.url]))(
	'%s looks as before the migration',
	async (name, url) => {
		document.body.style.margin = '0'
		document.body.replaceChildren()
		const image = document.createElement('img')
		image.src = url
		image.style.display = 'block'
		document.body.append(image)
		await image.decode()
		// Chromium leaves rows below the viewport unpainted in an element shot, so the viewport fits the whole picture.
		await page.viewport(image.naturalWidth, image.naturalHeight)
		// shown at its own size, so the comparison sees the captured pixels unscaled
		expect([image.getBoundingClientRect().width, image.getBoundingClientRect().height]).toEqual([
			image.naturalWidth,
			image.naturalHeight
		])

		const masks = []
		const caret = CARET_MASKS[name]
		if (caret) {
			const box = document.createElement('div')
			Object.assign(box.style, {
				position: 'absolute',
				left: `${caret.left}px`,
				top: `${caret.top}px`,
				width: `${caret.width}px`,
				height: `${caret.height}px`
			})
			document.body.append(box)
			masks.push(page.elementLocator(box))
		}
		await expect.element(page.elementLocator(image)).toMatchScreenshot(name, {
			screenshotOptions: { mask: masks }
		})
	}
)
