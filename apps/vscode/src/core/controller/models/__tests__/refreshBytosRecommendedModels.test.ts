import * as sdkCore from "@bytos/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BytosEnv } from "@/config"
import { refreshBytosRecommendedModels, resetBytosRecommendedModelsCacheForTests } from "../refreshBytosRecommendedModels"

// The HTTP fetch + normalization + offline fallback lives in the SDK
// (`@bytos/core` `fetchBytosRecommendedModels`). These tests cover the
// extension-side wrapper: delegation to the SDK and in-memory caching. There is
// intentionally no feature-flag gate here; onboarding must not race against the
// remote-config cache and accidentally keep the hardcoded fallback list.

describe("refreshBytosRecommendedModels", () => {
	beforeEach(() => {
		resetBytosRecommendedModelsCacheForTests()
		// BytosEnv is not initialized in the unit-test environment; the wrapper
		// passes its apiBaseUrl to the SDK, so provide a stable stub.
		vi.spyOn(BytosEnv, "config").mockReturnValue({ apiBaseUrl: "https://api.bytos-test.bot" } as ReturnType<
			typeof BytosEnv.config
		>)
	})

	afterEach(() => {
		resetBytosRecommendedModelsCacheForTests()
		vi.restoreAllMocks()
	})

	it("delegates to the SDK fetch", async () => {
		const sdkResult = {
			recommended: [{ id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", description: "Remote", tags: ["NEW"] }],
			free: [{ id: "bytos-free/glm-5", name: "GLM 5", description: "Remote free", tags: [] }],
			clinePass: [],
		}
		const sdkSpy = vi.spyOn(sdkCore, "fetchBytosRecommendedModels").mockResolvedValue(sdkResult)

		const result = await refreshBytosRecommendedModels()

		expect(sdkSpy).toHaveBeenCalledTimes(1)
		expect(result).toEqual(sdkResult)
	})

	it("uses the in-memory cache after a populated upstream result", async () => {
		const sdkResult = {
			recommended: [{ id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", description: "Remote", tags: ["NEW"] }],
			free: [],
			clinePass: [],
		}
		const sdkSpy = vi.spyOn(sdkCore, "fetchBytosRecommendedModels").mockResolvedValue(sdkResult)

		const firstResult = await refreshBytosRecommendedModels()
		const secondResult = await refreshBytosRecommendedModels()

		expect(sdkSpy).toHaveBeenCalledTimes(1)
		expect(secondResult).toEqual(firstResult)
	})

	it("does not cache the SDK fallback result", async () => {
		const sdkFallbackClone = structuredClone(sdkCore.FALLBACK_BYTOS_RECOMMENDED_MODELS)
		const sdkSpy = vi
			.spyOn(sdkCore, "fetchBytosRecommendedModels")
			.mockResolvedValueOnce(sdkFallbackClone)
			.mockResolvedValueOnce({
				recommended: [
					{ id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", description: "Remote", tags: ["NEW"] },
				],
				free: [],
			})

		const firstResult = await refreshBytosRecommendedModels()
		const secondResult = await refreshBytosRecommendedModels()

		expect(sdkSpy).toHaveBeenCalledTimes(2)
		expect(firstResult).toEqual(sdkCore.FALLBACK_BYTOS_RECOMMENDED_MODELS)
		expect(secondResult).not.toEqual(sdkCore.FALLBACK_BYTOS_RECOMMENDED_MODELS)
	})
})
