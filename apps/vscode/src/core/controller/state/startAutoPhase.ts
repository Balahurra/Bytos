import { EmptyRequest, String } from "@shared/proto/bytos/common"
import type { Controller } from "../index"

export async function startAutoPhase(controller: Controller, _request: EmptyRequest): Promise<String> {
	await controller.startAutoPhase()
	return String.create({ value: "" })
}
