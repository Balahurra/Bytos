import { CheckpointRestoreRequest } from "@shared/proto/bytos/checkpoints"
import { Empty } from "@shared/proto/bytos/common"
import { BytosCheckpointRestore } from "../../../shared/WebviewMessage"
import { Controller } from ".."

export async function checkpointRestore(controller: Controller, request: CheckpointRestoreRequest): Promise<Empty> {
	const sdkRestoreCheckpoint = (
		controller as Controller & {
			restoreCheckpoint?: (input: { checkpointRunCount: number; restoreType: BytosCheckpointRestore }) => Promise<void>
		}
	).restoreCheckpoint
	if (sdkRestoreCheckpoint) {
		if (request.number) {
			await sdkRestoreCheckpoint.call(controller, {
				checkpointRunCount: Number(request.number),
				restoreType: request.restoreType as BytosCheckpointRestore,
			})
		}
		return Empty.create({})
	}

	return Empty.create({})
}
