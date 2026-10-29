// dev entry: `pnpm start <file.md>`; render_hot remounts App.svelte on save
import { readFileSync, realpathSync } from 'node:fs'
import { render_hot } from 'gpuix-svelte'
import { agentProcessesOptions } from './src/app/agentProcessesEnv.ts'
import { dryRunOptions } from './src/app/dryRun.ts'
import { HEADLESS_IO, runHeadless } from './src/app/headless.ts'
import { parseLaunch } from './src/app/launch.ts'
import { reportEdit, SOCKETS_DIRECTORY } from './src/app/reportEdit.ts'
import { WINDOW, windowSizeFor } from './src/app/window.ts'
import { focusWindowFor } from './src/host/agentIpc.ts'
import { readVisibleScreen } from './src/host/screen.ts'
import { exitOnSignals } from './src/host/signals.ts'
import { documentController, NEW_WINDOW_ENV } from './src/ui/DocumentView/controller.svelte.ts'

const launch = parseLaunch(process.argv.slice(2), process.cwd())

/** `path` with its symlinks followed, or as given when it cannot be resolved */
function realPathOf(path: string): string {
	try {
		return realpathSync(path)
	} catch {
		return path
	}
}

if (launch.kind === 'report-edit') {
	// the hook never gets in an agent's way: silent, exit 0, whatever happened (AgentEdits.swift:77-96)
	await reportEdit(readFileSync(0, 'utf8'), process.env).catch(() => null)
	process.exit(0)
}

const exitCode = await runHeadless(launch, HEADLESS_IO)
if (exitCode !== null) process.exit(exitCode)
if (launch.kind !== 'open' && launch.kind !== 'untitled')
	throw new Error(`no window for ${launch.kind}`)

/**
 * a file another window already has comes forward there and this process starts no window, as editmd brings a
 * document's window forward instead of opening it twice
 */
if (launch.kind === 'open' && (await focusWindowFor(SOCKETS_DIRECTORY, realPathOf(launch.path))))
	process.exit(0)

// `kill`, Ctrl-C or a closing terminal end the window through `exit`, so a file's edits are saved
exitOnSignals()
const options = { ...dryRunOptions(process.env), ...agentProcessesOptions(process.env) }
let title = launch.title
if (launch.kind === 'open') {
	// a launch file that cannot be read leaves an untitled window with the open-failure alert
	if (!documentController.openAtLaunch(launch.path, options)) title = 'Untitled'
	// File > New's window says so, so Open… opens beside it rather than into it, as AppKit does
} else
	documentController.load('', { ...options, startedByNew: process.env[NEW_WINDOW_ENV] === '1' })

// editmd caps its window to the screen; gpuix cannot read the screen, so AppKit is asked first
render_hot(new URL('./App.svelte', import.meta.url), {
	...WINDOW,
	...windowSizeFor(readVisibleScreen()),
	title
})
