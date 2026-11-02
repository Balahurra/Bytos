import { describe, expect, it } from "bun:test"
import sinon from "sinon"
import type { Controller } from "../../index"
import { clearOrganizationForBytosPassProviderSelection } from "../handleBytosPassProviderSelection"

describe("clearOrganizationForBytosPassProviderSelection", () => {
	it("does not switch Bytos accounts for the ClinePass compatibility provider", () => {
		const switchAccount = sinon.stub().resolves()
		const controller = {
			accountService: { switchAccount },
		} as unknown as Controller

		clearOrganizationForBytosPassProviderSelection(controller, {
			planModeApiProvider: "bytos-pass",
			actModeApiProvider: "bytos-pass",
		})

		expect(switchAccount.callCount).toBe(0)
	})
})
