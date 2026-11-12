/**
 * F2 — local speech recognition types.
 *
 * Nothing here is ever serialised onto ProtoBus, and nothing here can carry
 * audio: `TranscribeResult` is text plus counters, and the audio argument of a
 * transcription is a host-memory `Int16Array` that no type in this file stores.
 */

/** Languages Bytos actually supports in F2. No other code is offered. */
export type VoiceLanguage = "auto" | "tr" | "en" | "de"

export interface LanguageInfo {
	/** BCP-47-ish whisper language code. */
	code: Exclude<VoiceLanguage, "auto">
	/** English name, for logs and (later) Settings labels. */
	englishName: string
	/** Native name, for the UI phases. */
	nativeName: string
}

export const SUPPORTED_LANGUAGES: readonly LanguageInfo[] = [
	{ code: "tr", englishName: "Turkish", nativeName: "Türkçe" },
	{ code: "en", englishName: "English", nativeName: "English" },
	{ code: "de", englishName: "German", nativeName: "Deutsch" },
] as const

/** A pinned built-in id (`tiny`, `base`) or a registered custom id (`custom:…`). */
export type ModelId = string

/**
 * A pinned, verified model artifact.
 *
 * `sha256` and `sizeBytes` were computed by Bytos from the exact bytes the
 * download produces — never copied from upstream metadata. See
 * `models/modelCatalog.ts` for the provenance notes.
 */
export interface WhisperModelInfo {
	id: ModelId
	/** File name inside the model directory, e.g. `ggml-tiny.bin`. */
	fileName: string
	/** Exact size in bytes; a mismatch is a hard failure, not a warning. */
	sizeBytes: number
	/** Lowercase hex SHA-256 of the exact bytes. */
	sha256: string
	/** Download URL. HTTPS only. */
	url: string
	/**
	 * Quality tier, measured in F2 on the reference host. `base` is the default
	 * because `tiny` measurably mangles non-English output.
	 */
	tier: "fast" | "balanced"
	/**
	 * Working-set peak measured for this model on Windows x64 (MB, CPU only).
	 * Used to pick a default without a benchmarking pass.
	 */
	approxResidentMemoryMb: number
	/** True when the model is multilingual (required for tr/de). */
	multilingual: boolean
}

export type ModelState = "not-installed" | "downloading" | "verifying" | "ready" | "failed"

export interface ModelStatus {
	modelId: ModelId
	state: ModelState
	/** Absolute path once installed. */
	path?: string
	/** 0…1 while downloading. */
	progress?: number
	receivedBytes?: number
	totalBytes: number
	errorCode?: string
	message?: string
}

export interface ModelDownloadOptions {
	/**
	 * Explicit user consent. F2 requires it to be `true`; the download does not
	 * start otherwise, and the size is disclosed before it starts.
	 */
	consent: boolean
	signal?: AbortSignal
	onProgress?: (progress: { receivedBytes: number; totalBytes: number }) => void
	/** Absolute URL override; HTTPS only. Test seam. */
	url?: string
	/** Directory override; defaults to the model directory. */
	targetDir?: string
}

export interface TranscribeRequest {
	/** 16 kHz mono PCM16, held in host memory only. */
	samples: Int16Array
	language: VoiceLanguage
	modelId: ModelId
	signal?: AbortSignal
	/** Hard ceiling per utterance. Defaults to 120 s. */
	timeoutMs?: number
}

export interface TranscribeResult {
	/** Transcript, may be `""` for silence. Already normalised. */
	text: string
	/** Language reported by the engine (detected when `language === "auto"`). */
	language: VoiceLanguage
	/** Wall-clock time from spawn to exit. */
	durationMs: number
	/** Time the engine spent on inference, parsed from its own timing output. */
	inferenceMs?: number
	/** Engine id, always `whisper-cli` in F2. */
	engine: string
	modelId: ModelId
	/** Non-fatal notes (e.g. suspected language mismatch). Never audio. */
	warnings: string[]
	/** Audio length that was transcribed. */
	audioDurationMs: number
}

export interface RecognitionEngine {
	readonly id: "whisper-cli"
	/** Resolves the pinned binary and verifies it. Throws a typed `VoiceError`. */
	init(options: EngineInitOptions): Promise<EngineStatus>
	/** Loads a verified model. Throws a typed `VoiceError`. */
	loadModel(modelId: ModelId): Promise<ModelStatus>
	transcribe(request: TranscribeRequest): Promise<TranscribeResult>
	/** Kills any in-flight child process. Idempotent. */
	dispose(): Promise<void>
}

export interface EngineInitOptions {
	/** Directory that contains the whisper binary and its DLLs. */
	engineRoot: string
	/**
	 * Optional per-user storage root. The locator also searches
	 * `<storageRoot>/voice/whisper`, which keeps an engine installed outside the
	 * extension working. Defaults to `engineRoot` for backward compatibility.
	 */
	storageRoot?: string
	/** Directory that holds verified models. */
	modelDir: string
	/** Injectable for tests. */
	runtime?: EngineRuntime
}

export interface EngineStatus {
	ready: boolean
	binaryPath?: string
	version?: string
	supportedPlatform: boolean
	reason?: string
}

/**
 * Narrow process/FS seams so the engine is unit-testable without shipping any
 * mock in production code: the default implementation uses the real
 * `node:child_process` and `node:fs`.
 */
export interface EngineRuntime {
	spawn: typeof import("node:child_process").spawn
	readFile(path: string): Promise<Buffer>
	stat(path: string): Promise<{ size: number }>
	createHash(): import("node:crypto").Hash
}
