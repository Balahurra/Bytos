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
 * the F1 enumeration helper, and only when capture is actually possible.
 */
export async function getVoiceServiceStatus(controller: Controller, _request: EmptyRequest): Promise<VoiceServiceStatus> {
	const capability = await getVoiceStatus(controller, EmptyRequest.create())

	let microphone: { available: boolean; errorCode: string; devices: CaptureDeviceInfo[] } = {
		available: false,
		errorCode: capability.unavailableReason || "VOICE_DISABLED",
		devices: [],
	}
	try {
		const runtime = await runtimeFor(controller)
		const state = await readMicrophoneState(runtime)
		microphone = {
			available: state.available,
			errorCode: state.errorCode,
			devices: state.devices.map((device) => CaptureDeviceInfo.create(device)),
		}
	} catch (error) {
		microphone = { available: false, errorCode: toVoiceErrorCode(error), devices: [] }
	}

	const { resolveVoiceEngine } = await import("./VoiceModelService")
	const engine = await (engineResolver ?? resolveVoiceEngine)({ extensionRoot: extensionRoot() })
	const models = getVoiceModelService()
	const storedLanguage = controller.stateManager.getGlobalSettingsKey("voiceLanguage")
	const storedModelId = controller.stateManager.getGlobalSettingsKey("voiceModelId")
	const language = isSupportedLanguage(storedLanguage) ? storedLanguage : "auto"
	const modelId = isKnownModelId(storedModelId) ? storedModelId : DEFAULT_MODEL_ID

	return VoiceServiceStatus.create({
		capability,
		language,
		modelId,
		models: models.list().map(toProtoModel),
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
	})
}

/**
 * The extension root comes from the shared helper so the status read and the
 * runtime always resolve the same paths.
 */
function extensionRoot(): string | undefined {
	return hostExtensionRoot()
}
