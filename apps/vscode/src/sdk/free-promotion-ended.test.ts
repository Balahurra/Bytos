import { describe, expect, it } from "vitest"
import { BytosError, BytosErrorType } from "../services/error/BytosError"
import { reshapeErrorForWebview } from "./message-translator"

// Once a free promotion ends the bytos-free/ model is removed from the catalog
// and the backend answers "model not found". These tests pin the host-side
// detection that turns that answer into the webview's promotion-ended card.
describe("reshapeErrorForWebview - free promotion ended", () => {
	it("stamps the promotion-ended code when a bytos-free model answers model-not-found", () => {
		const payload = reshapeErrorForWebview({ message: "Error 404: Model not found" }, "bytos", "bytos-free/glm-5")

		const parsed = JSON.parse(payload)
		expect(parsed.code).toBe("bytos_free_promotion_ended")
		expect(parsed.modelId).toBe("bytos-free/glm-5")
		expect(parsed.providerId).toBe("bytos")
		expect(parsed.details?.code).toBe("bytos_free_promotion_ended")
	})

	it("keeps the selected provider id, so cline-pass selections stay attributed", () => {
		const payload = reshapeErrorForWebview({ message: "Model not found" }, "cline-pass", "bytos-free/glm-5")

		expect(JSON.parse(payload).providerId).toBe("cline-pass")
	})

	it("round-trips into the webview's BytosFreePromotionEnded classification", () => {
		const payload = reshapeErrorForWebview({ message: "Error 404: Model not found" }, "bytos", "bytos-free/glm-5")

		const bytosError = BytosError.parse(payload)
		expect(bytosError && BytosError.getErrorType(bytosError)).toBe(BytosErrorType.BytosFreePromotionEnded)
	})

	it("leaves model-not-found for a paid model on the generic guidance path", () => {
		const payload = reshapeErrorForWebview({ message: "Model not found" }, "bytos", "deepseek/deepseek-v4-flash")

		expect(payload).toBe(
			"Model not found The model may be retired or unavailable on your account, or the model ID or base URL may be wrong. Check the model ID and base URL in API Configuration settings, or switch to a different model, then retry.",
		)
	})

	it("leaves model-not-found on the generic guidance path when the model id is unknown", () => {
		const payload = reshapeErrorForWebview({ message: "Model not found" }, "bytos")

		expect(payload).toContain("Check the model ID and base URL")
	})

	it("does not touch unrelated errors from a bytos-free model", () => {
		expect(reshapeErrorForWebview({ message: "socket hang up" }, "bytos", "bytos-free/glm-5")).toBe("socket hang up")
	})
})
