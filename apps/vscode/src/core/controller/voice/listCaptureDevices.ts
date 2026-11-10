import { EmptyRequest } from "@shared/proto/bytos/common"
import { CaptureDeviceInfo, ListCaptureDevicesResponse } from "@shared/proto/bytos/voice"
import type { Controller } from ".."
import { readMicrophoneState, runtimeFor, toVoiceErrorText } from "./shared"

/**
 * `listCaptureDevices` — device metadata only (names, stable ids, states).
 *
 * Audio-free by construction: the response carries no samples and no path. This
 * is the one call that spawns the helper for enumeration, and only when a
 * consumer explicitly asks. Like Settings → Refresh, it enumerates even while
 * Voice is switched off, so the user can see what the host can actually record
 * from before turning the feature on.
 */
export async function listCaptureDevices(controller: Controller, _request: EmptyRequest): Promise<ListCaptureDevicesResponse> {
	try {
		const runtime = await runtimeFor(controller)
		const voiceEnabled = controller.stateManager.getGlobalSettingsKey("voiceEnabled") === true
		const state = await readMicrophoneState(runtime, { voiceEnabled })
		return ListCaptureDevicesResponse.create({
			devices: state.devices.map((device) => CaptureDeviceInfo.create(device)),
			errorCode: state.errorCode,
		})
	} catch (error) {
		return ListCaptureDevicesResponse.create({ devices: [], errorCode: toVoiceErrorText(error) })
	}
}
