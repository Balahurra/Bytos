import { EmptyRequest } from "@shared/proto/bytos/common"
import { AutoPhasePlan } from "@shared/proto/bytos/state"
import { readAutoPhasePlan } from "@/core/auto-phase/plan-store"
import type { Controller } from "../index"

export async function getAutoPhasePlan(controller: Controller, _request: EmptyRequest): Promise<AutoPhasePlan> {
	return readAutoPhasePlan(controller.stateManager)
}
