// dev entry: `pnpm start <file.md>`; render_hot remounts App.svelte on save
import { render_hot } from 'gpuix-svelte'
import { WINDOW, windowSizeFor } from './src/app/window.ts'
import { readVisibleScreen } from './src/host/screen.ts'
import { documentController } from './src/ui/DocumentView/controller.svelte.ts'
import { startDocument } from './startup.ts'

await startDocument()

// capped to the screen as editmd's window is: `windowSizeFor` in src/app/window.ts, `readVisibleScreen` asks AppKit
render_hot(new URL('./App.svelte', import.meta.url), {
	...WINDOW,
	...windowSizeFor(readVisibleScreen()),
	title: documentController.windowTitle
})
