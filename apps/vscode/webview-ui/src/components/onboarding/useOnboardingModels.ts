import { buildModelInfoNameMap, type ModelInfo, resolveBytosPassModelInfo } from "@shared/api"
import { BYTOS_ONBOARDING_MODELS } from "@shared/bytos/onboarding"
import { EmptyRequest } from "@shared/proto/bytos/common"
import type { BytosRecommendedModel } from "@shared/proto/bytos/models"
import type { OnboardingModel, OnboardingModelGroup } from "@shared/proto/bytos/state"
import { useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderModels } from "@/hooks/useProviderModels"
import { ModelsServiceClient } from "@/services/grpc-client"
import { BYTOSPASS_GROUP, getRecommendedModelsData, type RecommendedModelsData } from "./data-models"

type OnboardingModelsStatus = "loading" | "success" | "empty"

export interface UseOnboardingModelsResult {
	status: OnboardingModelsStatus
	models: OnboardingModelGroup
}

function toOnboardingModel(
	rec: BytosRecommendedModel,
	group: string,
	fallbackBadge: string,
	modelCatalog: Record<string, ModelInfo>,
): OnboardingModel {
	const catalogInfo = modelCatalog[rec.id]
	const tag = rec.tags?.[0] ?? ""
	const badge = tag || fallbackBadge

	return {
		id: rec.id,
		// Names arrive display-ready from the recommended-models RPC
		name: rec.name || rec.id,
		group,
		badge,
		score: 0,
		latency: 0,
		info: catalogInfo
			? {
					contextWindow: catalogInfo.contextWindow ?? 0,
					supportsImages: catalogInfo.supportsImages ?? false,
					supportsPromptCache: catalogInfo.supportsPromptCache ?? false,
					inputPrice: catalogInfo.inputPrice ?? 0,
					outputPrice: catalogInfo.outputPrice ?? 0,
					tiers: catalogInfo.tiers ?? [],
				}
			: undefined,
	}
}

type FetchState = { status: "loading" } | { status: "success"; data: RecommendedModelsData } | { status: "empty" }

export function useOnboardingModels(): UseOnboardingModelsResult {
	const { openRouterModels } = useExtensionState()
	const { models: bytosModels } = useProviderModels("bytos")
	const [fetchState, setFetchState] = useState<FetchState>({ status: "loading" })

	useEffect(() => {
		let cancelled = false

		const refreshRecommendedModels = async () => {
			try {
				const response = await ModelsServiceClient.refreshBytosRecommendedModelsRpc(EmptyRequest.create({}))
				if (!cancelled) {
					const data = getRecommendedModelsData(response)
					if (!data) {
						setFetchState({ status: "empty" })
					} else {
						setFetchState({ status: "success", data })
					}
				}
			} catch {
				if (!cancelled) {
					setFetchState({ status: "empty" })
				}
			}
		}

		refreshRecommendedModels()

		return () => {
			cancelled = true
		}
	}, [])

	// Merge openRouter and bytos models into a single catalog for lookups
	const modelCatalog = useMemo<Record<string, ModelInfo>>(() => {
		return { ...openRouterModels, ...(bytosModels ?? {}) }
	}, [openRouterModels, bytosModels])

	// BytosPass model IDs omit the upstream lab (e.g. "bytos-pass/glm-5.2"), so look up
	// capabilities via the model slug against the OpenRouter catalog, falling back to
	// conservative BytosPass defaults. Mirrors BytosPassProvider's resolution.
	const openRouterModelsByName = useMemo(() => buildModelInfoNameMap(openRouterModels), [openRouterModels])

	return useMemo<UseOnboardingModelsResult>(() => {
		if (fetchState.status !== "success") {
			return { status: fetchState.status, models: { models: BYTOS_ONBOARDING_MODELS } }
		}

		const { data } = fetchState
		const freeModels = data.free.map((rec) => toOnboardingModel(rec, "free", "Free", modelCatalog))
		const frontierModels = data.recommended.map((rec) => toOnboardingModel(rec, "frontier", "", modelCatalog))
		const bytosPassCatalog = Object.fromEntries(
			data.bytosPass.map((rec) => [rec.id, resolveBytosPassModelInfo(rec.id, openRouterModelsByName)]),
		)
		const bytosPassModels = data.bytosPass.map((rec) => toOnboardingModel(rec, BYTOSPASS_GROUP, "", bytosPassCatalog))

		return { status: "success", models: { models: [...bytosPassModels, ...freeModels, ...frontierModels] } }
	}, [fetchState, modelCatalog, openRouterModelsByName])
}
