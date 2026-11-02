import { FALLBACK_BYTOS_RECOMMENDED_MODELS, fetchBytosRecommendedModels } from "@bytos/core"
import { BytosEnv } from "@/config"
import { fetch } from "@/shared/net"

interface BytosRecommendedModelData {
	id: string
	name: string
	description: string
	tags: string[]
}

export interface BytosRecommendedModelsData {
	recommended: BytosRecommendedModelData[]
	free: BytosRecommendedModelData[]
	bytosPass?: BytosRecommendedModelData[]
}

const RECOMMENDED_MODELS_CACHE_TTL_MS = 60 * 60 * 1000

let pendingRefresh: Promise<BytosRecommendedModelsData> | null = null
let inMemoryCache: { data: BytosRecommendedModelsData; timestamp: number } | null = null

export async function refreshBytosRecommendedModels(): Promise<BytosRecommendedModelsData> {
	if (inMemoryCache && Date.now() - inMemoryCache.timestamp <= RECOMMENDED_MODELS_CACHE_TTL_MS) {
		return inMemoryCache.data
	}

	if (pendingRefresh) {
		return pendingRefresh
	}

	pendingRefresh = (async () => {
		try {
			return await fetchAndCacheBytosRecommendedModels()
		} finally {
			pendingRefresh = null
		}
	})()

	return pendingRefresh
}

/** The last successfully fetched list, without fetching; undefined before the first success. */
export function getCachedBytosRecommendedModels(): BytosRecommendedModelsData | undefined {
	return inMemoryCache?.data
}

export function resetBytosRecommendedModelsCacheForTests(): void {
	pendingRefresh = null
	inMemoryCache = null
}

function isFallbackRecommendedModels(data: BytosRecommendedModelsData): boolean {
	return JSON.stringify(data) === JSON.stringify(FALLBACK_BYTOS_RECOMMENDED_MODELS)
}

async function fetchAndCacheBytosRecommendedModels(): Promise<BytosRecommendedModelsData> {
	// Delegate the actual HTTP fetch + response normalization + offline fallback
	// to the SDK so the CLI/JetBrains and the extension share one implementation.
	// We pass the proxy-aware fetch (per .bytosrules/network.md) and the
	// extension's configured API base URL. On failure the SDK returns its own
	// fallback list.
	const result = await fetchBytosRecommendedModels({
		baseUrl: BytosEnv.config().apiBaseUrl,
		fetchImpl: fetch,
	})

	// Only pin a populated, non-fallback result in memory for the full TTL; a
	// transient failure (SDK returns a clone of its fallback) should be retried
	// next call.
	if ((result.recommended.length > 0 || result.free.length > 0) && !isFallbackRecommendedModels(result)) {
		inMemoryCache = { data: result, timestamp: Date.now() }
	}
	return result
}
