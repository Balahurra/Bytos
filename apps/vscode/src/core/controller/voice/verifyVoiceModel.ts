import { type VerifyVoiceModelRequest, VoiceEvent, type VoiceModelInfo } from "@shared/proto/bytos/voice"
import type { Controller } from ".."
import { toProtoModel } from "./getVoiceServiceStatus"
import { publishVoiceEvent } from "./subscribeToVoiceEvents"
import { assertModelId, getVoiceModelService } from "./VoiceModelService"

/**
 * `verifyVoiceModel` — re-runs the size + SHA-256 check against the pin.
 *
 * This is what makes "Retry" meaningful after a failed verification: the user
 * asks for the check again, and the row becomes `ready` only if the bytes on
 * disk actually match. An unverified model is never reported as ready.
 */
export async function verifyVoiceModel(_controller: Controller, request: VerifyVoiceModelRequest): Promise<VoiceModelInfo> {
	const modelId = assertModelId(request.modelId)
	const service = getVoiceModelService()
	await publishVoiceEvent(VoiceEvent.create({ kind: "modelStatusChanged", modelId, modelState: "verifying", code: "" }))
	const view = await service.verify(modelId)
	await publishVoiceEvent(
		VoiceEvent.create({
			kind: "modelStatusChanged",
			modelId,
			modelState: view.state,
			progressPercent: view.progressPercent,
			code: view.errorCode,
		}),
	)
	return toProtoModel(view)
}
