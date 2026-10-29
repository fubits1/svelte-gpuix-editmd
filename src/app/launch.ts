import { basename, resolve } from 'node:path'

export type Launch =
	| { kind: 'open'; path: string; title: string }
	| { kind: 'untitled'; title: string }
	| { kind: 'report-edit' }
	| { kind: 'roundtrip' | 'normalize' | 'selftest'; path: string }
	| { kind: 'snapshot'; path: string; out: string; dark: boolean; width: number }

const ONE_FILE_MODES = ['roundtrip', 'normalize', 'selftest'] as const

/** editmd's headless modes (`Headless.swift:20-40`): each takes exactly its arguments, else null */
function headlessLaunch(argv: readonly string[], cwd: string): Launch | null {
	const [flag, file, out] = argv
	const mode = ONE_FILE_MODES.find((name) => flag === `--${name}`)
	if (mode && argv.length === 2) return { kind: mode, path: resolve(cwd, file!) }
	if (flag !== '--snapshot' || argv.length < 3) return null
	const rest = argv.slice(3)
	const widthAt = rest.indexOf('--width')
	const width = widthAt >= 0 ? Number(rest[widthAt + 1]) : Number.NaN
	return {
		kind: 'snapshot',
		path: resolve(cwd, file!),
		out: resolve(cwd, out!),
		dark: rest.includes('--dark'),
		width: Number.isFinite(width) ? width : 860
	}
}

/**
 * what a process start asks for: `--report-edit` as the first argument is the agent hook (editmd main.swift:4),
 * then a headless mode, else a path opens that file
 */
export function parseLaunch(argv: readonly string[], cwd: string): Launch {
	if (argv[0] === '--report-edit') return { kind: 'report-edit' }
	const headless = headlessLaunch(argv, cwd)
	if (headless) return headless
	const file = argv.find((argument) => !argument.startsWith('--'))
	if (!file) return { kind: 'untitled', title: 'Untitled' }
	return { kind: 'open', path: resolve(cwd, file), title: basename(file) }
}
