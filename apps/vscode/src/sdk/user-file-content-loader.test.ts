import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getModelsForProvider = vi.fn()
const getStateManager = vi.fn()
const extractTextFromFile = vi.fn()
const extractVideoFrames = vi.fn()
const transcribeAudio = vi.fn()

vi.mock("@bytos/llms", () => ({
	getModelsForProvider: (...args: unknown[]) => getModelsForProvider(...args),
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: { get: () => getStateManager() },
}))

vi.mock("@/integrations/misc/extract-text", () => ({
	extractTextFromFile: (...args: unknown[]) => extractTextFromFile(...args),
}))

vi.mock("@/integrations/misc/media-attachments", () => ({
	extractVideoFrames: (...args: unknown[]) => extractVideoFrames(...args),
	transcribeAudio: (...args: unknown[]) => transcribeAudio(...args),
	describeMediaToolRequirement: (kind: string) => `missing ${kind} tools`,
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

	it("sends a video as native media when the model advertises video input", async () => {
		getStateManager.mockReturnValue({
			getApiConfiguration: () => ({
				actModeApiProvider: "openai",
				actModeApiModelId: "gpt-5-video",
				actModeOpenAiModelId: "gpt-5-video",
			}),
			getGlobalSettingsKey: () => "act",
		})
		getModelsForProvider.mockResolvedValue({
			"gpt-5-video": { modalities: { input: ["text", "video"], output: ["text"] } },
		})
		const videoPath = join(tempDir, "clip.mp4")
		writeFileSync(videoPath, "fake video")

		const content = await loadUserFileContentForChat(videoPath)

		expect(content).toMatchObject({
			type: "media",
			media: { modality: "video", mediaType: "video/mp4", name: "clip.mp4" },
		})
		expect(extractVideoFrames).not.toHaveBeenCalled()
	})

	it("falls back to sampled video frames when native video is unavailable", async () => {
		getStateManager.mockReturnValue({
			getApiConfiguration: () => ({
				actModeApiProvider: "openai",
				actModeApiModelId: "gpt-5-no-video",
				actModeOpenAiModelId: "gpt-5-no-video",
			}),
			getGlobalSettingsKey: () => "act",
		})
		getModelsForProvider.mockResolvedValue({
			"gpt-5-no-video": { modalities: { input: ["text", "image"], output: ["text"] } },
		})
		extractVideoFrames.mockResolvedValue([
			{ type: "text", text: "[video metadata]" },
			{ type: "image", data: "AAAA", mediaType: "image/jpeg" },
		])
		const videoPath = join(tempDir, "clip.webm")
		writeFileSync(videoPath, "fake video")

		const content = await loadUserFileContentForChat(videoPath)

		expect(Array.isArray(content)).toBe(true)
		expect(content).toEqual([
			{ type: "text", text: "[video metadata]" },
			{ type: "image", data: "AAAA", mediaType: "image/jpeg" },
		])
	})

	it("sends audio as native media when the model advertises audio input", async () => {
		getStateManager.mockReturnValue({
			getApiConfiguration: () => ({
				actModeApiProvider: "openai",
				actModeApiModelId: "gpt-5-audio",
				actModeOpenAiModelId: "gpt-5-audio",
			}),
			getGlobalSettingsKey: () => "act",
		})
		getModelsForProvider.mockResolvedValue({
			"gpt-5-audio": { modalities: { input: ["text", "audio"], output: ["text"] } },
		})
		const audioPath = join(tempDir, "voice.mp3")
		writeFileSync(audioPath, "fake audio")

		const content = await loadUserFileContentForChat(audioPath)

		expect(content).toMatchObject({
			type: "media",
			media: { modality: "audio", mediaType: "audio/mpeg", name: "voice.mp3" },
		})
	})

	it("falls back to a transcript when native audio is unavailable", async () => {
		getStateManager.mockReturnValue({
			getApiConfiguration: () => ({
				actModeApiProvider: "openai",
				actModeApiModelId: "gpt-5-no-audio",
				actModeOpenAiModelId: "gpt-5-no-audio",
			}),
			getGlobalSettingsKey: () => "act",
		})
		getModelsForProvider.mockResolvedValue({
			"gpt-5-no-audio": { modalities: { input: ["text"], output: ["text"] } },
		})
		transcribeAudio.mockResolvedValue("hello from audio")
		const audioPath = join(tempDir, "voice.wav")
		writeFileSync(audioPath, "fake audio")

		await expect(loadUserFileContentForChat(audioPath)).resolves.toBe("[Audio transcript: voice.wav]\nhello from audio")
	})

	it("summarizes text 3D models", async () => {
		const modelPath = join(tempDir, "cube.obj")
		writeFileSync(modelPath, ["v 0 0 0", "v 1 0 0", "v 0 1 0", "f 1 2 3"].join("\n"))

		const content = await loadUserFileContentForChat(modelPath)

		expect(content).toContain("format: OBJ")
		expect(content).toContain("triangles: 1")
	})

	it("rejects binary 3D formats that belong to the converter phase", async () => {
		const modelPath = join(tempDir, "scene.fbx")
		writeFileSync(modelPath, Buffer.from([0, 1, 2, 3]))

		await expect(loadUserFileContentForChat(modelPath)).rejects.toThrow(/not supported yet/i)
	})
})
