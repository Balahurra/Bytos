import { EmptyRequest } from "@shared/proto/bytos/common"
import { CaptureDeviceInfo, ListCaptureDevicesResponse } from "@shared/proto/bytos/voice"
import type { Controller } from ".."
import { runtimeFor, toVoiceErrorText } from "./shared"

/**
 * `listCaptureDevices` — device metadata only (names, stable ids, states).
 *
 * Audio-free by construction: the response carries no samples and no path. This
 * is the one call that spawns the helper for enumeration, and only when a
 * consumer explicitly asks.
 */
export async function listCaptureDevices(controller: Controller, _request: EmptyRequest): Promise<ListCaptureDevicesResponse> {
	try {
		const runtime = await runtimeFor(controller)
		if (!runtime.capability.canCapture) {
			return ListCaptureDevicesResponse.create({
				devices: [],
				errorCode: runtime.capability.reason || "VOICE_DISABLED",
			})
		}
		const { devices } = await runtime.coordinator.listDevices()
		return ListCaptureDevicesResponse.create({
			devices: devices.map((device) =>
				CaptureDeviceInfo.create({
					id: device.id,
					name: device.name,
					state: device.state,
					isDefault: device.isDefault,
				}),
			),
			errorCode: "",
		})
	} catch (error) {
		return ListCaptureDevicesResponse.create({ devices: [], errorCode: toVoiceErrorText(error) })
	}
}
