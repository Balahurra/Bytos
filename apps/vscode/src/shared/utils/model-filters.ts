import type { ApiProvider } from "@shared/api"

function normalizeModelId(modelId: string): string {
	return modelId.trim().toLowerCase()
}

const BYTOS_FREE_MODEL_EXCEPTIONS = ["minimax-m2", "devstral-2512", "arcee-ai/trinity-large"]

function isBytosFreeModelException(modelId: string): boolean {
	const normalizedModelId = normalizeModelId(modelId)
	return BYTOS_FREE_MODEL_EXCEPTIONS.some((token) => normalizedModelId.includes(token))
}

/**
 * Filters OpenRouter model IDs based on provider-specific rules.
 * For Bytos provider: excludes :free models (except known exception models)
 * For OpenRouter/Vercel: excludes bytos/ prefixed models
 * @param modelIds Array of model IDs to filter
 * @param provider The current API provider
 * @param allowedFreeModelIds Optional list of Bytos free model IDs to keep visible
 * @returns Filtered array of model IDs
 */
export function filterOpenRouterModelIds(
	modelIds: string[],
	provider: ApiProvider,
	allowedFreeModelIds: string[] = [],
): string[] {
	if (provider === "bytos") {
		const allowedFreeIdSet = new Set(allowedFreeModelIds.map((id) => normalizeModelId(id)))
		// For Bytos provider: exclude :free models, but keep known exception models
		return modelIds.filter((id) => {
			const normalizedModelId = normalizeModelId(id)
			if (allowedFreeIdSet.has(normalizedModelId)) {
				return true
			}
			if (isBytosFreeModelException(normalizedModelId)) {
				return true
			}
			// Filter out other :free models
			return !normalizedModelId.includes(":free")
		})
	}

	// For OpenRouter and Vercel AI Gateway providers: exclude Bytos-specific models
	return modelIds.filter((id) => !id.startsWith("bytos/"))
}
