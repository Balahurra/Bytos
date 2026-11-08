import { VoiceError } from "@core/voice"
import { CancelCaptureRequest, EmptyResponse, VoiceEvent } from "@shared/proto/bytos/voice"
import type { Controller } from ".."
import { runtimeFor } from "./shared"
import { publishVoiceEvent } from "./subscribeToVoiceEvents"

/**
 * `cancelCapture` — aborts the capture, drops the audio and reaps the helper.
 *
 * Cancel must work from every lifecycle state (plan §3 T8): a cancel with no
 * active session is a no-op rather than an error, so a UI can always call it.
 */
export async function cancelCapture(controller: Controller, request: CancelCaptureRequest): Promise<EmptyResponse> {
	const runtime = await runtimeFor(controller)
	if (request.sessionId && runtime.currentSessionId && request.sessionId !== runtime.currentSessionId) {
		throw new VoiceError("CAPTURE_SESSION_MISMATCH")
	}
	await runtime.cancelCapture()
	await publishVoiceEvent(
		VoiceEvent.create({
			kind: "captureStatus",
			sessionId: runtime.currentSessionId,
			captureState: runtime.captureState,
			code: "cancelled",
		}),
	)
	return EmptyResponse.create()
}
