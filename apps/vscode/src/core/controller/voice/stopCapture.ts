import { VoiceError } from "@core/voice"
import { EmptyResponse, StopCaptureRequest, VoiceEvent } from "@shared/proto/bytos/voice"
import type { Controller } from ".."
import { runtimeFor } from "./shared"
import { publishVoiceEvent } from "./subscribeToVoiceEvents"

/**
 * `stopCapture` — ends the capture and keeps the utterance in host memory.
 *
 * The response is EMPTY: the audio is not returned over ProtoBus. F2 consumes
 * the host-held utterance through the runtime, never through an RPC body.
 */
export async function stopCapture(controller: Controller, request: StopCaptureRequest): Promise<EmptyResponse> {
	const runtime = await runtimeFor(controller)
	if (request.sessionId && runtime.currentSessionId && request.sessionId !== runtime.currentSessionId) {
		throw new VoiceError("CAPTURE_SESSION_MISMATCH")
	}
	const result = await runtime.stopCapture({ reason: "stopped" })
	await publishVoiceEvent(
		VoiceEvent.create({
			kind: "captureStopped",
			sessionId: result.sessionId,
			captureState: runtime.captureState,
			durationMs: Math.round(result.durationMs),
			bytesReceived: result.counters.bytes,
			code: result.reason,
		}),
	)
	return EmptyResponse.create()
}
