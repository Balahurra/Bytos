import fs from "node:fs/promises"
import path from "node:path"
import { getModelsForProvider } from "@bytos/llms"
import type { UserFileContent } from "@bytos/shared"
import type { ApiConfiguration } from "@shared/api"
import {
	ATTACHMENT_LIMITS,
	ATTACHMENT_MIME_BY_EXTENSION,
	classifyAttachment,
	getAttachmentExtension,
	isAttachmentFeatureEnabled,
} from "@shared/attachments"
import { getProviderModelIdKey } from "@shared/storage/provider-keys"
import { StateManager } from "@/core/storage/StateManager"
import { extractTextFromFile } from "@/integrations/misc/extract-text"
import { describeMediaToolRequirement, extractVideoFrames, transcribeAudio } from "@/integrations/misc/media-attachments"
import { summarizeModel3d } from "@/integrations/misc/model3d-attachments"
import { Logger } from "@/shared/services/Logger"
import { toSdkProviderId } from "./model-catalog/sdk-provider-id"

/**
 * File-content loader for chat attachments.
 *
 * Historically the SDK read user files as raw UTF-8, which cannot handle
 * PDF/DOCX/XLSX. This loader uses the extension's text extractors and, when
 * the selected model advertises the matching modality, sends the file as
 * native media instead of flattened text. Video/audio fall back to ffmpeg
 * frame sampling / Whisper transcription when those tools are installed.
 */

type InputModality = "pdf" | "video" | "audio"

const modalitySupportCache = new Map<string, Promise<boolean>>()

function currentModeModel(): { provider: string; modelId: string } | undefined {
	try {
		const stateManager = StateManager.get()
		const config: ApiConfiguration = stateManager.getApiConfiguration()
		const mode = stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
		const provider = mode === "plan" ? config.planModeApiProvider : config.actModeApiProvider
		if (!provider) {
			return undefined
		}
		const modelKey = getProviderModelIdKey(provider, mode)
		const genericKey = mode === "plan" ? "planModeApiModelId" : "actModeApiModelId"
		const configFields = config as unknown as Record<string, unknown>
		const modelId =
			(configFields[modelKey] as string | undefined)?.trim() ||
			(configFields[genericKey] as string | undefined)?.trim() ||
			""
		return modelId ? { provider, modelId } : undefined
	} catch (error) {
		Logger.warn("[UserFileLoader] Could not resolve the active model:", error)
		return undefined
	}
}

async function modelSupportsModality(provider: string, modelId: string, modality: InputModality): Promise<boolean> {
	const sdkProviderId = toSdkProviderId(provider)
	const cacheKey = `${sdkProviderId}:${modelId}:${modality}`
	const cached = modalitySupportCache.get(cacheKey)
	if (cached) {
		return cached
	}
	const probe = (async () => {
		try {
			const models = await getModelsForProvider(sdkProviderId)
			return models?.[modelId]?.modalities?.input?.includes(modality) === true
		} catch (error) {
			Logger.warn("[UserFileLoader] Could not read model modalities:", error)
			return false
		}
	})()
	modalitySupportCache.set(cacheKey, probe)
	return probe
}

async function loadNativeMedia(
	filePath: string,
	modality: InputModality,
	mediaType: string,
	mediaModality: "file" | "video" | "audio",
): Promise<UserFileContent | undefined> {
	const active = currentModeModel()
	if (!active) {
		return undefined
	}
	if (!(await modelSupportsModality(active.provider, active.modelId, modality))) {
		return undefined
	}

	const fileStat = await fs.stat(filePath)
	if (!fileStat.isFile()) {
		return undefined
	}
	// The SDK media budget is shared with images. A file that cannot fit falls
	// back to the modality-specific extractor instead of being silently omitted.
	if (fileStat.size > ATTACHMENT_LIMITS.maxTotalMediaBytes) {
		Logger.log(
			`[UserFileLoader] ${path.basename(filePath)} is ${fileStat.size} bytes, above the native media budget; using fallback`,
		)
		return undefined
	}

	const buffer = await fs.readFile(filePath)
	return {
		type: "media",
		media: {
			id: `${mediaModality}-${path.basename(filePath)}-${fileStat.size}-${Math.random().toString(36).slice(2, 8)}`,
			modality: mediaModality,
			mediaType,
			source: { type: "base64", data: buffer.toString("base64") },
			name: path.basename(filePath),
			sizeBytes: fileStat.size,
		},
	}
}

async function loadNativePdf(filePath: string): Promise<UserFileContent | undefined> {
	if (!isAttachmentFeatureEnabled("nativePdf")) {
		return undefined
	}
	return loadNativeMedia(filePath, "pdf", "application/pdf", "file")
}

async function loadVideo(filePath: string): Promise<UserFileContent> {
	if (isAttachmentFeatureEnabled("videoAudio")) {
		try {
			const native = await loadNativeMedia(filePath, "video", getMediaMimeType(filePath), "video")
			if (native) {
				return native
			}
		} catch (error) {
			Logger.warn(`[UserFileLoader] Native video failed for ${filePath}; using frames:`, error)
		}
		const frames = await extractVideoFrames(filePath)
		if (frames?.length) {
			return frames
		}
	}

	throw new Error(describeMediaToolRequirement("video"))
}

async function loadAudio(filePath: string): Promise<UserFileContent> {
	if (isAttachmentFeatureEnabled("videoAudio")) {
		try {
			const native = await loadNativeMedia(filePath, "audio", getMediaMimeType(filePath), "audio")
			if (native) {
				return native
			}
		} catch (error) {
			Logger.warn(`[UserFileLoader] Native audio failed for ${filePath}; trying transcription:`, error)
		}
		const transcript = await transcribeAudio(filePath)
		if (transcript) {
			return `[Audio transcript: ${path.basename(filePath)}]\n${transcript}`
		}
	}

	throw new Error(describeMediaToolRequirement("audio"))
}

export async function loadUserFileContentForChat(filePath: string): Promise<UserFileContent> {
	const extension = getAttachmentExtension(filePath)

	if (extension === "pdf") {
		try {
			const native = await loadNativePdf(filePath)
			if (native) {
				return native
			}
		} catch (error) {
			Logger.warn(`[UserFileLoader] Native PDF failed for ${filePath}; falling back to text:`, error)
		}
		return extractTextFromFile(filePath)
	}

	if (extension === "mp4" || extension === "m4v" || extension === "webm" || extension === "mov") {
		return loadVideo(filePath)
	}

	if (extension === "mp3" || extension === "wav" || extension === "m4a" || extension === "ogg" || extension === "flac") {
		return loadAudio(filePath)
	}

	if (classifyAttachment(filePath) === "model3d") {
		if (!isAttachmentFeatureEnabled("model3d")) {
			throw new Error(`3D attachment support is disabled in this build (${path.basename(filePath)}).`)
		}
		return summarizeModel3d(filePath)
	}

	return extractTextFromFile(filePath)
}

/** Resolve the MIME type for a media attachment path. */
export function getMediaMimeType(filePath: string): string {
	return ATTACHMENT_MIME_BY_EXTENSION[getAttachmentExtension(filePath)] ?? "application/octet-stream"
}
