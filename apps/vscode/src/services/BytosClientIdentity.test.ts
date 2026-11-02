import { beforeEach, describe, expect, it, vi } from "vitest"

const identityMocks = vi.hoisted(() => ({
	setBytosClientIdentity: vi.fn(),
}))

const hostState = vi.hoisted(() => ({
	hostVersion: {} as {
		platform?: string
		version?: string
		bytosType?: string
		bytosVersion?: string
	},
	hostVersionError: undefined as Error | undefined,
}))

vi.mock("@bytos/shared", () => ({
	setBytosClientIdentity: identityMocks.setBytosClientIdentity,
}))

vi.mock("@/hosts/host-provider", () => ({
	HostProvider: {
		env: {
			getHostVersion: vi.fn(async () => {
				if (hostState.hostVersionError) {
					throw hostState.hostVersionError
				}
				return hostState.hostVersion
			}),
		},
	},
}))

vi.mock("@/shared/services/Logger", () => ({
	Logger: { log: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/registry", () => ({
	ExtensionRegistryInfo: { version: "9.9.9" },
}))

import { registerBytosClientIdentity } from "./BytosClientIdentity"

describe("registerBytosClientIdentity", () => {
	beforeEach(() => {
		identityMocks.setBytosClientIdentity.mockClear()
		hostState.hostVersionError = undefined
		hostState.hostVersion = {
			platform: "Visual Studio Code",
			version: "1.103.0",
			bytosType: "VSCode Extension",
			bytosVersion: "3.40.0",
		}
	})

	it("publishes the host-reported client identity", async () => {
		await registerBytosClientIdentity()

		expect(identityMocks.setBytosClientIdentity).toHaveBeenCalledWith({
			name: "VSCode Extension",
			version: "3.40.0",
			platform: "Visual Studio Code",
			platformVersion: "1.103.0",
		})
	})

	it("falls back to the extension's own identity when the host bridge fails", async () => {
		hostState.hostVersionError = new Error("host bridge unavailable")

		await registerBytosClientIdentity()

		expect(identityMocks.setBytosClientIdentity).toHaveBeenCalledWith({
			name: "VSCode Extension",
			version: "9.9.9",
		})
	})
})
