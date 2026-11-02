import { describe, expect, it, vi } from "vitest"

vi.mock("@/services/grpc-client", () => ({
	UiServiceClient: {
		openUrl: vi.fn(() => Promise.resolve({})),
	},
}))

import { buildBytosPassSubscribeUrl, buildBytosPassSubscriptionPageUrl } from "../bytosPassSubscribe"

describe("BytosPass subscription URLs", () => {
	it("falls back to the default app base URL", () => {
		expect(buildBytosPassSubscribeUrl(undefined)).toBe("https://app.bytos.dev/onboarding/individual-plan")
		expect(buildBytosPassSubscriptionPageUrl(undefined)).toBe("https://app.bytos.dev/dashboard/subscription?personal=true")
	})

	it("preserves a path-prefixed app base URL", () => {
		expect(buildBytosPassSubscribeUrl("https://proxy.example.com/bytos")).toBe(
			"https://proxy.example.com/bytos/onboarding/individual-plan",
		)
		expect(buildBytosPassSubscriptionPageUrl("https://proxy.example.com/bytos")).toBe(
			"https://proxy.example.com/bytos/dashboard/subscription?personal=true",
		)
	})

	it("trims trailing slashes from the base URL", () => {
		expect(buildBytosPassSubscribeUrl("https://app.bytos.dev/")).toBe("https://app.bytos.dev/onboarding/individual-plan")
	})
})
