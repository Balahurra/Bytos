import { getBytosEnvironmentConfig } from "@bytos/shared";
import { buildBytosClientHeaders } from "../providers/bytos-client-headers";
import type { ModelInfo } from "./types";

export interface BytosRecommendedModelEntry {
	id: string;
	name?: string;
	description?: string;
	tags?: string[];
}

export interface BytosRecommendedModelsPayload {
	recommended?: BytosRecommendedModelEntry[];
	free?: BytosRecommendedModelEntry[];
	bytosCloud?: BytosRecommendedModelEntry[];
}

type ModelCapabilities = Pick<
	ModelInfo,
	| "contextWindow"
	| "maxInputTokens"
	| "maxTokens"
	| "capabilities"
	| "reasoningOptions"
	| "pricing"
>;

const BYTOS_PROVIDER_ID = "bytos";

const BYTOS_MODEL_DEFAULTS = {
	contextWindow: 128_000,
	maxInputTokens: 128_000,
	maxTokens: 8_192,
	capabilities: ["tools", "reasoning", "temperature"],
	pricing: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
	},
} as const satisfies ModelCapabilities;

function findModelBySlug(
	entry: BytosRecommendedModelEntry,
	modelsByName: Record<string, ModelInfo>,
): ModelInfo | undefined {
	const modelSlug = entry.id.split("/").at(-1) ?? entry.id;

	return modelsByName[modelSlug];
}

function buildModelsNameMap(
	openrouterModels: Record<string, ModelInfo>,
): Record<string, ModelInfo> {
	const nameMap: Record<string, ModelInfo> = {};

	for (const model of Object.values(openrouterModels)) {
		const modelSlugWithoutProvider = model.id.split("/").at(-1) ?? model.id;

		nameMap[modelSlugWithoutProvider] = model;
	}

	return nameMap;
}

/**
 * Builds the bytos catalog from the recommended-models payload, borrowing each
 * entry's capabilities from the models.dev catalog. OpenRouter is the source
 * of truth; Vercel AI Gateway is consulted only for entries OpenRouter doesn't
 * list at all, since Bytos's backend also routes Vercel-only models (e.g. free
 * promotions).
 */
export function normalizeBytosRecommendedProviderModels(
	payload: BytosRecommendedModelsPayload,
	providerModels: Record<string, Record<string, ModelInfo>>,
	options: { includeBytosCloudModels?: boolean } = {},
): Record<string, Record<string, ModelInfo>> {
	const bytosModels: Record<string, ModelInfo> = {};
	const openRouterModels = providerModels.openrouter ?? {};
	const openRouterModelsByName = buildModelsNameMap(openRouterModels);
	const vercelModels = providerModels["vercel-ai-gateway"] ?? {};
	const vercelModelsByName = buildModelsNameMap(vercelModels);

	const addBytosModel = (
		entry: BytosRecommendedModelEntry,
		markFree: boolean,
	) => {
		const capabilities =
			openRouterModels[entry.id] ??
			findModelBySlug(entry, openRouterModelsByName) ??
			vercelModels[entry.id] ??
			findModelBySlug(entry, vercelModelsByName) ??
			BYTOS_MODEL_DEFAULTS;
		// The recommended-models endpoint only sends slug-like names (e.g.
		// "deepseek-v4-flash"), so prefer the OpenRouter catalog's display name
		// for every free entry. Without this, the free overlay overwrites the
		// nice OpenRouter names in the merged bytos catalog and the pickers end
		// up rendering raw model ids for the Free section.
		const entryName =
			capabilities.name?.trim() || entry.name?.trim() || entry.id;
		const name =
			markFree && !/\(free\)$/i.test(entryName)
				? `${entryName} (free)`
				: entryName;

		bytosModels[entry.id] = {
			...capabilities,
			name,
			pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			id: entry.id,
			description: entry.description,
		};
	};

	(payload.free ?? []).forEach((entry) => addBytosModel(entry, true));
	if (options.includeBytosCloudModels) {
		(payload.bytosCloud ?? []).forEach((entry) => addBytosModel(entry, false));
	}

	const result: Record<string, Record<string, ModelInfo>> = {};
	if (Object.keys(bytosModels).length > 0) {
		result[BYTOS_PROVIDER_ID] = bytosModels;
	}
	return result;
}

export async function fetchBytosRecommendedModelsPayload(
	fetcher: typeof fetch = fetch,
): Promise<BytosRecommendedModelsPayload> {
	const url = `${getBytosEnvironmentConfig().apiBaseUrl}/api/v1/ai/bytos/recommended-models`;
	const response = await fetcher(url, { headers: buildBytosClientHeaders() });
	if (!response.ok) {
		throw new Error(
			`Failed to load Bytos recommended models from ${url}: HTTP ${response.status}`,
		);
	}

	return (await response.json()) as BytosRecommendedModelsPayload;
}

export async function fetchBytosRecommendedProviderModels(
	fetcher: typeof fetch = fetch,
	providerModels: Record<string, Record<string, ModelInfo>>,
): Promise<Record<string, Record<string, ModelInfo>>> {
	const payload = await fetchBytosRecommendedModelsPayload(fetcher);
	return normalizeBytosRecommendedProviderModels(payload, providerModels);
}
