import { getVoiceRuntime, primeVoiceContext, updateVoiceSettings, VoiceError, type VoiceRuntime } from "@core/voice"
import { DEFAULT_MODEL_ID } from "@core/voice/transcription/models/modelCatalog"
import { HostProvider } from "@/hosts/host-provider"
import type { Controller } from ".."

/**
 * Shared plumbing for the audio-free VoiceService handlers (T5b).
 *
 * Rules these helpers exist to enforce:
 *  - the voice runtime is created lazily and configured from the extension
 *    context exactly once;
 *  - settings are pushed into the runtime from the existing state manager, so a
 *    pinned capture method / microphone is honoured;
 *  - errors are converted to stable codes before they reach the webview — a
 *    stack trace or local path must never be surfaced;
 *  - nothing here accepts, returns, logs or forwards audio.
 */

function pickVoiceSettings(controller: Controller): Parameters<typeof updateVoiceSettings>[0] {
	const state = controller.stateManager
	return {
		voiceEnabled: !!state.getGlobalSettingsKey("voiceEnabled"),
		voiceCaptureMethod: state.getGlobalSettingsKey("voiceCaptureMethod") ?? "auto",
		voiceMicrophoneId: state.getGlobalSettingsKey("voiceMicrophoneId"),
		voiceSilenceDetectionEnabled: state.getGlobalSettingsKey("voiceSilenceDetectionEnabled") ?? true,
		voiceSilenceTimeoutMs: state.getGlobalSettingsKey("voiceSilenceTimeoutMs") ?? 1200,
		voiceMaxDurationMs: state.getGlobalSettingsKey("voiceMaxDurationMs") ?? 120000,
		voiceLanguage: state.getGlobalSettingsKey("voiceLanguage") ?? "auto",
		voiceModelId: state.getGlobalSettingsKey("voiceModelId") ?? DEFAULT_MODEL_ID,
	}
}

/**
 * Lazily obtains the runtime for a request. This is the ONLY place a handler
 * touches the runtime, so `getVoiceStatus` can be asserted to spawn nothing.
 *
 * The persisted settings are pushed in on every call, including `voiceEnabled`:
 * the runtime is a singleton that outlives the first read, so a setting the user
 * changed after it was built has to be re-applied here. Without this the panel
 * would keep showing the state captured at construction time.
 */
export async function runtimeFor(controller: Controller): Promise<VoiceRuntime> {
	const settings = pickVoiceSettings(controller)
	updateVoiceSettings(settings)
	// F3: make sure the runtime knows where the extension lives before it is
	// built. `getVoiceRuntime` resolves the capture helper under
	// `<extensionRoot>/assets/voice/bin/...`; without a primed root a first read
	// from Settings would report CAPTURE_HELPER_MISSING even though the helper is
	// present, and the singleton would cache that wrong answer.
	const root = extensionRoot()
	if (root) {
		primeVoiceContext({ extensionRoot: root })
	}
	const runtime = await getVoiceRuntime()

	// The singleton outlives the first read, so the settings-driven half of the
	// capability is recomputed on every call. Platform, helper and
	// recorder-isolation facts are left exactly as the runtime resolved them: a
	// missing helper must never be masked by a settings refresh.
	const current = runtime?.capability
	if (!current || typeof runtime.refreshCapability !== "function") {
		return runtime
	}
	if (current.backend === "none" && current.reason !== "VOICE_DISABLED") {
		return runtime
	}
	const enabled = settings.voiceEnabled === true
	if (current.canCapture !== enabled || current.reason !== (enabled ? "" : "VOICE_DISABLED")) {
		runtime.refreshCapability({
			...current,
			canCapture: enabled,
			reason: enabled ? "" : "VOICE_DISABLED",
			detail: enabled ? "" : "Voice is disabled in settings.",
		})
	}
	return runtime
}

/** The installed extension's absolute path, or `undefined` outside a host. */
export function extensionRoot(): string | undefined {
	try {
		const root = HostProvider.get().extensionFsPath
		return root && root.length > 0 ? root : undefined
	} catch {
		return undefined
	}
}

/** Stable, leak-free error text for the webview: "<CODE>: <message>". */
export function toVoiceErrorText(error: unknown): string {
	if (error instanceof VoiceError) {
		return `${error.code}: ${error.message}`
	}
	if (error instanceof Error) {
		return `VOICE_INTERNAL_ERROR: ${error.message}`
	}
	return "VOICE_INTERNAL_ERROR"
}

/**
 * The stable code part of {@link toVoiceErrorText}. The UI shows codes — a raw
 * message is never used as a state.
 */
export function toVoiceErrorCode(error: unknown): string {
	if (error instanceof VoiceError) {
		return error.code
	}
	return "VOICE_INTERNAL_ERROR"
}

/**
 * Enumerates real capture devices and reports whether a usable microphone is
 * actually present.
 *
 * This is the only metadata call in the Settings surface that can spawn the F1
 * helper, and it happens only when the user asks for it (opening Voice settings
 * or pressing Refresh). The result is metadata — ids, names, states — never audio.
 */
export async function readMicrophoneState(runtime: VoiceRuntime): Promise<{
	available: boolean
	devices: Array<{ id: string; name: string; state: string; isDefault: boolean }>
	errorCode: string
}> {
	const capability = runtime.capability
	if (!capability.canCapture) {
		return { available: false, devices: [], errorCode: capability.reason || "VOICE_DISABLED" }
	}
	try {
		const { devices } = await runtime.coordinator.listDevices()
		const usable = devices.filter((device) => device.state === "active")
		return {
			available: usable.length > 0,
			devices: devices.map((device) => ({
				id: device.id,
				name: device.name,
				state: device.state,
				isDefault: device.isDefault,
			})),
			errorCode: usable.length > 0 ? "" : "NO_CAPTURE_DEVICE",
		}
	} catch (error) {
		return { available: false, devices: [], errorCode: toVoiceErrorCode(error) }
	}
}
