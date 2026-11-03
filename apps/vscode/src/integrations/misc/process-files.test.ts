import { beforeEach, describe, expect, it, vi } from "vitest"

const showOpenDialogue = vi.fn()
const showMessage = vi.fn()

vi.mock("@/hosts/host-provider", () => ({
	HostProvider: {
		window: {
			showOpenDialogue: (...args: unknown[]) => showOpenDialogue(...args),
			showMessage: (...args: unknown[]) => showMessage(...args),
		},
	},
}))

import { selectFiles } from "./process-files"

function filterExtensions(callIndex = 0): string[] {
	const request = showOpenDialogue.mock.calls[callIndex]?.[0] as { filters?: { files?: string[] } } | undefined
	return request?.filters?.files ?? []
}

describe("selectFiles", () => {
	beforeEach(() => {
		showOpenDialogue.mockReset()
		showOpenDialogue.mockResolvedValue({ paths: [] })
	})

	it("limits cloud (imagesOnly) selection to images", async () => {
		await selectFiles(true, true)

		const extensions = filterExtensions()
		expect(extensions).toContain("png")
		expect(extensions).toContain("gif")
		expect(extensions).not.toContain("pdf")
		expect(extensions).not.toContain("mp4")
		expect(extensions).not.toContain("glb")
	})

	it("offers the full supported set for local sessions", async () => {
		await selectFiles(true, false)

		const extensions = filterExtensions()
		expect(extensions).toContain("png")
		expect(extensions).toContain("pdf")
		expect(extensions).toContain("mp4")
		expect(extensions).toContain("glb")
		expect(extensions).toContain("ts")
	})

	it("omits images when the model does not support them", async () => {
		await selectFiles(false, false)

		const extensions = filterExtensions()
		expect(extensions).not.toContain("png")
		expect(extensions).toContain("pdf")
	})
})
