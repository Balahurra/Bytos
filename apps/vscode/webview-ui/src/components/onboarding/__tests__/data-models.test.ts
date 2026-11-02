import type { OnboardingModel, OnboardingModelGroup } from "@shared/proto/bytos/state"
import { describe, expect, it } from "vitest"
import {
	BYTOSPASS_GROUP,
	getBytosUIOnboardingGroups,
	getOnboardingGroupDisplayName,
	getRecommendedModelsData,
} from "../data-models"

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
	it("buckets BytosPass models into the bytosPass group", () => {
		const result = getBytosUIOnboardingGroups(
			groupOf([
				model("bytos-pass/glm-5.2", BYTOSPASS_GROUP),
				model("free-model", "free"),
				model("anthropic/claude", "frontier"),
				model("z-ai/glm", "open source"),
			]),
		)

		expect(result.bytosPass).toHaveLength(1)
		expect(result.bytosPass[0].group).toBe(BYTOSPASS_GROUP)
		expect(result.bytosPass[0].models.map((m) => m.id)).toEqual(["bytos-pass/glm-5.2"])
		expect(result.free[0].models.map((m) => m.id)).toEqual(["free-model"])
		expect(result.power.flatMap((g) => g.models.map((m) => m.id))).toEqual(["anthropic/claude", "z-ai/glm"])
	})

	it("does not bucket bytos-pass ids without a BytosPass group label", () => {
		const result = getBytosUIOnboardingGroups(groupOf([model("bytos-pass/glm-5.2", "frontier")]))

		expect(result.bytosPass).toEqual([])
	})

	it("returns an empty bytosPass group when no BytosPass models are present", () => {
		const result = getBytosUIOnboardingGroups(groupOf([model("free-model", "free")]))
		expect(result.bytosPass).toEqual([])
	})
})

describe("getRecommendedModelsData", () => {
	it("includes BytosPass-only responses without depending on feature-flag timing", () => {
		const result = getRecommendedModelsData({
			recommended: [],
			free: [],
			bytosPass: [{ id: "bytos-pass/glm-5.2", name: "GLM 5.1", description: "", tags: [] }],
		})

		expect(result?.bytosPass.map((model) => model.id)).toEqual(["bytos-pass/glm-5.2"])
	})

	it("keeps classic recommended/free responses and BytosPass responses", () => {
		const result = getRecommendedModelsData({
			recommended: [{ id: "anthropic/claude", name: "Claude", description: "", tags: [] }],
			free: [{ id: "free-model", name: "Free", description: "", tags: [] }],
			bytosPass: [{ id: "bytos-pass/glm-5.2", name: "GLM 5.1", description: "", tags: [] }],
		})

		expect(result?.recommended.map((model) => model.id)).toEqual(["anthropic/claude"])
		expect(result?.free.map((model) => model.id)).toEqual(["free-model"])
		expect(result?.bytosPass.map((model) => model.id)).toEqual(["bytos-pass/glm-5.2"])
	})

	it("returns undefined when every recommended bucket is empty", () => {
		const result = getRecommendedModelsData({ recommended: [], free: [], bytosPass: [] })

		expect(result).toBeUndefined()
	})
})

describe("onboarding display labels", () => {
	it("renders the canonical BytosPass group as a user-facing product name", () => {
		expect(getOnboardingGroupDisplayName(BYTOSPASS_GROUP)).toBe("BytosPass")
		expect(getOnboardingGroupDisplayName("frontier")).toBe("frontier")
	})
})
