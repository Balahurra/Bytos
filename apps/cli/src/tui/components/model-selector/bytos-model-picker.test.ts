import { describe, expect, it } from "vitest";
import {
	buildFeaturedModelEntries,
	BYTOS_PASS_FREE_SECTION_DESCRIPTION,
	freeTierDescriptionFor,
} from "./bytos-model-entries";

const model = (id: string) => ({ id, name: id, description: "", tags: [] });

describe("bytos model picker entries", () => {
	it("builds Recommended/Free sections for the bytos provider", () => {
		const entries = buildFeaturedModelEntries("bytos", {
			recommended: [model("anthropic/claude-sonnet-5")],
			free: [model("deepseek/deepseek-v4-flash")],
			bytosPass: [model("bytos-pass/glm-5.1")],
		});

		expect(entries).toEqual([
			{
				kind: "model",
				model: model("anthropic/claude-sonnet-5"),
				tier: "recommended",
			},
			{
				kind: "model",
				model: model("deepseek/deepseek-v4-flash"),
				tier: "free",
			},
			{ kind: "browse" },
		]);
	});

	it("builds Subscribed/Free sections for the bytos-pass provider", () => {
		const entries = buildFeaturedModelEntries("bytos-pass", {
			recommended: [model("anthropic/claude-sonnet-5")],
			free: [model("deepseek/deepseek-v4-flash")],
			bytosPass: [model("bytos-pass/glm-5.1"), model("bytos-pass/kimi-k2.6")],
		});

		expect(entries).toEqual([
			{ kind: "model", model: model("bytos-pass/glm-5.1"), tier: "subscribed" },
			{
				kind: "model",
				model: model("bytos-pass/kimi-k2.6"),
				tier: "subscribed",
			},
			{
				kind: "model",
				model: model("deepseek/deepseek-v4-flash"),
				tier: "free",
			},
		]);
	});

	it("adds the browse-all escape when the bytosPass bucket is empty", () => {
		// The fetch fell back to the bundled list (no pass models); the sections
		// alone would leave a subscriber able to pick only free models.
		const entries = buildFeaturedModelEntries("bytos-pass", {
			recommended: [],
			free: [model("deepseek/deepseek-v4-flash")],
			bytosPass: [],
		});

		expect(entries).toEqual([
			{
				kind: "model",
				model: model("deepseek/deepseek-v4-flash"),
				tier: "free",
			},
			{ kind: "browse" },
		]);
	});

	it("attaches the quota explainer only to the BytosPass picker's free section", () => {
		const data = {
			recommended: [model("anthropic/claude-sonnet-5")],
			free: [model("deepseek/deepseek-v4-flash")],
			bytosPass: [model("bytos-pass/glm-5.1")],
		};

		expect(
			freeTierDescriptionFor(buildFeaturedModelEntries("bytos-pass", data)),
		).toBe(BYTOS_PASS_FREE_SECTION_DESCRIPTION);
		expect(
			freeTierDescriptionFor(buildFeaturedModelEntries("bytos", data)),
		).toBe(undefined);
	});
});
