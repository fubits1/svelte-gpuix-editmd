// dev entry: `pnpm start <file.md>`; render_hot remounts App.svelte on save
import { render_hot } from 'gpuix-svelte'
import { WINDOW, windowSizeFor } from './src/app/window.ts'
import { readVisibleScreen } from './src/host/screen.ts'
import { documentController } from './src/ui/DocumentView/controller.svelte.ts'
import { startDocument } from './startup.ts'

await startDocument()

// editmd caps its window to the screen; gpuix cannot read the screen, so AppKit is asked first
render_hot(new URL('./App.svelte', import.meta.url), {
	...WINDOW,
	...windowSizeFor(readVisibleScreen()),
	title: documentController.windowTitle
})
