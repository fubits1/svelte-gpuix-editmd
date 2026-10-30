import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { fetchImageHead } from './imageFetch.ts'

/** a loopback server: `/endless` streams forever, `/silent` never answers, `/small` sends 10 bytes */
let server: Server
let base = ''
beforeAll(async () => {
	server = createServer((request, response) => {
		if (request.url === '/small') return void response.end(Buffer.alloc(10, 1))
		if (request.url === '/silent') return
		response.writeHead(200)
		const chunk = Buffer.alloc(64 * 1024, 2)
		const pump = () => {
			while (response.write(chunk)) {
				// fills the socket until it pushes back
			}
			response.once('drain', pump)
		}
		pump()
	})
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
	server.closeAllConnections()
	server.close()
})

// a size read must not fetch the whole body with no limit, nor wait forever on a server that never answers
describe('fetchImageHead', () => {
	test('reads at most the bytes a size needs, and gives up on a server that never answers', async () => {
		const started = Date.now()
		const [small, endless, silent] = await Promise.all([
			fetchImageHead(`${base}/small`),
			fetchImageHead(`${base}/endless`, { maxBytes: 100_000 }),
			fetchImageHead(`${base}/silent`, { timeoutMs: 500 }).catch(() => 'gave up')
		])

		expect([
			small.length,
			endless.length <= 100_000 + 64 * 1024,
			silent,
			Date.now() - started < 3000
		]).toEqual([10, true, 'gave up', true])
	})
})
