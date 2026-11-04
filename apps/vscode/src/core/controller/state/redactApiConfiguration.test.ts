import { describe, expect, it } from "vitest"
import { createSecretMask, isSecretMaskOnly } from "@/shared/storage/secret-mask"
import { redactApiConfigurationForWebview } from "./redactApiConfiguration"

describe("redactApiConfigurationForWebview", () => {
	it("replaces every secret with a mask and keeps non-secret configuration", () => {
		const redacted = redactApiConfigurationForWebview({
			apiKey: "sk-ant-secret",
			openRouterApiKey: "sk-or-secret",
			planModeApiProvider: "anthropic",
			planModeApiModelId: "claude-sonnet-5",
		} as never)

		expect(redacted?.apiKey).toBe(createSecretMask("sk-ant-secret".length))
		expect(redacted?.openRouterApiKey).toBe(createSecretMask("sk-or-secret".length))
		expect(redacted?.apiKey).not.toContain("secret")
		expect(redacted?.planModeApiProvider).toBe("anthropic")
		expect(redacted?.planModeApiModelId).toBe("claude-sonnet-5")
		expect(isSecretMaskOnly(redacted?.apiKey)).toBe(true)
	})

	it("leaves an absent configuration absent", () => {
		expect(redactApiConfigurationForWebview(undefined)).toBeUndefined()
	})
})
