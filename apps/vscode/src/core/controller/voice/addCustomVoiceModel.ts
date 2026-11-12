import { VoiceError } from "@core/voice"
import { AddCustomVoiceModelRequest, VoiceEvent, type VoiceModelInfo } from "@shared/proto/bytos/voice"
import type { Controller } from ".."
import { toProtoModel } from "./getVoiceServiceStatus"
import { takeSelectedModelFile } from "./selectedVoiceModelFiles"
import { publishVoiceEvent } from "./subscribeToVoiceEvents"
import { getVoiceModelService } from "./VoiceModelService"

/**
 * `addCustomVoiceModel` — registers a user-supplied whisper.cpp model.
 *
 * The request carries a display name and the one-use token produced by
 * `selectVoiceModelFile`; the path itself stays in host memory. The host copies
 * the file into its own model directory, computes the exact SHA-256 of the
 * copied bytes, and only then reports the model as ready. Paths and audio never
 * come back to the webview.
 */
export async function addCustomVoiceModel(_controller: Controller, request: AddCustomVoiceModelRequest): Promise<VoiceModelInfo> {
	const sourcePath = takeSelectedModelFile(request.selectionToken)
	if (!sourcePath) {
		throw new VoiceError("MODEL_NOT_INSTALLED", "The selected model file is no longer available. Choose it again.")
	}
	const service = getVoiceModelService()
	const view = await service.addCustomModel({
		displayName: request.displayName,
		sourcePath,
	})
	await publishVoiceEvent(
		VoiceEvent.create({
			kind: "modelStatusChanged",
			modelId: view.id,
			modelState: view.state,
			progressPercent: view.progressPercent,
			code: view.errorCode,
		}),
	)
	return toProtoModel(view)
}
