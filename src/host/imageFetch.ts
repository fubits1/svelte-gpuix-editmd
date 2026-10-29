/** how long a remote image is given to answer, and how much of it is read: a size sits in its first bytes */
export type FetchLimits = { timeoutMs?: number; maxBytes?: number }

const TIMEOUT_MS = 10_000
const MAX_BYTES = 1024 * 1024

/**
 * the first bytes of a remote image, enough to read its size, through the platform's `fetch`: the read stops at
 * `maxBytes` and the request is given up after `timeoutMs`, so a huge or a stalled image never holds the window. a
 * failed answer, or one that does not come in time, rejects
 */
export async function fetchImageHead(
	url: string,
	{ timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES }: FetchLimits = {}
): Promise<Uint8Array> {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)
	try {
		const response = await fetch(url, { signal: controller.signal })
		if (!response.ok) throw new Error(`${response.status} for ${url}`)
		const chunks: Uint8Array[] = []
		let length = 0
		const reader = response.body?.getReader()
		while (reader && length < maxBytes) {
			const { done, value } = await reader.read()
			if (done) break
			chunks.push(value)
			length += value.length
		}
		await reader?.cancel()
		const bytes = new Uint8Array(length)
		let at = 0
		for (const chunk of chunks) {
			bytes.set(chunk, at)
			at += chunk.length
		}
		return bytes
	} finally {
		clearTimeout(timer)
		controller.abort()
	}
}
