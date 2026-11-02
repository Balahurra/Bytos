import { EmptyRequest } from "@shared/proto/bytos/common"
import { BytosRecommendedModel, BytosRecommendedModelsResponse } from "@shared/proto/bytos/models"
import type { Controller } from "../index"
import { refreshBytosRecommendedModels } from "./refreshBytosRecommendedModels"

export async function refreshBytosRecommendedModelsRpc(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<BytosRecommendedModelsResponse> {
	const models = await refreshBytosRecommendedModels()
	return BytosRecommendedModelsResponse.create({
		recommended: models.recommended.map((model) =>
			BytosRecommendedModel.create({
				id: model.id,
				name: model.name,
				description: model.description,
				tags: model.tags,
			}),
		),
		free: models.free.map((model) =>
			BytosRecommendedModel.create({
				id: model.id,
				name: model.name,
				description: model.description,
				tags: model.tags,
			}),
		),
		bytosPass: (models.bytosPass ?? []).map((model) =>
			BytosRecommendedModel.create({
				id: model.id,
				name: model.name,
				description: model.description,
				tags: model.tags,
			}),
		),
	})
}
