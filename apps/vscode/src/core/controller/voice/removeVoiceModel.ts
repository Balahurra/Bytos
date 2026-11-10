import { EmptyResponse, type RemoveVoiceModelRequest, VoiceEvent } from "@shared/proto/bytos/voice"
import type { Controller } from ".."
import { publishVoiceEvent } from "./subscribeToVoiceEvents"
import { assertModelId, getVoiceModelService } from "./VoiceModelService"

/**
 * `removeVoiceModel` — deletes an installed model file so the user can reclaim
 * the space. Refuses while a transfer is running (cancel it first) rather than
 * leaving an orphaned `.part` file behind.
 */
export async function removeVoiceModel(_controller: Controller, request: RemoveVoiceModelRequest): Promise<EmptyResponse> {
	const modelId = assertModelId(request.modelId)
	await getVoiceModelService().remove(modelId)
	await publishVoiceEvent(VoiceEvent.create({ kind: "modelStatusChanged", modelId, modelState: "not-installed", code: "" }))
	return EmptyResponse.create()
}
