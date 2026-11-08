import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { ModelStore } from "@core/voice/transcription/models/ModelStore"
import { PINNED_MODELS } from "@core/voice/transcription/models/modelCatalog"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

/**
 * F3 — download progress and cancellation against the real `ModelStore`.
 *
 * `ModelStore` streams to `<file>.part`, verifies size + SHA-256, and only then
 * renames into place. These tests drive that real implementation with a
 * scripted `fetch` so the F3 progress/cancel contract is proven without a
 * network: progress is reported as byte counters, and an abort removes the
 * partial file and never publishes a model.
 */

let root: string
let dir: string

beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "bytos-f3-download-"))
	dir = path.join(root, "models")
	fs.mkdirSync(dir, { recursive: true })
})

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true })
})

afterEach(() => {
	fs.rmSync(dir, { recursive: true, force: true })
	fs.mkdirSync(dir, { recursive: true })
})

/** A fetch that yields `chunks` of the pinned size, then completes. */
function makeFetch(sizeBytes: number, options: { chunkBytes?: number } = {}): typeof fetch {
	const chunkBytes = options.chunkBytes ?? 8 * 1024 * 1024
	return (async () => {
		let sent = 0
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (sent >= sizeBytes) {
					controller.close()
					return
				}
				const size = Math.min(chunkBytes, sizeBytes - sent)
				sent += size
				controller.enqueue(new Uint8Array(size))
			},
		})
		return new Response(stream, { status: 200 })
	}) as unknown as typeof fetch
}

/** A fetch that yields one chunk and then hangs, so only an abort can end it. */
const hangingFetch = (async (_url: string | URL | Request, _init?: RequestInit) => {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(4096))
		},
		pull() {
			// Never resolves: the transfer stalls until the abort signal fires,
			// which cancels the reader from inside `ModelStore`'s loop.
			return new Promise<void>(() => {})
		},
	})
	return new Response(stream, { status: 200 })
}) as unknown as typeof fetch

describe("ModelStore — F3 progress and cancellation", () => {
	it("reports monotonic byte progress and rejects bytes that fail the hash", async () => {
		const pin = PINNED_MODELS.tiny
		const store = new ModelStore({ modelDir: dir, fetchImpl: makeFetch(pin.sizeBytes) })
		const seen: number[] = []
		const error = await store
			.download("tiny", {
				consent: true,
				onProgress: ({ receivedBytes }) => seen.push(receivedBytes),
			})
			.catch((caught: { code?: string }) => caught)

		// Zero bytes are not the pinned model, so verification must fail...
		expect(seen.length).toBeGreaterThan(1)
		expect(seen).toEqual([...seen].sort((a, b) => a - b))
		expect(seen.at(-1)).toBe(pin.sizeBytes)
		// ...and nothing may be published under the real file name.
		expect((error as { code?: string }).code).toBe("MODEL_INTEGRITY_FAILED")
		expect(fs.existsSync(path.join(dir, pin.fileName))).toBe(false)
		expect(fs.existsSync(path.join(dir, `${pin.fileName}.part`))).toBe(false)
	})

	it("removes the partial file when the download is aborted", async () => {
		const pin = PINNED_MODELS.base
		const store = new ModelStore({ modelDir: dir, fetchImpl: hangingFetch })
		const pending = store.download("base", { consent: true }).catch((caught: { code?: string }) => caught)
		// Let the transfer actually start (and write its first chunk) first.
		await new Promise((resolve) => setTimeout(resolve, 50))
		store.abort("base")
		const error = await pending
		expect((error as { code?: string }).code).toBe("MODEL_DOWNLOAD_ABORTED")
		expect(fs.existsSync(path.join(dir, pin.fileName))).toBe(false)
		expect(fs.existsSync(path.join(dir, `${pin.fileName}.part`))).toBe(false)
	})

	it("refuses to start at all without consent", async () => {
		const store = new ModelStore({ modelDir: dir, fetchImpl: makeFetch(16) })
		await expect(store.download("tiny", { consent: false })).rejects.toMatchObject({
			code: "MODEL_CONSENT_REQUIRED",
		})
		expect(fs.readdirSync(dir)).toEqual([])
	})
})
