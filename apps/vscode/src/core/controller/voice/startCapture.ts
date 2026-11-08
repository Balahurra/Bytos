import { StartCaptureRequest, StartCaptureResponse, VoiceEvent } from "@shared/proto/bytos/voice"
import type { Controller } from ".."
import { runtimeFor, toVoiceErrorText } from "./shared"
import { publishVoiceEvent } from "./subscribeToVoiceEvents"

/**
 * `startCapture` — opens the microphone through the native helper.
 *
 * Hard rules:
 *  - the request can express no audio (see `voice.proto`), and none is returned;
 *  - capability and recorder-isolation gates are checked before any helper spawn;
 *  - a manual capture-method pin is honoured or refused with a typed error, never
 *    silently downgraded.
 */
export async function startCapture(controller: Controller, request: StartCaptureRequest): Promise<StartCaptureResponse> {
	const runtime = await runtimeFor(controller)
	try {
		// F4: a request that names no device must still honour the microphone the
		// user picked in Settings → Voice. The composer sends `""` for "whatever
		// is configured", and the coordinator only falls back to its own pin when
		// `deviceId` is undefined — an empty string used to override the pin with
		// the system default, so a chosen device was silently ignored.
		const deviceId = request.microphoneId || controller.stateManager.getGlobalSettingsKey("voiceMicrophoneId") || undefined
		const started = await runtime.startCapture({
			deviceId,
			captureMethod: request.captureMethod || "auto",
		})
		await publishVoiceEvent(
			VoiceEvent.create({
				kind: "captureStatus",
				sessionId: started.sessionId,
				captureState: runtime.captureState,
			}),
		)
		return StartCaptureResponse.create({
			sessionId: started.sessionId,
			sampleRate: started.sampleRate,
			channels: started.channels,
			backend: started.backend,
		})
	} catch (error) {
		await publishVoiceEvent(
			VoiceEvent.create({
				kind: "error",
				sessionId: runtime.currentSessionId,
				captureState: runtime.captureState,
				code: toVoiceErrorText(error).split(":")[0],
				message: toVoiceErrorText(error),
			}),
		)
		throw error
	}
}
