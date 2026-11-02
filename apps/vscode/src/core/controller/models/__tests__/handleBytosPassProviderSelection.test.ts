import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import sinon from "sinon"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../../index"
import { clearOrganizationForBytosPassProviderSelection } from "../handleBytosPassProviderSelection"

/** Let the fire-and-forget switchAccount promise chain settle. */
function flushMicrotasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve))
}

describe("clearOrganizationForBytosPassProviderSelection", () => {
	let sandbox: sinon.SinonSandbox
	let switchAccount: sinon.SinonStub

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		switchAccount = sandbox.stub().resolves()
		sandbox.stub(Logger, "debug")
	})

	afterEach(() => {
		sandbox.restore()
	})

	function createController(): Controller {
		return {
			accountService: { switchAccount },
		} as unknown as Controller
	}

	it("does nothing when BytosPass is not selected", () => {
		clearOrganizationForBytosPassProviderSelection(createController(), {
			planModeApiProvider: "bytos",
			actModeApiProvider: "openrouter",
		})

		expect(switchAccount.callCount).toBe(0)
	})

	it("switches to the personal account when BytosPass is selected without blocking the caller", () => {
		clearOrganizationForBytosPassProviderSelection(createController(), {
			planModeApiProvider: "bytos-pass",
			actModeApiProvider: "openrouter",
		})

		expect(switchAccount.callCount).toBe(1)
		expect(switchAccount.firstCall.args[0]).toBeUndefined()
	})

	it("logs and swallows account switch failures", async () => {
		const error = new Error("not signed in")
		switchAccount.rejects(error)

		clearOrganizationForBytosPassProviderSelection(createController(), {
			planModeApiProvider: "bytos",
			actModeApiProvider: "bytos-pass",
		})
		await flushMicrotasks()

		expect(switchAccount.callCount).toBe(1)
		expect(switchAccount.firstCall.args[0]).toBeUndefined()
		expect((Logger.debug as sinon.SinonStub).calledOnce).toBe(true)
	})
})
