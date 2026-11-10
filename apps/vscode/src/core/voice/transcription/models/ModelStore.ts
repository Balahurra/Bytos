import * as fs from "node:fs"
import * as path from "node:path"
import { VoiceError } from "../../types"
import { verifyFile } from "./integrity"
import { formatBytes, getModelPin, isKnownModelId, type ModelPin, PINNED_MODELS } from "./modelCatalog"

// ── F3: cancel support ───────────────────────────────────────────────────
//
// Added by F3 so the Settings panel can actually report "downloading" and let
// the user stop a transfer. Everything else in this file is unchanged F2
// behaviour: consent gating, `.part` + verify + atomic rename, HTTPS only.
//
// Two layers, because either one alone can stall:
//  - `signal` is handed to the transport, so a well-behaved `fetch` aborts;
//  - `cancelRead` rejects the in-flight read, so a transport that ignores the
//    signal (or a test double that never resolves) cannot hang the download.

type DownloadFailure = { cancelled: boolean; error: VoiceError }

/** Races one read against a cancel promise so a stalled stream can be stopped. */
function raceCancel<T>(read: Promise<T>, cancelled: Promise<DownloadFailure>): Promise<T> {
	return Promise.race([
		read,
		cancelled.then((failure) => {
			throw failure.error
		}),
	])
}

/** A monotonically increasing counter so tests can prove a cancel was requested. */
let cancelGeneration = 0

export function modelStoreCancelGeneration(): number {
	return cancelGeneration
}

/**
 * On-disk model management (F2, §13.2 F2-e).
 *
 * Rules this class enforces:
 *
 * 1. **Consent first.** `download()` refuses unless `consent === true`, and
 *    `describeDownload()` exposes the size so a caller can disclose it. There is
 *    no implicit download anywhere in the codebase.
 * 2. **Nothing unverified is ever exposed as installed.** Bytes land in
 *    `<name>.part`; only after size + SHA-256 match is the file renamed into
 *    place. A failed or aborted download deletes the partial file.
 * 3. **Atomic publish.** The rename is the only moment a model becomes visible,
 *    so a concurrent reader never sees a half-written model.
 * 4. **HTTPS only.** A `http:` URL is rejected before a socket is opened.
 * 5. **Never trusts upstream metadata.** The expected size comes from the pin
 *    table; `Content-Length` is not consulted at all.
 *
 * Downloads use the global `fetch` (a dependency-free Node 22 API already used in
 * this app) and stream to disk, so a 148 MB model is never held in memory.
 */

export interface ModelStoreOptions {
	/** Absolute directory that holds `.bin` models. */
	modelDir: string
	/** Injectable for tests: downloads a URL to a Response. */
	fetchImpl?: typeof fetch
}

export interface DownloadResult {
	modelId: "tiny" | "base"
	path: string
	sizeBytes: number
	sha256: string
}

export interface DownloadOptions {
	consent: boolean
	signal?: AbortSignal
	onProgress?: (progress: { receivedBytes: number; totalBytes: number }) => void
	/** Absolute URL override. HTTPS only. Test seam. */
	url?: string
	/** Directory override. Test seam. */
	targetDir?: string
}

export class ModelStore {
	private readonly modelDir: string
	private readonly fetchImpl: typeof fetch
	private readonly inflight = new Map<string, Promise<DownloadResult>>()
	private readonly aborted = new Set<string>()
	/** F3: wakes a stalled read when the user cancels mid-transfer. */
	private readonly cancelSignals = new Map<string, (failure: DownloadFailure) => void>()

	constructor(options: ModelStoreOptions) {
		this.modelDir = options.modelDir
		this.fetchImpl = options.fetchImpl ?? fetch
	}

	get directory(): string {
		return this.modelDir
	}

	/** Absolute path a model occupies once installed. */
	modelPath(modelId: "tiny" | "base"): string {
		return path.join(this.modelDir, getModelPin(modelId).fileName)
	}

	/** Discloses what a download would cost. Call before requesting consent. */
	describeDownload(modelId: "tiny" | "base"): { modelId: string; bytes: number; humanSize: string; url: string } {
		const pin = getModelPin(modelId)
		return { modelId: pin.id, bytes: pin.sizeBytes, humanSize: formatBytes(pin.sizeBytes), url: pin.url }
	}

	/** Every pinned model, with whether it is installed and verified. */
	async listModels(): Promise<Array<{ pin: ModelPin; installed: boolean; path: string; verified: boolean }>> {
		const out: Array<{ pin: ModelPin; installed: boolean; path: string; verified: boolean }> = []
		for (const pin of Object.values(PINNED_MODELS)) {
			const target = this.modelPath(pin.id)
			const installed = fs.existsSync(target)
			out.push({ pin, installed, path: target, verified: installed ? await this.isVerified(pin.id) : false })
		}
		return out
	}

	/** Cheap presence check; does not hash. */
	isInstalled(modelId: unknown): boolean {
		if (!isKnownModelId(modelId)) return false
		return fs.existsSync(this.modelPath(modelId))
	}

	/** Full size + SHA-256 check of an installed model. */
	async isVerified(modelId: unknown): Promise<boolean> {
		if (!isKnownModelId(modelId)) return false
		const result = await verifyFile(this.modelPath(modelId), getModelPin(modelId))
		return result.ok
	}

	/**
	 * Resolves a verified model path, or throws a typed error. Never returns a
	 * path to a file that has not been verified in this call.
	 */
	async requireVerifiedModel(modelId: unknown): Promise<{ path: string; pin: ModelPin }> {
		if (!isKnownModelId(modelId)) {
			throw new VoiceError("MODEL_UNKNOWN", `Unknown whisper model: ${String(modelId)}`)
		}
		const pin = getModelPin(modelId)
		const result = await verifyFile(this.modelPath(modelId), pin)
		if (result.ok) return { path: result.path, pin }
		if (result.failure === "MODEL_FILE_MISSING") {
			throw new VoiceError("MODEL_NOT_INSTALLED", `The ${pin.id} model is not installed.`)
		}
		if (result.failure === "MODEL_SIZE_MISMATCH") {
			throw new VoiceError("MODEL_SIZE_MISMATCH", `The installed ${pin.id} model has the wrong size.`)
		}
		throw new VoiceError("MODEL_INTEGRITY_FAILED", `The installed ${pin.id} model failed verification.`)
	}

	/**
	 * Downloads and verifies a model.
	 *
	 * Concurrent calls for the same model share one transfer, so a double click
	 * cannot start two downloads or leave two `.part` files behind.
	 */
	async download(modelId: "tiny" | "base", options: DownloadOptions): Promise<DownloadResult> {
		if (options.consent !== true) {
			throw new VoiceError("MODEL_CONSENT_REQUIRED", "Downloading a speech model requires explicit consent.")
		}
		const existing = this.inflight.get(modelId)
		if (existing) return existing
		const task = this.runDownload(modelId, options).finally(() => this.inflight.delete(modelId))
		this.inflight.set(modelId, task)
		return task
	}

	/** Cancels an in-flight download for `modelId`; its partial file is removed. */
	abort(modelId: string): void {
		if (!isKnownModelId(modelId)) return
		this.aborted.add(modelId)
		cancelGeneration++
		// Wake a stalled read. Without this, a transport that ignores the signal
		// would leave the download hanging with a half-written `.part` file.
		const signal = this.cancelSignals.get(modelId)
		if (signal) {
			this.cancelSignals.delete(modelId)
			signal({ cancelled: true, error: new VoiceError("MODEL_DOWNLOAD_ABORTED", "The model download was cancelled.") })
		}
	}

	private async runDownload(modelId: "tiny" | "base", options: DownloadOptions): Promise<DownloadResult> {
		const pin = getModelPin(modelId)
		const dir = options.targetDir ?? this.modelDir
		const url = options.url ?? pin.url
		assertHttpsUrl(url)
		await fs.promises.mkdir(dir, { recursive: true })

		const target = path.join(dir, pin.fileName)
		const partPath = `${target}.part`
		const expectedTotal = pin.sizeBytes

		try {
			const response = await this.fetchImpl(url, { signal: options.signal, redirect: "follow" })
			if (!response.ok || !response.body) {
				throw new VoiceError("MODEL_DOWNLOAD_FAILED", `The model server replied ${response.status}.`)
			}
			let received = 0
			const handle = await fs.promises.open(partPath, "w")
			const cancelled = new Promise<DownloadFailure>((resolve) => {
				this.cancelSignals.set(modelId, resolve)
			})
			try {
				const reader = response.body.getReader()
				for (;;) {
					if (this.aborted.has(modelId) || options.signal?.aborted) {
						throw new VoiceError("MODEL_DOWNLOAD_ABORTED", "The model download was cancelled.")
					}
					const { done, value } = await raceCancel(reader.read(), cancelled)
					if (done) break
					if (!value) continue
					received += value.byteLength
					if (received > expectedTotal) {
						// A server sending more than the pinned size is not the pinned
						// artifact; stop before writing all of it.
						throw new VoiceError("MODEL_SIZE_MISMATCH", "The downloaded model is larger than expected.")
					}
					await handle.write(value)
					options.onProgress?.({ receivedBytes: received, totalBytes: expectedTotal })
				}
			} finally {
				await handle.close()
			}

			if (received !== expectedTotal) {
				throw new VoiceError("MODEL_SIZE_MISMATCH", `Expected ${expectedTotal} bytes, received ${received}.`)
			}

			const verification = await verifyFile(partPath, pin)
			if (!verification.ok) {
				if (verification.failure === "MODEL_SIZE_MISMATCH") {
					throw new VoiceError("MODEL_SIZE_MISMATCH", verification.detail ?? "Model size mismatch.")
				}
				throw new VoiceError("MODEL_INTEGRITY_FAILED", verification.detail ?? "Model integrity check failed.")
			}

			await fs.promises.rename(partPath, target)
			return { modelId, path: target, sizeBytes: pin.sizeBytes, sha256: pin.sha256 }
		} catch (error) {
			await fs.promises.rm(partPath, { force: true }).catch(() => undefined)
			if (error instanceof VoiceError) throw error
			if (isAbortError(error) || options.signal?.aborted) {
				throw new VoiceError("MODEL_DOWNLOAD_ABORTED", "The model download was cancelled.")
			}
			throw new VoiceError("MODEL_DOWNLOAD_FAILED", error instanceof Error ? error.message : "The model download failed.")
		} finally {
			this.aborted.delete(modelId)
			this.cancelSignals.delete(modelId)
		}
	}
}

/** Only HTTPS is accepted: a downgraded mirror must not be usable. */
export function assertHttpsUrl(url: string): void {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		throw new VoiceError("MODEL_DOWNLOAD_FAILED", "The model URL is not a valid absolute URL.")
	}
	if (parsed.protocol !== "https:") {
		throw new VoiceError("MODEL_DOWNLOAD_FAILED", "The model URL must use HTTPS.")
	}
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message))
}
