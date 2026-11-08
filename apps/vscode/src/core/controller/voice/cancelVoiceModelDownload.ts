import { type CancelVoiceModelDownloadRequest, EmptyResponse, VoiceEvent } from "@shared/proto/bytos/voice"
import type { Controller } from ".."
import { publishVoiceEvent } from "./subscribeToVoiceEvents"
import { assertModelId, getVoiceModelService } from "./VoiceModelService"

/**
 * `cancelVoiceModelDownload` — stops an in-flight transfer.
 *
 * `ModelStore.abort()` removes the `.part` file, so a cancelled download leaves
 * no residue and the row returns to `not-installed`. Calling this when nothing
 * is running is a no-op, never an error.
 */
export async function cancelVoiceModelDownload(
	_controller: Controller,
	request: CancelVoiceModelDownloadRequest,
): Promise<EmptyResponse> {
	const modelId = assertModelId(request.modelId)
	getVoiceModelService().cancelDownload(modelId)
	await publishVoiceEvent(VoiceEvent.create({ kind: "modelStatusChanged", modelId, modelState: "not-installed", code: "" }))
	return EmptyResponse.create()
}
