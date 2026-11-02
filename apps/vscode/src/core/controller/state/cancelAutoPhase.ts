import { Empty, EmptyRequest } from "@shared/proto/bytos/common"
import type { Controller } from "../index"

export async function cancelAutoPhase(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	await controller.cancelAutoPhase()
	return Empty.create()
}
