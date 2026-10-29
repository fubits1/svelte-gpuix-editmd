import { execFile, execFileSync } from 'node:child_process'

export type Appearance = 'dark' | 'light'

/** `defaults read -g AppleInterfaceStyle` prints "Dark" in dark mode; in light mode the key is missing */
export function appearanceFrom(output: string): Appearance {
	return output.trim() === 'Dark' ? 'dark' : 'light'
}

/** macOS's current light or dark mode; gpuix has no appearance API, so this asks `defaults` */
export function systemAppearance(): Appearance {
	try {
		return appearanceFrom(
			execFileSync('defaults', ['read', '-g', 'AppleInterfaceStyle'], {
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore']
			})
		)
	} catch {
		return 'light'
	}
}

/**
 * `systemAppearance` without blocking: the sync spawn took 4.11ms median, 6.19ms max (20 runs),
 * over half a 120Hz frame, and the theme polls it every 2s
 */
export function readSystemAppearance(): Promise<Appearance> {
	return new Promise((resolve) => {
		// light mode exits with an error (the key is missing), which still means light
		execFile('defaults', ['read', '-g', 'AppleInterfaceStyle'], (error, stdout) =>
			resolve(appearanceFrom(error ? '' : stdout))
		)
	})
}
