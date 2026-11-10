import type { OnboardingModel, OnboardingModelGroup } from "@shared/proto/bytos/state"
import { describe, expect, it } from "vitest"
import { getBytosUIOnboardingGroups, getOnboardingGroupDisplayName, getRecommendedModelsData } from "../data-models"

function model(id: string, group: string): OnboardingModel {
	return {
		id,
		name: id,
		group,
		badge: "",
		score: 0,
		latency: 0,
		info: undefined,
	} as OnboardingModel
}

function groupOf(models: OnboardingModel[]): OnboardingModelGroup {
	return { models } as OnboardingModelGroup
}

describe("getBytosUIOnboardingGroups", () => {
	it("buckets free and frontier/open-source models", () => {
		const result = getBytosUIOnboardingGroups(
			groupOf([model("free-model", "free"), model("anthropic/claude", "frontier"), model("z-ai/glm", "open source")]),
		)

		expect(result.free[0].models.map((m) => m.id)).toEqual(["free-model"])
		expect(result.power.flatMap((g) => g.models.map((m) => m.id))).toEqual(["anthropic/claude", "z-ai/glm"])
	})

	it("has no hosted subscription group", () => {
		const result = getBytosUIOnboardingGroups(groupOf([model("free-model", "free")]))
		expect(result).not.toHaveProperty("clinePass")
	})
})

describe("getRecommendedModelsData", () => {
	it("keeps recommended/free responses", () => {
		const result = getRecommendedModelsData({
			recommended: [{ id: "anthropic/claude", name: "Claude", description: "", tags: [] }],
			free: [{ id: "free-model", name: "Free", description: "", tags: [] }],
		})

		expect(result?.recommended.map((model) => model.id)).toEqual(["anthropic/claude"])
		expect(result?.free.map((model) => model.id)).toEqual(["free-model"])
	})

	it("returns undefined when every recommended bucket is empty", () => {
		const result = getRecommendedModelsData({ recommended: [], free: [] })

		expect(result).toBeUndefined()
	})
})

describe("onboarding display labels", () => {
	it("passes group names through", () => {
		expect(getOnboardingGroupDisplayName("frontier")).toBe("frontier")
	})
})
