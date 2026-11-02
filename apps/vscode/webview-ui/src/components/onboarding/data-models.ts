import type { BytosRecommendedModel, OpenRouterModelInfo } from "@shared/proto/bytos/models"
import type { OnboardingModel, OnboardingModelGroup } from "@shared/proto/bytos/state"

export const BYTOSPASS_GROUP = "bytos-pass"

export interface RecommendedModelsData {
	recommended: BytosRecommendedModel[]
	free: BytosRecommendedModel[]
	bytosPass: BytosRecommendedModel[]
}

type RecommendedModelsResponseLike = {
	recommended?: BytosRecommendedModel[]
	free?: BytosRecommendedModel[]
	bytosPass?: BytosRecommendedModel[]
}

export function getRecommendedModelsData(response: RecommendedModelsResponseLike): RecommendedModelsData | undefined {
	const recommended = response.recommended ?? []
	const free = response.free ?? []
	const bytosPass = response.bytosPass ?? []

	if (recommended.length === 0 && free.length === 0 && bytosPass.length === 0) {
		return undefined
	}

	return { recommended, free, bytosPass }
}

export interface OnboardingModelsByGroup {
	bytosPass: ModelGroup[]
	free: ModelGroup[]
	power: ModelGroup[]
}

interface ModelGroup {
	group: string
	models: OnboardingModel[]
}

function isBytosPassOnboardingModel(model: OnboardingModel): boolean {
	return model.group === BYTOSPASS_GROUP
}

export function getBytosUIOnboardingGroups(groupedModels: OnboardingModelGroup): OnboardingModelsByGroup {
	const { models } = groupedModels

	const bytosPassModels = models.filter(isBytosPassOnboardingModel)
	const freeModels = models.filter((m) => m.group === "free")
	const frontierModels = models.filter((m) => m.group === "frontier")
	const openSourceModels = models.filter((m) => m.group === "open source")

	return {
		bytosPass: bytosPassModels.length > 0 ? [{ group: BYTOSPASS_GROUP, models: bytosPassModels }] : [],
		free: freeModels.length > 0 ? [{ group: "free", models: freeModels }] : [],
		power: [
			...(frontierModels.length > 0 ? [{ group: "frontier", models: frontierModels }] : []),
			...(openSourceModels.length > 0 ? [{ group: "open source", models: openSourceModels }] : []),
		],
	}
}

export function getOnboardingGroupDisplayName(group: string): string {
	if (group === BYTOSPASS_GROUP) {
		return "BytosPass"
	}
	return group
}

export function getPriceRange(modelInfo: OpenRouterModelInfo): string {
	const prompt = Number(modelInfo.inputPrice ?? 0)
	const completion = Number(modelInfo.outputPrice ?? 0)
	const cost = prompt + completion
	if (cost === 0) {
		return "Free"
	}
	if (cost < 10) {
		return "$"
	}
	if (cost > 50) {
		return "$$$"
	}
	return "$$"
}

export function getCapabilities(modelInfo: OpenRouterModelInfo): string[] {
	const capabilities = new Set<string>()
	if (modelInfo.supportsImages) {
		capabilities.add("Images")
	}
	if (modelInfo.supportsPromptCache) {
		capabilities.add("Prompt Cache")
	}
	capabilities.add("Tools")
	return Array.from(capabilities)
}

export function getSpeedLabel(latency?: number): string {
	if (!latency) {
		return "Average"
	}
	if (latency < 1) {
		return "Instant"
	}
	if (latency < 2) {
		return "Fast"
	}
	if (latency > 5) {
		return "Slow"
	}

	return "Average"
}
