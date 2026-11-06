// the app headless behind gpuix's automation protocol on stdio: the e2e suites' entry unless EDITMD_E2E_ENTRY names one
import { InProcessBackend, serveAutomationStdio } from '@gpuix/native/automation'
import { headless_renderer } from 'gpuix-svelte/automation'
import { mount_headless } from 'gpuix-svelte/test'
import App from '../App.svelte'
import { startDocument } from '../startup.ts'

// stdout carries the protocol, so the app's own logging goes to stderr, as render() does under GPUIX_AUTOMATION
console.log = console.info = console.debug = console.error

await startDocument()
mount_headless(App, { width: 800, height: 538 })
serveAutomationStdio(new InProcessBackend(headless_renderer()))
process.stdin.once('end', () => process.exit(0))
