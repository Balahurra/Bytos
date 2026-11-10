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
	// Only the settings-driven half is recomputed here. If the host itself is
	// unavailable (unsupported platform, remote/web host, missing helper) or a
	// real enumeration found no active microphone, keep that verdict: flipping
	// `voiceEnabled` must never turn a missing device into a working one.
	if (current.reason !== "" && current.reason !== "VOICE_DISABLED") {
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
 * Reasons that describe the host itself rather than the user's settings. When
 * one of these is set, spawning the helper cannot succeed no matter what is
 * plugged in, so the Settings panel must stay honest instead of retrying.
 */
const HOST_UNAVAILABLE_REASONS = new Set([
	"WEB_UI_UNSUPPORTED",
	"REMOTE_HOST_UNSUPPORTED",
	"PLATFORM_NOT_SUPPORTED_IN_F1",
	"CAPTURE_HELPER_MISSING",
	"RECORDER_ISOLATION_UNVERIFIED",
])

/** True when the host cannot enumerate a microphone for a structural reason. */
function isHostVoiceUnavailable(reason: string | undefined): boolean {
	return !!reason && HOST_UNAVAILABLE_REASONS.has(reason)
}

/**
 * Enumerates real capture devices and reports whether a usable microphone is
 * actually present.
 *
 * This is the only metadata call in the Settings surface that can spawn the F1
 * helper, and it happens only when the user asks for it (opening Voice settings
 * or pressing Refresh). The result is metadata — ids, names, states — never audio.
 *
 * F4.1 fix: enumeration is no longer gated on `voiceEnabled` or on a stale
 * `NO_CAPTURE_DEVICE` verdict. Pressing Refresh must find a microphone that was
 * plugged in after install, and the device list must be readable before Voice is
 * switched on. Only structural host reasons skip the spawn.
 */
export async function readMicrophoneState(
	runtime: VoiceRuntime,
	options: { voiceEnabled?: boolean } = {},
): Promise<{
	available: boolean
	devices: Array<{ id: string; name: string; state: string; isDefault: boolean }>
	errorCode: string
}> {
	const capability = runtime.capability
	if (isHostVoiceUnavailable(capability.reason)) {
		return { available: false, devices: [], errorCode: capability.reason }
	}
	try {
		const { devices } = await runtime.coordinator.listDevices()
		const usable = devices.filter((device) => device.state === "active")
		const available = usable.length > 0
		const enabled = options.voiceEnabled ?? capability.canCapture
		// Fold the fresh observation back into the capability object so
		// `startCapture` and the composer see the same reality the panel shows.
		if (typeof runtime.refreshCapability === "function") {
			runtime.refreshCapability({
				...capability,
				canCapture: available && enabled,
				reason: available ? (enabled ? "" : "VOICE_DISABLED") : "NO_CAPTURE_DEVICE",
				detail: available
					? enabled
						? ""
						: "Voice is disabled in settings."
					: "No active microphone was found on this machine.",
				deviceCount: usable.length,
			})
		}
		return {
			available,
			devices: devices.map((device) => ({
				id: device.id,
				name: device.name,
				state: device.state,
				isDefault: device.isDefault,
			})),
			errorCode: available ? "" : "NO_CAPTURE_DEVICE",
		}
	} catch (error) {
		return { available: false, devices: [], errorCode: toVoiceErrorCode(error) }
	}
}
