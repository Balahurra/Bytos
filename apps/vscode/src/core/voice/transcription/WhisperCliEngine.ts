import type { ChildProcess } from "node:child_process"
import { VOICE_SAMPLE_RATE, VoiceError } from "../types"
import { isLanguageMismatch, normaliseDetectedLanguage } from "./language"
import { ModelStore } from "./models/ModelStore"
import { DEFAULT_MODEL_ID, isKnownModelId } from "./models/modelCatalog"
import { requireVerifiedWhisperBinary } from "./models/whisperBinaryLocator"
import { containsSpeech, filterHallucinations } from "./speechGuard"
import type {
	EngineInitOptions,
	EngineStatus,
	ModelId,
	ModelStatus,
	RecognitionEngine,
	TranscribeRequest,
	TranscribeResult,
} from "./types"
import { wavFromPcm16 } from "./wav"
import { parseDetectedLanguage, parseInferenceMs, parseTranscriptStdout } from "./whisperArgs"
import { mapExitCodeToError, summariseStderr } from "./whisperErrors"
import { runWhisperForTranscript, type WhisperChildResult } from "./whisperProcess"

/**
 * `RecognitionEngine` implementation over the pinned `whisper-cli` (F2-d).
 *
 * ## Audio path (TD-5 / TD-13)
 *
 * ```
 * F1 UtteranceBuffer (Int16Array, host memory)
 *   → wavFromPcm16()   44-byte RIFF header + payload, in memory
 *   → child stdin      single streaming write, then EOF
 *   → transcript text  child stdout, UTF-8
 * ```
 *
 * No file, no temp path, and no audio in any log line. The child is spawned with
 * an argv array (`shell` stays `false`), a scrubbed environment so provider
 * credentials are never visible to it, and `windowsHide` so no console flashes.
 *
 * ## Lifecycle rules
 *
 * - **One transcription at a time.** A second `transcribe()` while one runs is a
 *   typed error, not a queued job: the caller owns sequencing.
 * - **Every child is registered** in `VoiceSessionRegistry`, so `tearDown()`
 *   reaps it even if the host shuts down mid-transcription.
 * - **Cancel is immediate.** An `AbortSignal` kills the child; partial output is
 *   discarded and `TRANSCRIBE_ABORTED` is thrown.
 * - **Timeout is per utterance** and kills the child, so a wedged model cannot
 *   pin a core forever.
 * - **`dispose()` is idempotent** and leaves no child process behind.
 */
export class WhisperCliEngine implements RecognitionEngine {
	readonly id = "whisper-cli" as const

	private executablePath: string | undefined
	private store: ModelStore | undefined
	private status: EngineStatus = { ready: false, supportedPlatform: false }
	private activeChild: ChildProcess | undefined
	private activeAbort: AbortController | undefined
	private disposed = false
	private readonly loadedModels = new Map<ModelId, ModelStatus>()

	async init(options: EngineInitOptions): Promise<EngineStatus> {
		if (this.disposed) {
			throw new VoiceError("TRANSCRIBE_RUNTIME_DISPOSED")
		}
		this.store = new ModelStore({ modelDir: options.modelDir })
		// The caller-supplied engine root wins over the host defaults, so an
		// explicitly configured (or test) location is never silently ignored. The
		// extension root finds the bundled `<extensionRoot>/assets/voice/whisper`
		// engine; the storage root keeps a per-user `<storage>/voice/whisper`
		// installation working too.
		const locatorOptions: {
			extensionRoot?: string
			storageRoot?: string
		} = {}
		if (options.engineRoot) {
			locatorOptions.extensionRoot = options.engineRoot
		}
		const storageRoot = options.storageRoot ?? options.engineRoot
		if (storageRoot) {
			locatorOptions.storageRoot = storageRoot
		}
		const resolved = await requireVerifiedWhisperBinary(locatorOptions)
		this.executablePath = resolved.executablePath
		this.status = { ready: true, binaryPath: resolved.executablePath, supportedPlatform: true }
		return this.status
	}

	get engineStatus(): EngineStatus {
		return this.status
	}

	get models(): ModelStore {
		if (!this.store) {
			throw new VoiceError("MODEL_NOT_INSTALLED", "The recognition engine has not been initialised.")
		}
		return this.store
	}

	/**
	 * Verifies a model is installed and intact before use. `init()` must have run.
	 * The result is cached for the process lifetime.
	 */
	async loadModel(modelId: ModelId): Promise<ModelStatus> {
		if (this.disposed) {
			throw new VoiceError("TRANSCRIBE_RUNTIME_DISPOSED")
		}
		if (!isKnownModelId(modelId)) {
			throw new VoiceError("MODEL_UNKNOWN", `Unknown whisper model: ${String(modelId)}`)
		}
		const { path, pin } = await this.models.requireVerifiedModel(modelId)
		const status: ModelStatus = { modelId, state: "ready", path, totalBytes: pin.sizeBytes }
		this.loadedModels.set(modelId, status)
		return status
	}

	/** Cheap view of the cached model state; never re-hashes. */
	modelStatus(modelId: ModelId): ModelStatus | undefined {
		return this.loadedModels.get(modelId)
	}

	async transcribe(request: TranscribeRequest): Promise<TranscribeResult> {
		if (this.disposed) {
			throw new VoiceError("TRANSCRIBE_RUNTIME_DISPOSED")
		}
		if (!this.executablePath) {
			throw new VoiceError("WHISPER_BINARY_MISSING", "The recognition engine has not been initialised.")
		}
		if (this.activeChild) {
			throw new VoiceError("TRANSCRIBE_ALREADY_ACTIVE", "A transcription is already running.")
		}
		if (request.signal?.aborted) {
			throw new VoiceError("TRANSCRIBE_ABORTED")
		}
		const { samples, language } = request
		if (!(samples instanceof Int16Array)) {
			throw new VoiceError("TRANSCRIBE_AUDIO_INVALID", "Expected 16 kHz mono PCM16 samples.")
		}
		if (samples.length === 0) {
			throw new VoiceError("TRANSCRIBE_NO_AUDIO", "There was no audio to transcribe.")
		}
		const modelId = request.modelId ?? DEFAULT_MODEL_ID
		const { path: modelPath } = await this.models.requireVerifiedModel(modelId)
		const audioDurationMs = (samples.length / VOICE_SAMPLE_RATE) * 1000

		// Guard 1: no speech-plausible energy ⇒ do not spawn the recogniser at all.
		// Measured: whisper answers digital silence with "you" and quiet noise with
		// "[BLANK_AUDIO]"-style annotations instead of empty text.
		if (!containsSpeech(samples)) {
			return {
				text: "",
				language,
				durationMs: 0,
				engine: this.id,
				modelId,
				warnings: ["No speech detected in the utterance."],
				audioDurationMs,
			}
		}

		// Generous ceiling: F0 measured roughly 0.25x real time on `base`, so 8x
		// covers a cold start on a slow machine without hanging indefinitely.
		const timeoutMs = request.timeoutMs ?? Math.max(120000, Math.ceil(audioDurationMs * 8))

		const abort = new AbortController()
		const onExternalAbort = () => abort.abort()
		request.signal?.addEventListener("abort", onExternalAbort, { once: true })
		this.activeAbort = abort

		const startedAt = Date.now()
		let result: WhisperChildResult
		try {
			result = await runWhisperForTranscript({
				executablePath: this.executablePath,
				modelPath,
				language,
				audio: wavFromPcm16(samples),
				timeoutMs,
				signal: abort.signal,
				onSpawn: (child) => {
					this.activeChild = child
				},
			})
		} finally {
			request.signal?.removeEventListener("abort", onExternalAbort)
			this.activeChild = undefined
			this.activeAbort = undefined
		}
		return this.buildResult({ result, language, modelId, durationMs: Date.now() - startedAt, audioDurationMs })
	}

	/**
	 * Turns a finished child into a `TranscribeResult`.
	 *
	 * stderr is scanned even on exit code 0: whisper reports `unknown language`
	 * and then exits success, so trusting the code alone would return an empty
	 * transcript as if the audio had been silent.
	 */
	private buildResult(input: {
		result: WhisperChildResult
		language: TranscribeRequest["language"]
		modelId: ModelId
		durationMs: number
		audioDurationMs: number
	}): TranscribeResult {
		const { result, language, modelId, durationMs, audioDurationMs } = input
		const { stdout, stderr, exitCode } = result
		const failure = mapExitCodeToError(exitCode, stderr)
		if (exitCode !== 0 || failure.code !== "VOICE_INTERNAL_ERROR") {
			failure.message = `${failure.message} (${summariseStderr(stderr)})`
			throw failure
		}

		const text = parseTranscriptStdout(stdout)
		const detected = normaliseDetectedLanguage(parseDetectedLanguage(stderr))
		const warnings: string[] = []
		if (text.length > 0 && isLanguageMismatch(language, detected)) {
			warnings.push(`The engine detected ${detected} although ${language} was requested.`)
		}
		// Guard 2: strip whisper's non-speech annotations and its silence token.
		const filtered = filterHallucinations(text)
		if (filtered.removed.length > 0) {
			warnings.push("Recogniser output contained only non-speech markers.")
		}
		return {
			// Silence legitimately yields ""; the caller can tell "you said nothing"
			// from a failure because every failure throws instead.
			text: filtered.text,
			language: detected ?? language,
			durationMs,
			inferenceMs: parseInferenceMs(stderr),
			engine: this.id,
			modelId,
			warnings,
			audioDurationMs,
		}
	}

	async dispose(): Promise<void> {
		if (this.disposed) return
		this.disposed = true
		this.activeAbort?.abort()
		const child = this.activeChild
		this.activeChild = undefined
		if (child && child.exitCode === null && child.signalCode === null) {
			try {
				child.kill()
			} catch {
				// already gone
			}
		}
		this.loadedModels.clear()
		this.store = undefined
		this.executablePath = undefined
		this.status = { ready: false, supportedPlatform: false }
	}
}
