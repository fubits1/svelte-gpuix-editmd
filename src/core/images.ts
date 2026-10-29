export type Image = { src: string; alt: string }

/** `images` as markdown, inserted after the block they were dropped on. */
export function imagesMarkdown(images: Image[]): string {
	const escape = (text: string) => text.replace(/[\\[\]]/g, '\\$&')
	return images.map(({ src, alt }) => `![${escape(alt)}](${src})`).join(' ')
}
