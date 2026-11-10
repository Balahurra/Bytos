import { describe, expect, it } from "vitest";
import { buildFeaturedModelEntries, freeTierDescriptionFor } from "./bytos-model-entries";

const model = (id: string) => ({ id, name: id, description: "", tags: [] });

describe("bytos model picker entries", () => {
	it("builds Recommended/Free sections with a browse-all escape", () => {
		const entries = buildFeaturedModelEntries("bytos", {
			recommended: [model("anthropic/claude-sonnet-5")],
			free: [model("deepseek/deepseek-v4-flash")],
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

	it("does not attach a subscription quota explainer", () => {
		const data = {
			recommended: [model("anthropic/claude-sonnet-5")],
			free: [model("deepseek/deepseek-v4-flash")],
		};

		expect(freeTierDescriptionFor(buildFeaturedModelEntries("bytos", data))).toBe(undefined);
	});
});
