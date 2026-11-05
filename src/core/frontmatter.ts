/** a leading YAML (`---`) or TOML (`+++`) block, which may be empty */
const FRONTMATTER =
	/^(?:---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)|\+\+\+[ \t]*\r?\n(?:[\s\S]*?\r?\n)?\+\+\+)[ \t]*(?:\r?\n|$)/

/** split a leading YAML or TOML front matter block off the markdown body */
export function splitFrontmatter(text: string): { frontmatter: string; body: string } {
	const match = FRONTMATTER.exec(text)
	if (!match) return { frontmatter: '', body: text }
	return { frontmatter: match[0], body: text.slice(match[0].length) }
}
