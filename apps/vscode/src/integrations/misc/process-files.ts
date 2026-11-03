import { ATTACHMENT_LIMITS } from "@shared/attachments"
import fs from "fs/promises"
import sizeOf from "image-size"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"

/**
 * Supports processing of images and other file types
 * For models which don't support images, will not allow them to be selected
 */
export async function selectFiles(imagesAllowed: boolean): Promise<{ images: string[]; files: string[] }> {
	const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif"] // browser-decodable images
	const OTHER_FILE_EXTENSIONS = [
		// Documents / data
		"xml",
		"json",
		"jsonc",
		"txt",
		"log",
		"md",
		"mdx",
		"docx",
		"ipynb",
		"pdf",
		"xlsx",
		"csv",
		"tsv",
		// Source / config
		"ts",
		"tsx",
		"js",
		"jsx",
		"py",
		"go",
		"rs",
		"java",
		"kt",
		"c",
		"h",
		"cpp",
		"cc",
		"hpp",
		"cs",
		"rb",
		"php",
		"sh",
		"bash",
		"ps1",
		"yaml",
		"yml",
		"toml",
		"ini",
		"env",
		"html",
		"css",
		"scss",
		"sql",
		"dockerfile",
		// Media
		"mp4",
		"m4v",
		"webm",
		"mov",
		"mp3",
		"wav",
		"m4a",
		"ogg",
		"flac",
		// 3D (text and GLB summaries)
		"obj",
		"mtl",
		"stl",
		"ply",
		"gltf",
		"glb",
		"dae",
		"dxf",
		"unity",
		"prefab",
		// Binary 3D/CAD (external converters)
		"fbx",
		"blend",
		"3ds",
		"dwg",
		"step",
		"stp",
		"iges",
		"igs",
		"uasset",
		"umap",
	]
	const MEDIA_EXTENSIONS = ["mp4", "m4v", "webm", "mov", "mp3", "wav", "m4a", "ogg", "flac"]
	const LARGE_SOURCE_EXTENSIONS = [
		...MEDIA_EXTENSIONS,
		"obj",
		"mtl",
		"stl",
		"ply",
		"gltf",
		"glb",
		"dae",
		"dxf",
		"unity",
		"prefab",
		"fbx",
		"blend",
		"3ds",
		"dwg",
		"step",
		"stp",
		"iges",
		"igs",
		"uasset",
		"umap",
	]

	const showDialogueResponse = await HostProvider.window.showOpenDialogue({
		canSelectMany: true,
		openLabel: "Attach",
		filters: {
			files: imagesAllowed ? [...IMAGE_EXTENSIONS, ...OTHER_FILE_EXTENSIONS] : OTHER_FILE_EXTENSIONS,
		},
	})

	const filePaths = showDialogueResponse.paths

	if (!filePaths || filePaths.length === 0) {
		return { images: [], files: [] }
	}

	const processFilesPromises = filePaths.map(async (filePath) => {
		const fileExtension = path.extname(filePath).toLowerCase().substring(1)

		const isImage = IMAGE_EXTENSIONS.includes(fileExtension)

		if (isImage) {
			let buffer: Buffer
			try {
				// Read the file into a buffer first
				buffer = await fs.readFile(filePath)
				// Convert Node.js Buffer to Uint8Array
				const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
				const dimensions = sizeOf(uint8Array) // Get dimensions from Uint8Array
				if (
					dimensions.width! > ATTACHMENT_LIMITS.maxImageSourceDimension ||
					dimensions.height! > ATTACHMENT_LIMITS.maxImageSourceDimension
				) {
					Logger.warn(`Image dimensions exceed ${ATTACHMENT_LIMITS.maxImageSourceDimension}px, skipping: ${filePath}`)
					HostProvider.window.showMessage({
						type: ShowMessageType.ERROR,
						message: `Image too large: ${path.basename(filePath)} was skipped (dimensions exceed ${ATTACHMENT_LIMITS.maxImageSourceDimension}px).`,
					})
					return null
				}
			} catch (error) {
				Logger.error(`Error reading file or getting dimensions for ${filePath}:`, error)
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: `Could not read dimensions for ${path.basename(filePath)}, skipping.`,
				})
				return null
			}

			// If dimensions are valid, proceed to convert the existing buffer to base64
			const base64 = buffer.toString("base64")
			const mimeType = getMimeType(filePath)

			return { type: "image", data: `data:${mimeType};base64,${base64}` }
		}
		// for standard models we will check the size of the file to ensure its not too large
		try {
			const stats = await fs.stat(filePath)
			const isMedia = LARGE_SOURCE_EXTENSIONS.includes(fileExtension)
			const maxBytes = isMedia ? ATTACHMENT_LIMITS.maxMediaFileBytes : ATTACHMENT_LIMITS.maxFileBytes
			if (stats.size > maxBytes) {
				Logger.warn(`File too large, skipping: ${filePath}`)
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: `File too large: ${path.basename(filePath)} was skipped (size exceeds ${isMedia ? "200MB" : "20MB"}).`,
				})
				return null
			}
		} catch (error) {
			Logger.error(`Error checking file size for ${filePath}:`, error)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Could not check file size for ${path.basename(filePath)}, skipping.`,
			})
			return null
		}
		return { type: "file", data: filePath }
	})

	const dataUrlsWithNulls = await Promise.all(processFilesPromises)
	const dataUrlsWithoutNulls = dataUrlsWithNulls.filter((item) => item !== null)

	const images: string[] = []
	const files: string[] = []

	for (const item of dataUrlsWithoutNulls) {
		if (item.type === "image") {
			images.push(item.data)
		} else {
			files.push(item.data)
		}
	}

	return { images, files }
}

function getMimeType(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase()
	switch (ext) {
		case ".png":
			return "image/png"
		case ".jpeg":
		case ".jpg":
			return "image/jpeg"
		case ".webp":
			return "image/webp"
		case ".gif":
			return "image/gif"
		case ".bmp":
			return "image/bmp"
		case ".svg":
			return "image/svg+xml"
		case ".avif":
			return "image/avif"
		default:
			throw new Error(`Unsupported file type: ${ext}`)
	}
}
