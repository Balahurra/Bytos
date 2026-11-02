import { type ModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"

/**
 * ClinePass model catalog.
 *
 * This provider deliberately talks to Cline's hosted API, which expects
 * `cline-pass/*` model ids rather than the Bytos catalog's `bytos-pass/*`
 * spelling. Keep this list in one place so the provider page and the Auto
 * Phase Plan phase settings cannot drift apart.
 */
export const CLINE_PASS_MODEL_IDS = [
	"cline-pass/glm-5.3",
	"cline-pass/glm-5.3-flash",
	"cline-pass/deepseek-v4.1-flash",
	"cline-pass/deepseek-v4-pro",
	"cline-pass/qwen3.8-max",
	"cline-pass/qwen3.7-max",
	"cline-pass/qwen3.7-plus",
	"cline-pass/kimi-k3",
	"cline-pass/minimax-m3",
	"cline-pass/mimo-v2.6-pro",
	"cline-pass/mimo-v2.6-flash",
	"cline-pass/mimo-v2.5-pro",
	"cline-pass/mimo-v2.5",
	"cline-pass/muse-spark-1.3-contributor",
] as const

export const CLINE_PASS_DEFAULT_MODEL_ID = "cline-pass/glm-5.3"

export const CLINE_PASS_MODELS: Record<string, ModelInfo> = Object.fromEntries(
	CLINE_PASS_MODEL_IDS.map((modelId) => [
		modelId,
		{
			...openAiModelInfoSafeDefaults,
			name: modelId.replace(/^cline-pass\//, ""),
			maxTokens: 8192,
			contextWindow: 200000,
			supportsImages: true,
			supportsPromptCache: false,
			supportsReasoning: true,
			inputPrice: 0,
			outputPrice: 0,
			cacheReadsPrice: 0,
			cacheWritesPrice: 0,
		},
	]),
)

export function clinePassFallbackModelInfo(modelId: string): ModelInfo {
	return {
		...openAiModelInfoSafeDefaults,
		name: modelId,
		inputPrice: 0,
		outputPrice: 0,
		cacheReadsPrice: 0,
		cacheWritesPrice: 0,
	}
}
