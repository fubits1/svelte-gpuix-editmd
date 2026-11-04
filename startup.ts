// what both entries do before they open the window: the command line's headless modes and agent hook, a file another
// window already has, and the Document the window then shows
import { readFileSync } from 'node:fs'
import { agentProcessesOptions } from './src/app/agentProcessesEnv.ts'
import { dryRunOptions } from './src/app/dryRun.ts'
import { HEADLESS_IO, runHeadless } from './src/app/headless.ts'
import { parseLaunch } from './src/app/launch.ts'
import { reportEdit, SOCKETS_DIRECTORY } from './src/app/reportEdit.ts'
import { UNTITLED_FOLDER } from './src/app/supportFolder.ts'
import { focusWindowFor } from './src/host/agentIpc.ts'
import { realPathOf } from './src/host/files.ts'
import { exitOnSignals } from './src/host/signals.ts'
import { UntitledNumbers } from './src/host/untitledNumbers.ts'
import { documentController, NEW_WINDOW_ENV } from './src/ui/DocumentView/controller.svelte.ts'

/** runs the command line: a mode that needs no window ends the process; otherwise the window's Document is loaded */
export async function startDocument(): Promise<void> {
	const launch = parseLaunch(process.argv.slice(2), process.cwd())

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
	const options = {
		...dryRunOptions(process.env),
		...agentProcessesOptions(process.env),
		// an untitled window is numbered among every editor process's, as NSDocument's Untitled 2
		untitledNumbers: new UntitledNumbers(UNTITLED_FOLDER)
	}
	// a launch file that cannot be read shows the open-failure alert, whose OK closes the window, as editmd opens none
	if (launch.kind === 'open') documentController.openAtLaunch(launch.path, options)
	// File > New's window says so, so Open… opens beside it rather than into it, as AppKit does
	else
		documentController.load('', { ...options, startedByNew: process.env[NEW_WINDOW_ENV] === '1' })
}
