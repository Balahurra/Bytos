import { EmptyRequest } from "@shared/proto/bytos/common"
import { VoiceEvent } from "@shared/proto/bytos/voice"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, type StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"

/**
 * `subscribeToVoiceEvents` — status and error events only.
 *
 * Modelled on `subscribeToAddToInput.ts`: a module-level set of streaming
 * handlers, registration with the request registry for cleanup, and a publish
 * that drops handlers which throw. The payload type has no audio field, so this
 * stream cannot carry audio even by accident.
 */

const activeVoiceEventSubscriptions = new Set<StreamingResponseHandler<VoiceEvent>>()

export async function subscribeToVoiceEvents(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<VoiceEvent>,
	requestId?: string,
): Promise<void> {
	activeVoiceEventSubscriptions.add(responseStream)

	const cleanup = () => {
		activeVoiceEventSubscriptions.delete(responseStream)
	}

	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "voiceEvents_subscription" }, responseStream)
	}
}

/** Broadcasts one status/error event to every active subscriber. */
export async function publishVoiceEvent(event: VoiceEvent): Promise<void> {
	const streams = Array.from(activeVoiceEventSubscriptions)
	await Promise.all(
		streams.map(async (responseStream) => {
			try {
				await responseStream(event, false)
			} catch (error) {
				Logger.error("Error sending voice event:", error)
				activeVoiceEventSubscriptions.delete(responseStream)
			}
		}),
	)
}

/** Test-only: clears subscriptions between cases. */
export function resetVoiceEventSubscriptionsForTesting(): void {
	activeVoiceEventSubscriptions.clear()
}

export function activeVoiceEventSubscriptionCount(): number {
	return activeVoiceEventSubscriptions.size
}
