import { type DownloadVoiceModelRequest, EmptyResponse } from "@shared/proto/bytos/voice"
import type { Controller } from ".."
import { runConsentedModelDownload } from "./modelDownloadFlow"
import { getVoiceModelService } from "./VoiceModelService"

/**
 * `downloadVoiceModel` — the only path that fetches a speech model.
 *
 * The request carries `consent`, and the host asks again in its own modal with
 * the exact size before a byte is transferred. Either gate refusing means no
 * download starts. Progress is published as percentages through
 * `subscribeToVoiceEvents`; the response itself carries nothing.
 */
export async function downloadVoiceModel(controller: Controller, request: DownloadVoiceModelRequest): Promise<EmptyResponse> {
	const service = getVoiceModelService()
	const started = await runConsentedModelDownload({
		controller,
		modelId: request.modelId,
		consent: request.consent === true,
		service,
	})
	if (started) {
		await controller.postStateToWebview()
	}
	return EmptyResponse.create()
}
