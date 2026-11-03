/**
 * Central attachment contracts shared by the extension host and the webview.
 *
 * Keep this module free of VS Code / Node imports: the webview bundles it too.
 */

export const ATTACHMENT_LIMITS = {
	/** Maximum number of images + files attached to a single message. */
	maxPerMessage: 20,
	/** Maximum size of a non-image file accepted by the picker/extractor (decimal MB). */
	maxFileBytes: 20 * 1000 * 1024,
	/** Larger source cap for video/audio that is processed with external tools. */
	maxMediaFileBytes: 200 * 1000 * 1024,
	/** Maximum extracted text retained per file before truncation. */
	maxTextBytes: 400 * 1024,
	/** Canonical image dimension limit (UI and SDK). */
	maxImageDimension: 7500,
	/** Hard sanity cap before decoding; larger images are rejected instead of downscaled. */
	maxImageSourceDimension: 20000,
	/** SDK per-image encoded (base64) budget. */
	maxImageEncodedBytes: 5 * 1024 * 1024,
	/** SDK per-image decoded budget. */
	maxImageDecodedBytes: 6 * 1024 * 1024,
	/** SDK total media budget for a single request. */
	maxTotalMediaBytes: 8 * 1024 * 1024,
} as const

export type AttachmentLimit = keyof typeof ATTACHMENT_LIMITS

export type AttachmentFeature = "imageNormalization" | "nativePdf" | "pdfOcr" | "videoAudio" | "model3d" | "binary3dConverters"

/**
 * Rollout switches for attachment work. Everything defaults to off so the
 * current text/image/PDF behavior is unchanged until a phase explicitly
 * enables its feature.
 */
export const ATTACHMENT_FEATURE_FLAGS: Record<AttachmentFeature, boolean> = {
	imageNormalization: true,
	nativePdf: true,
	pdfOcr: true,
	videoAudio: true,
	model3d: true,
	binary3dConverters: false,
}

export function isAttachmentFeatureEnabled(feature: AttachmentFeature): boolean {
	return ATTACHMENT_FEATURE_FLAGS[feature] === true
}

export type AttachmentKind = "text" | "image" | "document" | "video" | "audio" | "model3d"

/**
 * Extension → kind map used for classification and future routing. Adding an
 * extension here does not make it selectable until the picker/extractor
 * allowlists are updated in the phase that owns that format.
 */
export const ATTACHMENT_KIND_BY_EXTENSION: Readonly<Record<string, AttachmentKind>> = {
	// Text / source
	txt: "text",
	log: "text",
	md: "text",
	mdx: "text",
	json: "text",
	jsonc: "text",
	xml: "text",
	csv: "text",
	tsv: "text",
	yaml: "text",
	yml: "text",
	toml: "text",
	ini: "text",
	html: "text",
	css: "text",
	scss: "text",
	sql: "text",
	ts: "text",
	tsx: "text",
	js: "text",
	jsx: "text",
	py: "text",
	go: "text",
	rs: "text",
	java: "text",
	kt: "text",
	c: "text",
	h: "text",
	cpp: "text",
	cc: "text",
	hpp: "text",
	cs: "text",
	rb: "text",
	php: "text",
	sh: "text",
	bash: "text",
	ps1: "text",
	env: "text",
	gitignore: "text",
	dockerfile: "text",
	// Documents
	pdf: "document",
	docx: "document",
	xlsx: "document",
	ipynb: "document",
	// Images
	png: "image",
	jpg: "image",
	jpeg: "image",
	webp: "image",
	gif: "image",
	bmp: "image",
	tif: "image",
	tiff: "image",
	avif: "image",
	heic: "image",
	heif: "image",
	ico: "image",
	svg: "image",
	// Video
	mp4: "video",
	m4v: "video",
	webm: "video",
	mov: "video",
	// Audio
	mp3: "audio",
	wav: "audio",
	m4a: "audio",
	ogg: "audio",
	flac: "audio",
	// 3D / CAD
	glb: "model3d",
	gltf: "model3d",
	obj: "model3d",
	mtl: "model3d",
	stl: "model3d",
	ply: "model3d",
	fbx: "model3d",
	blend: "model3d",
	dae: "model3d",
	"3ds": "model3d",
	dwg: "model3d",
	dxf: "model3d",
	step: "model3d",
	stp: "model3d",
	iges: "model3d",
	igs: "model3d",
	bvh: "model3d",
}

export const ATTACHMENT_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	bmp: "image/bmp",
	tif: "image/tiff",
	tiff: "image/tiff",
	avif: "image/avif",
	heic: "image/heic",
	heif: "image/heif",
	ico: "image/x-icon",
	svg: "image/svg+xml",
	pdf: "application/pdf",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	ipynb: "application/x-ipynb+json",
	mp4: "video/mp4",
	m4v: "video/x-m4v",
	webm: "video/webm",
	mov: "video/quicktime",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	m4a: "audio/mp4",
	ogg: "audio/ogg",
	flac: "audio/flac",
	glb: "model/gltf-binary",
	gltf: "model/gltf+json",
	obj: "model/obj",
	stl: "model/stl",
	ply: "model/ply",
	fbx: "application/octet-stream",
	blend: "application/x-blender",
	dwg: "image/vnd.dwg",
	dxf: "image/vnd.dxf",
}

/** Lower-case extension without the dot, or "" when there is none. */
export function getAttachmentExtension(nameOrPath: string): string {
	const base = getAttachmentFileName(nameOrPath)
	const dot = base.lastIndexOf(".")
	return dot > 0 ? base.slice(dot + 1).toLowerCase() : ""
}

/** File name (last path segment) with both slash styles normalized. */
export function getAttachmentFileName(nameOrPath: string): string {
	return nameOrPath.replace(/\\/g, "/").split("/").pop() ?? nameOrPath
}

/**
 * Resolve an attachment kind from its MIME type first, then its extension.
 * Unknown files stay undefined so callers can keep their existing behavior.
 */
export function classifyAttachment(nameOrPath: string, mimeType?: string): AttachmentKind | undefined {
	const normalizedMime = mimeType?.trim().toLowerCase()
	if (normalizedMime) {
		if (normalizedMime.startsWith("image/")) return "image"
		if (normalizedMime.startsWith("video/")) return "video"
		if (normalizedMime.startsWith("audio/")) return "audio"
		if (normalizedMime === "application/pdf") return "document"
		if (normalizedMime.startsWith("text/")) return "text"
	}

	return ATTACHMENT_KIND_BY_EXTENSION[getAttachmentExtension(nameOrPath)]
}

/** MIME type for a path, falling back to application/octet-stream. */
export function getAttachmentMimeType(nameOrPath: string): string {
	return ATTACHMENT_MIME_BY_EXTENSION[getAttachmentExtension(nameOrPath)] ?? "application/octet-stream"
}

/**
 * Transport-neutral attachment descriptor used by the additive chat
 * protocol. It intentionally mirrors the proto `ChatAttachment` fields without
 * importing generated code into the shared UI bundle.
 */
export interface ChatAttachmentDescriptor {
	kind: AttachmentKind
	name: string
	mimeType?: string
	path?: string
	data?: string
	size?: number
}

function getDataUrlMimeType(dataUrl: string): string | undefined {
	const match = /^data:([^;,]+)[;,]/.exec(dataUrl)
	return match?.[1]?.toLowerCase()
}

function getDataUrlPayloadLength(dataUrl: string): number {
	const comma = dataUrl.indexOf(",")
	return comma < 0 ? 0 : dataUrl.length - comma - 1
}

/**
 * Build the typed attachment list for a chat message. The webview still sends
 * the legacy images/files arrays during the compatibility window; this list is
 * the forward-compatible representation.
 */
export function buildChatAttachments(images: readonly string[], files: readonly string[]): ChatAttachmentDescriptor[] {
	const attachments: ChatAttachmentDescriptor[] = images.map((dataUrl, index) => {
		const mimeType = getDataUrlMimeType(dataUrl)
		const extension = mimeType?.split("/")[1]?.replace("+xml", "") ?? "png"
		return {
			kind: "image",
			name: `image-${index + 1}.${extension}`,
			mimeType,
			data: dataUrl,
			size: getDataUrlPayloadLength(dataUrl),
		}
	})

	for (const filePath of files) {
		const name = getAttachmentFileName(filePath)
		attachments.push({
			kind: classifyAttachment(filePath) ?? "text",
			name,
			mimeType: getAttachmentMimeType(filePath),
			path: filePath,
		})
	}

	return attachments
}
