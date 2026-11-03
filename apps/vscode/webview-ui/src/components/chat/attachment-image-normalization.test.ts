import { describe, expect, it } from "vitest"
import { getDataUrlBase64Length, getDataUrlMimeType, isBrowserDecodableImageMime } from "./attachment-image-normalization"

describe("attachment image normalization helpers", () => {
	it("reads the MIME type from a data URL", () => {
		expect(getDataUrlMimeType("data:image/png;base64,AAAA")).toBe("image/png")
		expect(getDataUrlMimeType("data:image/svg+xml;base64,AAAA")).toBe("image/svg+xml")
		expect(getDataUrlMimeType("not-a-data-url")).toBe("")
	})

	it("returns the base64 payload length used by the SDK budget", () => {
		expect(getDataUrlBase64Length("data:image/png;base64,AAAA")).toBe(4)
		expect(getDataUrlBase64Length("data:image/png;base64,")).toBe(0)
		expect(getDataUrlBase64Length("not-a-data-url")).toBe(0)
	})

	it("recognizes the browser-decodable image formats", () => {
		for (const mime of ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/svg+xml", "image/avif"]) {
			expect(isBrowserDecodableImageMime(mime)).toBe(true)
		}
		expect(isBrowserDecodableImageMime("image/tiff")).toBe(false)
		expect(isBrowserDecodableImageMime("image/heic")).toBe(false)
	})
})
