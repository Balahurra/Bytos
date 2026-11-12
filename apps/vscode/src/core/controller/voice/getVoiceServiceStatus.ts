import { isSupportedLanguage } from "@core/voice/transcription/language"
import { DEFAULT_MODEL_ID, isKnownModelId } from "@core/voice/transcription/models/modelCatalog"
import { EmptyRequest } from "@shared/proto/bytos/common"
import { CaptureDeviceInfo, VoiceModelInfo, VoiceServiceStatus } from "@shared/proto/bytos/voice"
import type { Controller } from ".."
import { getVoiceStatus } from "./getVoiceStatus"
import { extensionRoot as hostExtensionRoot, readMicrophoneState, runtimeFor, toVoiceErrorCode } from "./shared"
import { getVoiceModelService, resolveVoiceEngine, type VoiceModelView } from "./VoiceModelService"

/** Resolves the whisper engine view. Injected so tests need no real engine. */
export type EngineResolver = typeof resolveVoiceEngine

let engineResolver: EngineResolver | undefined

/** Test seam: replaces engine resolution. */
export function setVoiceEngineResolverForTesting(resolver: EngineResolver | undefined): void {
	engineResolver = resolver
}

/**
 * `getVoiceServiceStatus` — the single read the Settings → Voice section needs.
 *
 * Everything it returns is host-owned reality:
 *  - `capability`    — the F1 capability object (platform, helper, permission);
 *  - `microphone*`   — the result of enumerating real devices right now;
 *  - `engine*`       — the pinned whisper binary's resolution/verification;
 *  - `models`        — per-model size, install/verify state, progress;
 *  - `language` / `modelId` — the persisted preferences, validated on read.
 *
 * Nothing here starts a transcription. The only process that can be started is
 * the F1 enumeration helper, and only when the host is structurally capable
 * (supported platform + helper on disk). It runs even while Voice is switched
 * off, so the panel can list devices before the user enables the feature.
 */
export async function getVoiceServiceStatus(controller: Controller, _request: EmptyRequest): Promise<VoiceServiceStatus> {
	const voiceEnabled = controller.stateManager.getGlobalSettingsKey("voiceEnabled") === true

	// Enumerate first, then read the capability: `readMicrophoneState` folds the
	// fresh device observation back into the runtime, so the status returned here
	// and the capability `startCapture` enforces can never disagree. Reading the
	// capability first would report a stale `NO_CAPTURE_DEVICE` after a hot-plug.
	let microphone: { available: boolean; errorCode: string; devices: CaptureDeviceInfo[] } = {
		available: false,
		errorCode: voiceEnabled ? "NO_CAPTURE_DEVICE" : "VOICE_DISABLED",
		devices: [],
	}
	try {
		const runtime = await runtimeFor(controller)
		const state = await readMicrophoneState(runtime, { voiceEnabled })
		microphone = {
			available: state.available,
			errorCode: state.errorCode,
			devices: state.devices.map((device) => CaptureDeviceInfo.create(device)),
		}
	} catch (error) {
		microphone = { available: false, errorCode: toVoiceErrorCode(error), devices: [] }
	}

	const capability = await getVoiceStatus(controller, EmptyRequest.create())

	const { resolveVoiceEngine } = await import("./VoiceModelService")
	const engine = await (engineResolver ?? resolveVoiceEngine)({ extensionRoot: extensionRoot() })
	const models = getVoiceModelService()
	// `list()` also loads the custom-model registry for this directory, so a
	// custom id that is still persisted is recognised below.
	const modelViews = models.list()
	const storedLanguage = controller.stateManager.getGlobalSettingsKey("voiceLanguage")
	const storedModelId = controller.stateManager.getGlobalSettingsKey("voiceModelId")
	const language = isSupportedLanguage(storedLanguage) ? storedLanguage : "auto"
	const modelId = isKnownModelId(storedModelId) && models.hasModel(storedModelId) ? storedModelId : DEFAULT_MODEL_ID

	return VoiceServiceStatus.create({
		capability,
		language,
		modelId,
		models: modelViews.map(toProtoModel),
		engineState: engine.state,
		engineErrorCode: engine.errorCode,
		transcribeReady: engine.state === "ready" && models.isModelReady(modelId),
		microphoneAvailable: microphone.available,
		microphoneErrorCode: microphone.errorCode,
		devices: microphone.devices,
	})
}
/** Maps one model view onto its wire form. Counters and states only. */
export function toProtoModel(view: VoiceModelView): VoiceModelInfo {
	return VoiceModelInfo.create({
		id: view.id,
		displayName: view.displayName,
		sizeBytes: view.sizeBytes,
		fileName: view.fileName,
		multilingual: view.multilingual,
		progressPercent: view.progressPercent,
		installed: view.installed,
		verified: view.verified,
		state: view.state,
		errorCode: view.errorCode,
		isDefault: view.isDefault,
		approxMemoryMb: view.approxMemoryMb,
		isCustom: view.isCustom,
	})
}

/**
 * The extension root comes from the shared helper so the status read and the
 * runtime always resolve the same paths.
 */
function extensionRoot(): string | undefined {
	return hostExtensionRoot()
}
