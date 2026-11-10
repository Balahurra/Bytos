import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { VoiceError } from "../../types"
import { assertHttpsUrl, ModelStore } from "../models/ModelStore"

/**
 * Download + verification behaviour.
 *
 * `fetch` is injected rather than mocked inside the store, so the production path
 * (streaming body → `.part` file → size check → SHA-256 → atomic rename) is what
 * actually runs. The "server" is a `Response` built from real bytes.
 */
const ASSETS = path.resolve(process.cwd(), "test-assets", "voice-f2")
const REAL_MODEL = path.join(ASSETS, "models", "ggml-tiny.bin")
const realModelPresent = fs.existsSync(REAL_MODEL)

let dir: string

beforeAll(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "bytos-f2-models-"))
})

afterAll(() => {
	fs.rmSync(dir, { recursive: true, force: true })
})

/** Builds a fetch that serves `bytes`, optionally in small chunks. */
function fetchServing(bytes: Buffer, options: { chunkSize?: number; status?: number } = {}): typeof fetch {
	const chunkSize = options.chunkSize ?? bytes.length
	return (async () => {
		const status = options.status ?? 200
		if (status !== 200) return new Response("nope", { status })
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				for (let offset = 0; offset < bytes.length; offset += chunkSize) {
					controller.enqueue(new Uint8Array(bytes.subarray(offset, offset + chunkSize)))
				}
				controller.close()
			},
		})
		return new Response(stream, { status: 200 })
	}) as unknown as typeof fetch
}

describe("download consent", () => {
	it("refuses without explicit consent", async () => {
		const store = new ModelStore({ modelDir: path.join(dir, "noconsent"), fetchImpl: fetchServing(Buffer.alloc(0)) })
		await expect(store.download("tiny", { consent: false })).rejects.toThrowError(
			expect.objectContaining({ code: "MODEL_CONSENT_REQUIRED" }),
		)
	})

	it("discloses size before any download", () => {
		const store = new ModelStore({ modelDir: dir })
		const disclosure = store.describeDownload("tiny")
		expect(disclosure.bytes).toBe(77691713)
		expect(disclosure.humanSize).toBe("74.1 MiB")
		expect(disclosure.url.startsWith("https://")).toBe(true)
	})
})

describe("HTTPS enforcement", () => {
	it.each([
		"http://example.com/model.bin",
		"ftp://example.com/model.bin",
		"file:///etc/passwd",
		"not a url",
		"",
	])("rejects %s", (url) => {
		expect(() => assertHttpsUrl(url)).toThrow(VoiceError)
	})

	it("accepts https", () => {
		expect(() => assertHttpsUrl("https://huggingface.co/x/ggml-tiny.bin")).not.toThrow()
	})

	it("rejects a plain-http URL at download time", async () => {
		const store = new ModelStore({ modelDir: path.join(dir, "http"), fetchImpl: fetchServing(Buffer.alloc(0)) })
		await expect(store.download("tiny", { consent: true, url: "http://example.com/ggml-tiny.bin" })).rejects.toThrowError(
			expect.objectContaining({ code: "MODEL_DOWNLOAD_FAILED" }),
		)
	})
})

describe("download verification failures", () => {
	it("rejects a truncated download and leaves no .part file", async () => {
		const target = path.join(dir, "truncated")
		const store = new ModelStore({ modelDir: target, fetchImpl: fetchServing(Buffer.alloc(1024, 1)) })
		await expect(store.download("tiny", { consent: true })).rejects.toThrowError(
			expect.objectContaining({ code: "MODEL_SIZE_MISMATCH" }),
		)
		expect(fs.existsSync(path.join(target, "ggml-tiny.bin"))).toBe(false)
		expect(fs.existsSync(path.join(target, "ggml-tiny.bin.part"))).toBe(false)
	})

	it("rejects an oversized response and leaves no .part file", async () => {
		const target = path.join(dir, "oversized")
		const store = new ModelStore({
			modelDir: target,
			fetchImpl: fetchServing(Buffer.alloc(77691713 + 4096, 2)),
		})
		await expect(store.download("tiny", { consent: true })).rejects.toThrowError(
			expect.objectContaining({ code: "MODEL_SIZE_MISMATCH" }),
		)
		expect(fs.existsSync(path.join(target, "ggml-tiny.bin"))).toBe(false)
		expect(fs.existsSync(path.join(target, "ggml-tiny.bin.part"))).toBe(false)
	})

	it("rejects correct-size but wrong-content bytes on the hash check", async () => {
		// Exactly the pinned length, wrong bytes: only SHA-256 can catch this, and
		// nothing may be published as the model.
		const target = path.join(dir, "wronghash")
		const bytes = Buffer.alloc(77691713, 9)
		const store = new ModelStore({ modelDir: target, fetchImpl: fetchServing(bytes) })
		await expect(store.download("tiny", { consent: true })).rejects.toThrowError(
			expect.objectContaining({ code: "MODEL_INTEGRITY_FAILED" }),
		)
		expect(fs.existsSync(path.join(target, "ggml-tiny.bin"))).toBe(false)
		expect(fs.existsSync(path.join(target, "ggml-tiny.bin.part"))).toBe(false)
	})

	it("reports a non-200 response", async () => {
		const store = new ModelStore({
			modelDir: path.join(dir, "status"),
			fetchImpl: fetchServing(Buffer.alloc(0), { status: 503 }),
		})
		await expect(store.download("tiny", { consent: true })).rejects.toThrowError(
			expect.objectContaining({ code: "MODEL_DOWNLOAD_FAILED" }),
		)
	})
})

describe("download cancellation", () => {
	it("aborts mid-stream and removes the partial file", async () => {
		const target = path.join(dir, "aborted")
		const controller = new AbortController()
		let chunks = 0
		const fetchImpl = (async () => {
			const stream = new ReadableStream<Uint8Array>({
				pull(c) {
					chunks += 1
					if (chunks === 3) controller.abort()
					c.enqueue(new Uint8Array(65536))
					if (chunks > 4) c.close()
				},
			})
			return new Response(stream, { status: 200 })
		}) as unknown as typeof fetch

		const store = new ModelStore({ modelDir: target, fetchImpl })
		await expect(store.download("tiny", { consent: true, signal: controller.signal })).rejects.toThrowError(
			expect.objectContaining({ code: "MODEL_DOWNLOAD_ABORTED" }),
		)
		expect(fs.existsSync(path.join(target, "ggml-tiny.bin.part"))).toBe(false)
		expect(fs.existsSync(path.join(target, "ggml-tiny.bin"))).toBe(false)
	})
})

describe("installed model state", () => {
	it("reports not-installed when nothing is on disk", async () => {
		const store = new ModelStore({ modelDir: path.join(dir, "empty") })
		expect(store.isInstalled("tiny")).toBe(false)
		await expect(store.requireVerifiedModel("tiny")).rejects.toThrowError(
			expect.objectContaining({ code: "MODEL_NOT_INSTALLED" }),
		)
	})

	it("rejects an unknown model id", async () => {
		const store = new ModelStore({ modelDir: dir })
		await expect(store.requireVerifiedModel("medium")).rejects.toThrowError(
			expect.objectContaining({ code: "MODEL_UNKNOWN" }),
		)
	})

	it.skipIf(!realModelPresent)("accepts the real model file after a hash check", async () => {
		const store = new ModelStore({ modelDir: path.dirname(REAL_MODEL) })
		expect(store.isInstalled("tiny")).toBe(true)
		expect(await store.isVerified("tiny")).toBe(true)
		const resolved = await store.requireVerifiedModel("tiny")
		expect(resolved.pin.id).toBe("tiny")
	})

	it.skipIf(!realModelPresent)("rejects a corrupted copy of the real model", async () => {
		const copyDir = path.join(dir, "corrupt")
		fs.mkdirSync(copyDir, { recursive: true })
		const copy = path.join(copyDir, "ggml-tiny.bin")
		const bytes = fs.readFileSync(REAL_MODEL)
		// Flip one byte in the middle: same size, different hash.
		bytes[Math.floor(bytes.length / 2)] ^= 0xff
		fs.writeFileSync(copy, bytes)

		const store = new ModelStore({ modelDir: copyDir })
		await expect(store.requireVerifiedModel("tiny")).rejects.toThrowError(
			expect.objectContaining({ code: "MODEL_INTEGRITY_FAILED" }),
		)
	})

	it("lists both pinned models with their install state", async () => {
		const store = new ModelStore({ modelDir: path.join(dir, "list") })
		const listing = await store.listModels()
		expect(listing.map((entry) => entry.pin.id)).toEqual(["tiny", "base"])
		expect(listing.every((entry) => entry.installed === false)).toBe(true)
	})
})
