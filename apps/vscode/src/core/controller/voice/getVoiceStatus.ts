import { VoiceError } from "@core/voice"
import { EmptyRequest } from "@shared/proto/bytos/common"
import { VoiceStatus } from "@shared/proto/bytos/voice"
import type { Controller } from ".."
import { runtimeFor, toVoiceErrorText } from "./shared"

/**
 * `getVoiceStatus` — reports the host-owned capability object.
 *
 * HARD RULE: this handler performs ZERO child-process spawns. It reads cached
 * runtime state and returns it; device probing happens only when a user action
 * asks for it (startCapture / listCaptureDevices).
 */
export async function getVoiceStatus(controller: Controller, _request: EmptyRequest): Promise<VoiceStatus> {
	try {
		const runtime = await runtimeFor(controller)
		const capability = runtime.capability
		const snapshot = runtime.snapshot()
		const voiceEnabled = controller.stateManager.getGlobalSettingsKey("voiceEnabled") === true
		return VoiceStatus.create({
			enabled: voiceEnabled,
			canCapture: capability.canCapture,
			backend: capability.backend,
			unavailableReason: capability.reason,
			permissionGranted: capability.permission === "granted",
			deviceCount: capability.deviceCount,
			selectedMicrophoneId: controller.stateManager.getGlobalSettingsKey("voiceMicrophoneId") ?? "",
			captureState: snapshot.state,
			framesReceived: snapshot.framesReceived,
			bytesReceived: snapshot.bytesReceived,
			lastErrorCode: snapshot.lastErrorCode ?? "",
			lastErrorMessage: snapshot.lastErrorMessage ?? (capability.canCapture ? "" : capability.detail),
			activeSessionDurationMs: Math.round(snapshot.durationMs),
			osLabel: capability.osLabel,
		})
	} catch (error) {
		// A status call must never throw: report the code instead.
		const code = error instanceof VoiceError ? error.code : "VOICE_INTERNAL_ERROR"
		return VoiceStatus.create({
			enabled: false,
			canCapture: false,
			backend: "none",
			unavailableReason: code,
			lastErrorCode: code,
			lastErrorMessage: toVoiceErrorText(error),
			osLabel: "",
		})
	}
}
