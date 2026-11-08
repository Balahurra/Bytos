import * as fs from "node:fs"
import * as path from "node:path"
import { HostProvider } from "@/hosts/host-provider"
import { resolveVoiceCapability } from "./capability"
import type { AudioCaptureProvider } from "./capture/AudioCaptureProvider"
import { tryLocateAudioHelper } from "./capture/binaryLocator"
import {
	DEFAULT_MODEL_ID,
	isKnownModelId,
	isWhisperPlatformSupported,
	WHISPER_MODEL_DIR_ENV,
} from "./transcription/models/modelCatalog"
import type { ModelId, RecognitionEngine } from "./transcription/types"
import type { VoiceCapability } from "./types"

/**
 * Public surface of the voice module (F1).
 *
 * Everything here is imported LAZILY — `extension.ts` must not pull the voice
 * module in at activation time (TD-15). The singleton below is created on first
 * use, and `disposeVoiceRuntime()` is called from `tearDown()` so the extension
 * never exits with a live capture helper (TD-14).
 */

export { resolveVoiceCapability } from "./capability"
export { AudioCaptureCoordinator } from "./capture/AudioCaptureCoordinator"
export { WasapiCaptureProvider } from "./capture/WasapiCaptureProvider"
export { isSupportedLanguage } from "./transcription/language"
export { ModelStore } from "./transcription/models/ModelStore"
export {
	DEFAULT_MODEL_ID,
	formatBytes,
	getModelPin,
	isKnownModelId,
	isWhisperPlatformSupported,
	listModels,
	PINNED_MODELS,
	WHISPER_ENGINE_DIR_ENV,
	WHISPER_MODEL_DIR_ENV,
} from "./transcription/models/modelCatalog"
export { locateVerifiedWhisperBinary, requireVerifiedWhisperBinary } from "./transcription/models/whisperBinaryLocator"
export type {
	EngineStatus,
	ModelId,
	ModelStatus,
	RecognitionEngine,
	TranscribeRequest,
	TranscribeResult,
	VoiceLanguage,
} from "./transcription/types"
export { SUPPORTED_LANGUAGES } from "./transcription/types"
// ── F2: local speech recognition (whisper.cpp) ──────────────────────────────
export { WhisperCliEngine } from "./transcription/WhisperCliEngine"
export type { VoiceCapability } from "./types"
export { VoiceError } from "./types"
export { VoiceRuntime } from "./VoiceRuntime"

export interface VoiceSettingsSnapshot {
	voiceEnabled: boolean
	voiceCaptureMethod: string
	voiceMicrophoneId: string | undefined
	voiceSilenceDetectionEnabled: boolean
	voiceSilenceTimeoutMs: number
	voiceMaxDurationMs: number
	/** F2/F3: transcription language ("auto" | "tr" | "en" | "de"). */
	voiceLanguage?: string
	/** F2/F3: recognition model id ("tiny" | "base"). */
	voiceModelId?: string
}

export interface VoiceRuntimeContext {
	/** Absolute path of the extension root (`context.extensionUri.fsPath`). */
	extensionRoot: string
	remoteName?: string
	uiKindWeb?: boolean
	settings: VoiceSettingsSnapshot
}

function defaultVoiceSettings(): VoiceSettingsSnapshot {
	return {
		voiceEnabled: false,
		voiceCaptureMethod: "auto",
		voiceMicrophoneId: undefined,
		voiceSilenceDetectionEnabled: true,
		voiceSilenceTimeoutMs: 1200,
		voiceMaxDurationMs: 120000,
		voiceLanguage: "auto",
		voiceModelId: DEFAULT_MODEL_ID,
	}
}

type VoiceRuntimeInstance = import("./VoiceRuntime").VoiceRuntime

let runtime: VoiceRuntimeInstance | undefined
let runtimeContext: VoiceRuntimeContext | undefined

/** Updates the cached settings the runtime derives capture options from. */
export function updateVoiceSettings(settings: Partial<VoiceSettingsSnapshot>): void {
	const current = runtimeContext?.settings ?? defaultVoiceSettings()
	runtimeContext = {
		extensionRoot: runtimeContext?.extensionRoot ?? "",
		remoteName: runtimeContext?.remoteName,
		uiKindWeb: runtimeContext?.uiKindWeb,
		settings: { ...current, ...settings },
	}
}

/**
 * Records the extension root before the runtime is built.
 *
 * F3: the Settings panel asks for the voice status before any capture RPC has
 * necessarily resolved a root. `HostProvider` is unavailable in a few contexts
 * (unit tests, standalone host), so a caller that already knows the root passes
 * it here and the runtime uses it instead of falling back to a missing path.
 */
export function primeVoiceContext(context: Partial<Omit<VoiceRuntimeContext, "settings">>): void {
	const current = runtimeContext
	runtimeContext = {
		extensionRoot: context.extensionRoot ?? current?.extensionRoot ?? "",
		remoteName: context.remoteName ?? current?.remoteName,
		uiKindWeb: context.uiKindWeb ?? current?.uiKindWeb,
		settings: current?.settings ?? defaultVoiceSettings(),
	}
}

/**
 * Absolute path of the installed extension, used to locate the capture helper.
 * Read through `HostProvider` (the project's abstraction layer) and only when a
 * runtime is actually being built — never at module import.
 */
function activeExtensionRoot(): string {
	try {
		return HostProvider.get().extensionFsPath ?? ""
	} catch {
		// Host not initialised (unit tests, standalone): no helper path is
		// derivable, and capability detection will report CAPTURE_HELPER_MISSING.
		return ""
	}
}

/** Remote / web host facts, so capability detection can refuse honestly. */
function activeHostFacts(): { remoteName: string | undefined; uiKindWeb: boolean } {
	try {
		const provider = HostProvider.get()
		const remoteName = (provider.hostBridge as { remoteName?: unknown }).remoteName
		return {
			remoteName: remoteName ? String(remoteName) : undefined,
			uiKindWeb: false,
		}
	} catch {
		return { remoteName: undefined, uiKindWeb: false }
	}
}

/**
 * Lazily builds the runtime. Nothing is spawned here: the capability object is
 * computed from process/host facts plus a cheap file existence check.
 *
 * F2: the recognition engine is only constructed when it can actually work —
 * a verified binary on disk and a model directory to use. If either is missing
 * the runtime is still created (capture keeps working) but reports
 * `canTranscribe === false`, so no caller can reach a half-configured engine.
 */
export async function getVoiceRuntime(
	override?: Partial<Omit<VoiceRuntimeContext, "settings">> & {
		settings?: Partial<VoiceSettingsSnapshot>
		capability?: VoiceCapability
		/** Test seam: replaces the real engine. */
		recognitionEngine?: RecognitionEngine
		/** Model directory override; defaults to `<storage>/voice/models`. */
		modelDir?: string
	},
): Promise<VoiceRuntimeInstance> {
	if (runtime) {
		return runtime
	}
	const { AudioCaptureCoordinator } = await import("./capture/AudioCaptureCoordinator")
	const { WasapiCaptureProvider } = await import("./capture/WasapiCaptureProvider")
	const { VoiceRuntime } = await import("./VoiceRuntime")

	const extensionRoot = override?.extensionRoot ?? runtimeContext?.extensionRoot ?? activeExtensionRoot()
	const settings = { ...(runtimeContext?.settings ?? defaultVoiceSettings()), ...(override?.settings ?? {}) }
	const capability =
		override?.capability ??
		resolveVoiceCapability({
			extensionRoot,
			remoteName: override?.remoteName ?? runtimeContext?.remoteName ?? activeHostFacts().remoteName,
			isWeb: override?.uiKindWeb ?? runtimeContext?.uiKindWeb ?? activeHostFacts().uiKindWeb,
			// Until a probe runs the device count is unknown; a supported host with
			// the helper present is treated as "possibly capturable" so `startCapture`
			// either succeeds or produces a specific typed error.
			deviceCount: 1,
			recorderIsolationVerified: true,
			voiceEnabled: settings.voiceEnabled,
		})

	const providers: AudioCaptureProvider[] = []
	if (capability.platform === "win32" && capability.arch === "x64") {
		const helperPath = capability.helperPath ?? tryLocateAudioHelper({ extensionRoot, platform: "win32", arch: "x64" })
		if (helperPath) {
			providers.push(new WasapiCaptureProvider({ helperPath: path.resolve(helperPath) }))
		}
	}

	const coordinator = new AudioCaptureCoordinator({
		providers,
		captureMethod: settings.voiceCaptureMethod,
		microphoneId: settings.voiceMicrophoneId,
	})
	const recognitionEngine = override?.recognitionEngine ?? (await createRecognitionEngine(override?.modelDir))
	const defaultModelId: ModelId = isKnownModelId(settings.voiceModelId) ? settings.voiceModelId : DEFAULT_MODEL_ID
	runtime = new VoiceRuntime(capability, coordinator, {
		silenceTimeoutMs: settings.voiceSilenceTimeoutMs,
		maxDurationMs: settings.voiceMaxDurationMs,
		recognitionEngine,
		defaultModelId,
	})
	return runtime
}

/**
 * Builds the whisper engine only when the machine can actually run it.
 *
 * Returns `undefined` — never a half-initialised engine — when the platform is
 * unsupported, the binary is missing or fails verification, or no model
 * directory is resolvable. The reason is logged as a code only: no audio, no
 * transcript and no local path beyond the engine's own directory.
 */
async function createRecognitionEngine(modelDirOverride?: string): Promise<RecognitionEngine | undefined> {
	if (!isWhisperPlatformSupported(process.platform, process.arch)) {
		return undefined
	}
	const modelDir = modelDirOverride ?? process.env[WHISPER_MODEL_DIR_ENV] ?? defaultModelDir()
	if (!modelDir) {
		return undefined
	}
	try {
		const { WhisperCliEngine } = await import("./transcription/WhisperCliEngine")
		const engine = new WhisperCliEngine()
		// The engine root is the extension tree, so the locator can search the
		// bundled `assets/voice/whisper` and the development tree's
		// `test-assets/voice-f2/whisper`. Passing an empty string here would make
		// the locator fall back to host defaults only and report a missing binary
		// in a development build that actually has one (F4 end-to-end path).
		await engine.init({ engineRoot: resolveVoiceEngineRoot(), modelDir })
		return engine
	} catch {
		// Missing or tampered engine: capture still works, transcription reports a
		// typed error when called. Nothing is retried implicitly.
		return undefined
	}
}

/**
 * Absolute root the whisper locator searches for the recogniser.
 *
 * `resolveVoiceModelDir()` already resolves the extension root (dev tree first,
 * then storage); its `<root>/voice/models` tail is replaced by the extension root
 * so `assets/voice/whisper` and `test-assets/voice-f2/whisper` are both reachable.
 * Returns `""` when no host storage is available, which makes the locator use its
 * own defaults.
 */
function resolveVoiceEngineRoot(): string {
	const modelDir = resolveVoiceModelDir()
	if (!modelDir) return ""
	// Development tree: `<extensionRoot>/test-assets/voice-f2/models`, whose engine
	// sibling is `<extensionRoot>/test-assets/voice-f2/whisper`.
	const devMarker = `${path.sep}test-assets${path.sep}voice-f2${path.sep}models`
	const devIndex = modelDir.indexOf(devMarker)
	if (devIndex > 0) {
		return modelDir.slice(0, devIndex)
	}
	// Installed layout: `<storage>/voice/models` — the locator derives
	// `<storage>/voice/whisper` from the storage root itself.
	const marker = `${path.sep}voice${path.sep}models`
	const index = modelDir.indexOf(marker)
	if (index > 0) {
		return modelDir.slice(0, index)
	}
	return path.dirname(path.dirname(modelDir))
}

/**
 * `<global storage>/voice/models`; empty when the host exposes no storage.
 *
 * A development tree that already downloaded the F2 assets keeps them in
 * `<extensionRoot>/test-assets/voice-f2/models`. Preferring that folder when it
 * exists means a developer build uses the models it actually has; a packaged
 * build never contains `test-assets/`, so it always falls through to storage.
 */
function defaultModelDir(): string {
	try {
		const provider = HostProvider.get()
		const extensionRoot = provider.extensionFsPath
		if (extensionRoot) {
			const devAssets = path.join(extensionRoot, "test-assets", "voice-f2", "models")
			if (fs.existsSync(devAssets)) {
				return devAssets
			}
		}
		const storage = provider.globalStorageFsPath
		return storage ? path.join(storage, "voice", "models") : ""
	} catch {
		return ""
	}
}

/**
 * F3: the absolute directory the recognition models live in — the same one
 * `getVoiceRuntime()` uses, so the Settings panel and the runtime can never
 * disagree about which models are installed.
 *
 * Returns `""` when the host exposes no storage; callers report that as an
 * unavailable engine rather than inventing a location.
 */
export function resolveVoiceModelDir(): string {
	return process.env[WHISPER_MODEL_DIR_ENV] ?? defaultModelDir()
}

/** Disposes the singleton if it was ever created. Safe to call repeatedly. */
export async function disposeVoiceRuntime(): Promise<void> {
	const current = runtime
	runtime = undefined
	if (current) {
		await current.dispose()
	}
	// Belt and braces: no helper may survive teardown even if a provider leaked.
	const { VoiceSessionRegistry } = await import("./VoiceSessionRegistry")
	await VoiceSessionRegistry.terminateAll()
}
