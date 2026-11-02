import { Empty } from "@shared/proto/bytos/common"
import { AutoPhasePlan } from "@shared/proto/bytos/state"
import { saveAutoPhasePlan as saveAutoPhasePlanStore } from "@/core/auto-phase/plan-store"
import type { Controller } from "../index"

export async function saveAutoPhasePlan(controller: Controller, request: AutoPhasePlan): Promise<Empty> {
	saveAutoPhasePlanStore(controller.stateManager, request)
	return Empty.create()
}
