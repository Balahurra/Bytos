import { ATTACHMENT_LIMITS } from "@shared/attachments"

/**
 * Browser-side image normalization for chat attachments.
 *
 * The extension host only inspects dimensions; the webview already has a
 * Chromium image decoder and canvas. Doing conversion here avoids shipping a
 * native image codec with the extension while still guaranteeing that the
 * model receives a supported image type inside the SDK media budget.
 */

const BROWSER_DECODABLE_IMAGE_MIME = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
	"image/bmp",
	"image/svg+xml",
	"image/avif",
])

/** Formats that can be forwarded as-is when they are already within budget. */
const PASSTHROUGH_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])

export interface NormalizedImage {
	dataUrl: string
	width: number
	height: number
	encodedBytes: number
	/** True when the bytes were re-encoded or rasterized. */
	converted: boolean
	/** True when the pixel dimensions were reduced. */
	resized: boolean
}

export function getDataUrlMimeType(dataUrl: string): string {
	const match = /^data:([^;,]+)[;,]/.exec(dataUrl)
	return match?.[1]?.toLowerCase() ?? ""
}

export function getDataUrlBase64Length(dataUrl: string): number {
	const comma = dataUrl.indexOf(",")
	return comma < 0 ? 0 : dataUrl.length - comma - 1
}

export function isBrowserDecodableImageMime(mimeType: string): boolean {
	return BROWSER_DECODABLE_IMAGE_MIME.has(mimeType.toLowerCase())
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image()
		image.onload = () => resolve(image)
		image.onerror = () => reject(new Error("Could not decode this image. Convert it to PNG, JPEG or WEBP first."))
		image.src = dataUrl
	})
}

export interface NormalizeImageOptions {
	maxEncodedBytes?: number
	maxDimension?: number
}

/**
 * Normalize one data URL so it fits the per-image SDK budget and dimension
 * limit. Passthrough formats stay byte-identical when they already fit;
 * everything else is rasterized to WEBP (preserving alpha) and progressively
 * downscaled until it fits.
 */
export async function normalizeImageDataUrl(dataUrl: string, options: NormalizeImageOptions = {}): Promise<NormalizedImage> {
	const mimeType = getDataUrlMimeType(dataUrl)
	if (!isBrowserDecodableImageMime(mimeType)) {
		throw new Error(`Unsupported image type${mimeType ? ` (${mimeType})` : ""}. Convert it to PNG, JPEG or WEBP first.`)
	}

	const maxEncodedBytes = options.maxEncodedBytes ?? ATTACHMENT_LIMITS.maxImageEncodedBytes
	const maxDimension = options.maxDimension ?? ATTACHMENT_LIMITS.maxImageDimension
	const encodedBytes = getDataUrlBase64Length(dataUrl)

	const image = await loadImage(dataUrl)
	const originalWidth = image.naturalWidth
	const originalHeight = image.naturalHeight
	if (!originalWidth || !originalHeight) {
		throw new Error("Could not determine image dimensions.")
	}

	const needsResize = originalWidth > maxDimension || originalHeight > maxDimension
	if (PASSTHROUGH_IMAGE_MIME.has(mimeType) && encodedBytes <= maxEncodedBytes && !needsResize) {
		return {
			dataUrl,
			width: originalWidth,
			height: originalHeight,
			encodedBytes,
			converted: false,
			resized: false,
		}
	}

	const scale = needsResize ? Math.min(maxDimension / originalWidth, maxDimension / originalHeight) : 1
	let width = Math.max(1, Math.round(originalWidth * scale))
	let height = Math.max(1, Math.round(originalHeight * scale))
	let quality = 0.9
	let output = ""
	let outputBytes = 0

	for (let attempt = 0; attempt < 8; attempt++) {
		const canvas = document.createElement("canvas")
		canvas.width = width
		canvas.height = height
		const context = canvas.getContext("2d")
		if (!context) {
			throw new Error("Could not prepare an image canvas.")
		}
		context.drawImage(image, 0, 0, width, height)
		output = canvas.toDataURL("image/webp", quality)
		outputBytes = getDataUrlBase64Length(output)
		if (outputBytes <= maxEncodedBytes) {
			break
		}
		if (quality > 0.6) {
			quality = Math.max(0.6, quality - 0.1)
		} else {
			width = Math.max(1, Math.round(width * 0.85))
			height = Math.max(1, Math.round(height * 0.85))
			quality = 0.85
		}
	}

	if (!output || outputBytes > maxEncodedBytes) {
		throw new Error("This image could not be reduced below the model media limit. Resize or compress it first.")
	}

	return {
		dataUrl: output,
		width,
		height,
		encodedBytes: outputBytes,
		converted: true,
		resized: width !== originalWidth || height !== originalHeight,
	}
}

/**
 * Normalize a batch while respecting the remaining total media budget. The
 * budget is shared across all attached images in a message (SDK default 8 MB),
 * so one image can never consume the whole allowance.
 */
export async function normalizeImagesForAttachment(
	dataUrls: readonly string[],
	existingEncodedBytes: number,
	options: NormalizeImageOptions = {},
): Promise<{ images: NormalizedImage[]; skipped: string[] }> {
	const maxTotal = ATTACHMENT_LIMITS.maxTotalMediaBytes
	let remaining = Math.max(0, maxTotal - existingEncodedBytes)
	const images: NormalizedImage[] = []
	const skipped: string[] = []

	for (const dataUrl of dataUrls) {
		if (remaining <= 0) {
			skipped.push("The total image budget for this message is full.")
			break
		}
		try {
			const normalized = await normalizeImageDataUrl(dataUrl, {
				...options,
				maxEncodedBytes: Math.min(options.maxEncodedBytes ?? ATTACHMENT_LIMITS.maxImageEncodedBytes, remaining),
			})
			images.push(normalized)
			remaining -= normalized.encodedBytes
		} catch (error) {
			skipped.push(error instanceof Error ? error.message : "Image could not be processed.")
		}
	}

	return { images, skipped }
}
