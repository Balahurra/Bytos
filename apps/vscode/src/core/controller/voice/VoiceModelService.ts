import * as fs from "node:fs"
import { resolveVoiceModelDir } from "@core/voice"
import { ModelStore } from "@core/voice/transcription/models/ModelStore"
import {
	DEFAULT_MODEL_ID,
	isKnownModelId,
	isWhisperPlatformSupported,
	listModels,
	type ModelPin,
} from "@core/voice/transcription/models/modelCatalog"
import { locateVerifiedWhisperBinary } from "@core/voice/transcription/models/whisperBinaryLocator"
import type { ModelId } from "@core/voice/transcription/types"
import { VoiceError, type VoiceErrorCode } from "@core/voice/types"
import { Logger } from "@/shared/services/Logger"

/**
 * F3 — the host-side owner of recognition-model state.
 *
 * This is the single place a model is downloaded, verified or removed, and the
 * single place the Settings panel's model rows get their data from. Nothing here
 * is mocked: every number comes from a real file on disk, a real SHA-256 pass, or
 * a real HTTP transfer through `ModelStore` (F2).
 *
 * ## Rules this module enforces
 *
 * 1. **Consent first.** `download()` refuses without `consent === true`; the
 *    size is disclosed to the user before that flag is ever set.
 * 2. **Nothing unverified is reported as ready.** `installed` and `verified` are
 *    separate fields, and a failed verification keeps the row in `failed`.
 * 3. **One transfer per model.** A second download for a model already in flight
 *    joins the existing task instead of starting a racing transfer.
 * 4. **Cancel leaves no residue.** The `.part` file is removed (F2 behaviour) and
 *    the row returns to `not-installed`.
 * 5. **Metadata only.** Every value this module produces is a model id, a byte
 *    count, a percentage, a state name or a stable error code. No audio, no
 *    transcript and no filesystem path leaves the host.
 */

export type VoiceModelState = "not-installed" | "downloading" | "verifying" | "ready" | "failed"

export interface VoiceModelView {
	/** `"tiny"` | `"base"`. */
	id: ModelId
	/** Human label, e.g. `Base`. */
	displayName: string
	/** Exact pinned artifact size in bytes. */
	sizeBytes: number
	fileName: string
	multilingual: boolean
	/** 0…100, truncated. */
	progressPercent: number
	/** A model file exists on disk (it may still be unverified). */
	installed: boolean
	/** The SHA-256 and size both match the pin. */
	verified: boolean
	state: VoiceModelState
	/** Stable code when `state === "failed"`. */
	errorCode: string
	isDefault: boolean
	approxMemoryMb: number
}

export interface VoiceModelChange {
	id: ModelId
	state: VoiceModelState
	progressPercent: number
	errorCode: string
}

export type VoiceModelChangeListener = (change: VoiceModelChange) => void

const EMPTY_PROGRESS = { receivedBytes: 0, totalBytes: 0 }

interface ModelRuntimeState {
	state: VoiceModelState
	receivedBytes: number
	totalBytes: number
	errorCode: string
	/** Cached verification, so the UI does not re-hash 148 MB on every render. */
	verified: boolean | undefined
}

function displayNameOf(pin: ModelPin): string {
	return pin.id === "base" ? "Base" : "Tiny"
}

function modelPin(modelId: ModelId): ModelPin {
	const pin = listModels().find((entry) => entry.id === modelId)
	if (!pin) {
		throw new VoiceError("MODEL_UNKNOWN", `Unknown whisper model: ${String(modelId)}`)
	}
	return pin
}

function percentOf(state: ModelRuntimeState): number {
	if (state.state === "ready") return 100
	if (state.totalBytes <= 0) return 0
	return Math.min(100, Math.floor((state.receivedBytes / state.totalBytes) * 100))
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/**
 * One process-wide service. The Settings panel, the model-download handler and
 * the (F4) composer all observe the same state, so progress can never diverge
 * between two panels.
 */
export class VoiceModelService {
	private store: ModelStore | undefined
	private storeDir = ""
	private readonly runtime = new Map<ModelId, ModelRuntimeState>()
	private readonly inflight = new Map<ModelId, AbortController>()
	private readonly listeners = new Set<VoiceModelChangeListener>()

	/** Subscribes to progress/state changes. Returns an unsubscribe function. */
	subscribe(listener: VoiceModelChangeListener): () => void {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}

	/**
	 * The store for the current model directory. A directory change (test seam,
	 * `BYTOS_WHISPER_MODEL_DIR`, or a host that only becomes ready later) resets
	 * the cached verification results, because they describe another folder.
	 */
	private modelStore(): ModelStore {
		const dir = resolveVoiceModelDir()
		if (!dir) {
			throw new VoiceError("MODEL_NOT_INSTALLED", "This editor does not expose a storage folder for voice models.")
		}
		if (!this.store) {
			this.store = new ModelStore({ modelDir: dir })
			this.storeDir = dir
			return this.store
		}
		if (this.storeDir !== dir) {
			// The directory genuinely changed (test seam or a late-resolved host):
			// the cached verification results describe another folder, so drop them.
			// This is the only case that clears state — switching the *selected*
			// model must never discard another model's verification.
			this.store = new ModelStore({ modelDir: dir })
			this.storeDir = dir
			this.runtime.clear()
		}
		return this.store
	}

	/** True when a model file is present (cheap `existsSync`, no hashing). */
	isInstalled(modelId: ModelId): boolean {
		try {
			return this.modelStore().isInstalled(modelId)
		} catch {
			return false
		}
	}

	private stateOf(modelId: ModelId): ModelRuntimeState {
		let state = this.runtime.get(modelId)
		if (!state) {
			state = { state: "not-installed", ...EMPTY_PROGRESS, errorCode: "", verified: undefined }
			this.runtime.set(modelId, state)
		}
		return state
	}

	private emit(change: VoiceModelChange): void {
		for (const listener of this.listeners) {
			try {
				listener(change)
			} catch (error) {
				Logger.warn("[Voice] A model-status listener failed:", error)
			}
		}
	}

	private setState(modelId: ModelId, patch: Partial<ModelRuntimeState>): void {
		const next: ModelRuntimeState = { ...this.stateOf(modelId), ...patch }
		this.runtime.set(modelId, next)
		this.emit({
			id: modelId,
			state: next.state,
			progressPercent: percentOf(next),
			errorCode: next.errorCode,
		})
	}

	/**
	 * Full size + SHA-256 verification of an installed model. Falls back to
	 * `not-installed` when the file is absent, and to `failed` with a stable code
	 * when the bytes do not match the pin.
	 */
	async verify(modelId: ModelId): Promise<VoiceModelView> {
		const store = this.modelStore()
		if (!store.isInstalled(modelId)) {
			this.setState(modelId, { state: "not-installed", ...EMPTY_PROGRESS, errorCode: "", verified: false })
			return this.viewOf(modelId)
		}
		this.setState(modelId, { state: "verifying", errorCode: "" })
		let verified = false
		try {
			verified = await store.isVerified(modelId)
		} catch (error) {
			Logger.warn(`[Voice] Verifying the ${modelId} model failed:`, error)
			verified = false
		}
		if (verified) {
			this.setState(modelId, { state: "ready", verified: true, errorCode: "", ...EMPTY_PROGRESS })
		} else {
			this.setState(modelId, {
				state: "failed",
				verified: false,
				errorCode: sizeMatches(store, modelId) ? "MODEL_INTEGRITY_FAILED" : "MODEL_SIZE_MISMATCH",
			})
		}
		return this.viewOf(modelId)
	}

	/**
	 * Downloads and verifies a model. Requires explicit consent and reports
	 * `MODEL_CONSENT_REQUIRED` otherwise — there is no implicit download path.
	 */
	async download(modelId: ModelId, options: { consent: boolean }): Promise<VoiceModelView> {
		if (options.consent !== true) {
			throw new VoiceError("MODEL_CONSENT_REQUIRED", "Downloading a speech model requires explicit consent.")
		}
		const store = this.modelStore()
		if (this.inflight.has(modelId)) {
			// A second click joins the running transfer instead of racing it.
			return this.viewOf(modelId)
		}
		const controller = new AbortController()
		this.inflight.set(modelId, controller)
		const disclosure = store.describeDownload(modelId)
		this.setState(modelId, {
			state: "downloading",
			receivedBytes: 0,
			totalBytes: disclosure.bytes,
			errorCode: "",
			verified: false,
		})

		try {
			await store.download(modelId, {
				consent: true,
				signal: controller.signal,
				onProgress: ({ receivedBytes, totalBytes }) => {
					const current = this.stateOf(modelId)
					if (current.state !== "downloading") {
						return
					}
					const next = { ...current, receivedBytes, totalBytes }
					this.runtime.set(modelId, next)
					this.emit({ id: modelId, state: "downloading", progressPercent: percentOf(next), errorCode: "" })
				},
			})
			// `ModelStore` publishes a file only after size + SHA-256 match, so
			// reaching this line means the bytes on disk are verified.
			this.setState(modelId, { state: "ready", verified: true, errorCode: "", ...EMPTY_PROGRESS })
		} catch (error) {
			const code = error instanceof VoiceError ? error.code : "MODEL_DOWNLOAD_FAILED"
			const aborted = code === "MODEL_DOWNLOAD_ABORTED"
			this.setState(modelId, {
				state: aborted ? "not-installed" : "failed",
				...(aborted ? EMPTY_PROGRESS : {}),
				errorCode: aborted ? "" : code,
				verified: false,
			})
			throw error instanceof VoiceError ? error : new VoiceError("MODEL_DOWNLOAD_FAILED", messageOf(error))
		} finally {
			this.inflight.delete(modelId)
		}
		return this.viewOf(modelId)
	}

	/** Cancels an in-flight download. Safe to call when nothing is running. */
	cancelDownload(modelId: ModelId): void {
		const controller = this.inflight.get(modelId)
		if (!controller) {
			return
		}
		this.modelStore().abort(modelId)
		controller.abort()
	}

	/** True when a transfer for `modelId` is currently running. */
	isDownloading(modelId: ModelId): boolean {
		return this.inflight.has(modelId)
	}

	/**
	 * Deletes an installed model file. The row returns to `not-installed`.
	 * Refuses while a transfer is running so a download cannot become orphaned.
	 */
	async remove(modelId: ModelId): Promise<void> {
		if (this.inflight.has(modelId)) {
			throw new VoiceError("MODEL_DOWNLOAD_FAILED", "Cancel the download before removing this model.")
		}
		const store = this.modelStore()
		const target = store.modelPath(modelId)
		await fs.promises.rm(target, { force: true })
		await fs.promises.rm(`${target}.part`, { force: true }).catch(() => undefined)
		this.setState(modelId, { state: "not-installed", verified: false, errorCode: "", ...EMPTY_PROGRESS })
	}

	/** One row, without hashing anything. */
	viewOf(modelId: ModelId): VoiceModelView {
		const pin = modelPin(modelId)
		const state = this.stateOf(modelId)
		const installed = this.isInstalled(modelId)
		let resolved = state
		if (state.state !== "downloading" && state.state !== "verifying") {
			// Never claim `ready` for bytes that were not verified in this session.
			// Three distinct outcomes, because the panel offers a different action
			// for each: present-and-verified → ready; present-but-unchecked →
			// `failed` with MODEL_UNVERIFIED ("Verify" is offered); absent →
			// not-installed ("Download" is offered).
			if (!installed) {
				resolved = { ...state, state: "not-installed", errorCode: "" }
			} else if (state.verified === true) {
				resolved = { ...state, state: "ready", errorCode: "" }
			} else {
				resolved = { ...state, state: "failed", errorCode: state.errorCode || "MODEL_UNVERIFIED" }
			}
		}
		return {
			id: modelId,
			displayName: displayNameOf(pin),
			sizeBytes: pin.sizeBytes,
			fileName: pin.fileName,
			multilingual: pin.multilingual,
			progressPercent: percentOf(resolved),
			installed,
			verified: resolved.state === "ready",
			state: resolved.state,
			errorCode: resolved.errorCode,
			isDefault: modelId === DEFAULT_MODEL_ID,
			approxMemoryMb: pin.approxResidentMemoryMb,
		}
	}

	/**
	 * Every pinned model, cheapest first. Verification comes from cache: the
	 * Settings panel calls `verify()` explicitly (and a download sets it), so
	 * opening the panel never re-hashes 225 MB of models.
	 */
	list(): VoiceModelView[] {
		return listModels().map((pin) => this.viewOf(pin.id))
	}

	/** True when the selected model verified in this session and is still on disk. */
	isModelReady(modelId: ModelId): boolean {
		return this.stateOf(modelId).verified === true && this.isInstalled(modelId)
	}

	/** Test seam: forget cached state (never touches files). */
	resetForTesting(): void {
		this.runtime.clear()
		this.inflight.clear()
		this.listeners.clear()
		this.store = undefined
		this.storeDir = ""
	}
}

/** Distinguishes "wrong size" from "right size, wrong bytes" for the UI. */
function sizeMatches(store: ModelStore, modelId: ModelId): boolean {
	try {
		return fs.statSync(store.modelPath(modelId)).size === modelPin(modelId).sizeBytes
	} catch {
		return false
	}
}

let service: VoiceModelService | undefined

/** The process-wide model service. */
export function getVoiceModelService(): VoiceModelService {
	service ??= new VoiceModelService()
	return service
}

/** Test-only: drops the singleton between cases. */
export function resetVoiceModelServiceForTesting(): void {
	service?.resetForTesting()
	service = undefined
}

/** ---------------------------------------------------------------------------
 * whisper engine resolution (read-only — never spawns a child process)
 * ------------------------------------------------------------------------- */

export type VoiceEngineState = "ready" | "missing" | "integrity-failed" | "unsupported-platform"

export interface VoiceEngineView {
	state: VoiceEngineState
	/** Stable code when `state !== "ready"`. */
	errorCode: VoiceErrorCode | ""
}

/**
 * Resolves and verifies the pinned `whisper-cli` closure. Reads files only, so
 * opening Settings never starts a process.
 */
export async function resolveVoiceEngine(options: { extensionRoot?: string } = {}): Promise<VoiceEngineView> {
	if (!isWhisperPlatformSupported(process.platform, process.arch)) {
		return { state: "unsupported-platform", errorCode: "WHISPER_BINARY_UNSUPPORTED_PLATFORM" }
	}
	const located = await locateVerifiedWhisperBinary({
		extensionRoot: options.extensionRoot,
		storageRoot: storageRootOf(resolveVoiceModelDir()),
	})
	if (located.ok) {
		return { state: "ready", errorCode: "" }
	}
	if (located.failures.length > 0) {
		return { state: "integrity-failed", errorCode: "WHISPER_BINARY_INTEGRITY_FAILED" }
	}
	return { state: "missing", errorCode: "WHISPER_BINARY_MISSING" }
}

/**
 * `<storage>/voice/models` → `<storage>`: the model directory's parent is the
 * same per-user storage root the engine locator searches.
 */
function storageRootOf(modelDir: string): string | undefined {
	if (!modelDir) return undefined
	const normalized = modelDir.replace(/[\\/]+$/, "")
	const parent = normalized.slice(0, Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/")))
	return parent.length > 0 ? parent : undefined
}

/** Validates a model id coming from the webview. */
export function assertModelId(value: unknown): ModelId {
	if (!isKnownModelId(value)) {
		throw new VoiceError("MODEL_UNKNOWN", `Unknown whisper model: ${String(value)}`)
	}
	return value
}
