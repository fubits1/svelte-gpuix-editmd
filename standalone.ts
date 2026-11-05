// the entry `pnpm run build` compiles: a binary carries no source to hot-reload, so it imports App statically

// imported first: satteri's loader must find the .app's addon before anything imports satteri
import './src/host/satteriAddon.ts'
import { render } from 'gpuix-svelte'
import App from './App.svelte'
import { WINDOW, windowSizeFor } from './src/app/window.ts'
import { readVisibleScreen } from './src/host/screen.ts'
import { documentController } from './src/ui/DocumentView/controller.svelte.ts'
import { startDocument } from './startup.ts'

await startDocument()

// capped to the screen as editmd's window is: `windowSizeFor` in src/app/window.ts, `readVisibleScreen` asks AppKit
const size = windowSizeFor(readVisibleScreen())
// gpuix-svelte/build reads `app` from this source, so the options are written out here, not spread
render(App, {
	appName: WINDOW.appName,
	width: size.width,
	height: size.height,
	minWidth: WINDOW.minWidth,
	minHeight: WINDOW.minHeight,
	title: documentController.windowTitle,
	// what `pnpm build` packages the app as; the icon is drawn by build.ts before it builds
	app: {
		name: 'editmd-gpuix',
		identifier: 'dev.gpuix.editmd',
		copyright: 'A small markdown editor, ported from editmd.',
		icon: './dist/AppIcon-1024.png'
	}
})
