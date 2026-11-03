import { describe, expect, it } from "vitest"
import {
	ATTACHMENT_FEATURE_FLAGS,
	ATTACHMENT_LIMITS,
	classifyAttachment,
	getAttachmentExtension,
	getAttachmentMimeType,
	isAttachmentFeatureEnabled,
} from "./index"

describe("attachment limits", () => {
	it("keeps the documented current limits in one place", () => {
		expect(ATTACHMENT_LIMITS).toMatchObject({
			maxPerMessage: 20,
			maxFileBytes: 20 * 1000 * 1024,
			maxMediaFileBytes: 200 * 1000 * 1024,
			maxTextBytes: 400 * 1024,
			maxImageDimension: 7500,
			maxImageSourceDimension: 20000,
			maxImageEncodedBytes: 5 * 1024 * 1024,
			maxImageDecodedBytes: 6 * 1024 * 1024,
			maxTotalMediaBytes: 8 * 1024 * 1024,
		})
	})
})

describe("attachment feature flags", () => {
	it("keeps unshipped rollout flags off", () => {
		expect(ATTACHMENT_FEATURE_FLAGS.binary3dConverters).toBe(false)
	})

	it("reports flags through the helper", () => {
		expect(isAttachmentFeatureEnabled("nativePdf")).toBe(true)
		expect(isAttachmentFeatureEnabled("pdfOcr")).toBe(true)
		expect(isAttachmentFeatureEnabled("videoAudio")).toBe(true)
		expect(isAttachmentFeatureEnabled("model3d")).toBe(true)
	})
})

describe("attachment classification", () => {
	it("extracts a lower-case extension from paths", () => {
		expect(getAttachmentExtension("C:\\work\\My File.PDF")).toBe("pdf")
		expect(getAttachmentExtension("/tmp/model.GLB")).toBe("glb")
		expect(getAttachmentExtension("no-extension")).toBe("")
	})

	it("classifies by extension", () => {
		expect(classifyAttachment("notes.md")).toBe("text")
		expect(classifyAttachment("report.pdf")).toBe("document")
		expect(classifyAttachment("photo.jpeg")).toBe("image")
		expect(classifyAttachment("clip.mp4")).toBe("video")
		expect(classifyAttachment("voice.mp3")).toBe("audio")
		expect(classifyAttachment("scene.glb")).toBe("model3d")
	})

	it("lets a MIME type win over an unknown extension", () => {
		expect(classifyAttachment("downloaded-file", "image/png")).toBe("image")
		expect(classifyAttachment("downloaded-file", "application/pdf")).toBe("document")
		expect(classifyAttachment("downloaded-file", "text/plain")).toBe("text")
	})

	it("leaves unknown files unclassified so existing behavior is preserved", () => {
		expect(classifyAttachment("archive.zip")).toBeUndefined()
		expect(classifyAttachment("unknown.bin", "application/octet-stream")).toBeUndefined()
	})

	it("resolves MIME types with a safe fallback", () => {
		expect(getAttachmentMimeType("photo.png")).toBe("image/png")
		expect(getAttachmentMimeType("scan.PDF")).toBe("application/pdf")
		expect(getAttachmentMimeType("archive.zip")).toBe("application/octet-stream")
	})
})
