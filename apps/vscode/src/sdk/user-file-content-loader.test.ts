import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getModelsForProvider = vi.fn()
const getStateManager = vi.fn()
const extractTextFromFile = vi.fn()

vi.mock("@bytos/llms", () => ({
	getModelsForProvider: (...args: unknown[]) => getModelsForProvider(...args),
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: { get: () => getStateManager() },
}))

vi.mock("@/integrations/misc/extract-text", () => ({
	extractTextFromFile: (...args: unknown[]) => extractTextFromFile(...args),
}))

import { loadUserFileContentForChat } from "./user-file-content-loader"

describe("loadUserFileContentForChat", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "bytos-user-file-"))
		getStateManager.mockReturnValue({
			getApiConfiguration: () => ({
				actModeApiProvider: "openai",
				actModeApiModelId: "gpt-5-pdf",
				actModeOpenAiModelId: "gpt-5-pdf",
			}),
			getGlobalSettingsKey: () => "act",
		})
		extractTextFromFile.mockResolvedValue("fallback text")
	})

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true })
		vi.clearAllMocks()
	})

	it("sends a PDF as native media when the model advertises PDF input", async () => {
		getModelsForProvider.mockResolvedValue({
			"gpt-5-pdf": { modalities: { input: ["text", "pdf"], output: ["text"] } },
		})
		const pdfPath = join(tempDir, "report.pdf")
		writeFileSync(pdfPath, "%PDF-1.4\nfake pdf bytes")

		const content = await loadUserFileContentForChat(pdfPath)

		expect(content).toMatchObject({
			type: "media",
			media: {
				modality: "file",
				mediaType: "application/pdf",
				name: "report.pdf",
				source: { type: "base64" },
			},
		})
		expect(extractTextFromFile).not.toHaveBeenCalled()
	})

	it("falls back to text extraction when the model does not accept PDFs", async () => {
		getStateManager.mockReturnValue({
			getApiConfiguration: () => ({
				actModeApiProvider: "openai",
				actModeApiModelId: "gpt-5-text",
				actModeOpenAiModelId: "gpt-5-text",
			}),
			getGlobalSettingsKey: () => "act",
		})
		getModelsForProvider.mockResolvedValue({
			"gpt-5-text": { modalities: { input: ["text", "image"], output: ["text"] } },
		})
		const pdfPath = join(tempDir, "report.pdf")
		writeFileSync(pdfPath, "%PDF-1.4\nfake pdf bytes")

		await expect(loadUserFileContentForChat(pdfPath)).resolves.toBe("fallback text")
		expect(extractTextFromFile).toHaveBeenCalledWith(pdfPath)
	})

	it("uses text extraction for non-PDF files", async () => {
		const textPath = join(tempDir, "notes.md")
		writeFileSync(textPath, "# notes")

		await expect(loadUserFileContentForChat(textPath)).resolves.toBe("fallback text")
		expect(getModelsForProvider).not.toHaveBeenCalled()
	})
})
