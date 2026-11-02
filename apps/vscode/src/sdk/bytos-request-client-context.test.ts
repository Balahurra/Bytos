import { beforeEach, describe, expect, it, vi } from "vitest"
import { version as extensionVersion } from "../../package.json"

const mocks = vi.hoisted(() => ({
	getHostVersion: vi.fn(),
	getWorkspacePaths: vi.fn(),
}))

vi.mock("@/hosts/host-provider", () => ({
	HostProvider: {
		env: { getHostVersion: mocks.getHostVersion },
		workspace: { getWorkspacePaths: mocks.getWorkspacePaths },
	},
}))

import { resolveBytosRequestClientContext } from "./bytos-session-factory"

describe("resolveBytosRequestClientContext", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("reports the host's identity", async () => {
		mocks.getHostVersion.mockResolvedValue({
			bytosType: "Bytos for JetBrains",
			bytosVersion: "4.2.0",
			platform: "IntelliJ IDEA",
			version: "2025.3",
		})
		mocks.getWorkspacePaths.mockResolvedValue({ paths: ["/a", "/b"] })

		await expect(resolveBytosRequestClientContext()).resolves.toEqual({
			name: "Bytos for JetBrains",
			version: "4.2.0",
			platform: "IntelliJ IDEA",
			platformVersion: "2025.3",
			isMultiRoot: true,
		})
	})

	it("falls back to the extension's own identity when the host bridge fails", async () => {
		mocks.getHostVersion.mockRejectedValue(new Error("bridge down"))
		mocks.getWorkspacePaths.mockRejectedValue(new Error("bridge down"))

		await expect(resolveBytosRequestClientContext()).resolves.toEqual({
			name: "VSCode Extension",
			version: extensionVersion,
			platform: undefined,
			platformVersion: undefined,
			isMultiRoot: false,
		})
	})
})
