import fs from "node:fs/promises"
import path from "node:path"
import { getModelsForProvider } from "@bytos/llms"
import type { UserFileContent } from "@bytos/shared"
import type { ApiConfiguration } from "@shared/api"
import { ATTACHMENT_LIMITS, isAttachmentFeatureEnabled } from "@shared/attachments"
import { getProviderModelIdKey } from "@shared/storage/provider-keys"
import { StateManager } from "@/core/storage/StateManager"
import { extractTextFromFile } from "@/integrations/misc/extract-text"
import { Logger } from "@/shared/services/Logger"
import { toSdkProviderId } from "./model-catalog/sdk-provider-id"

/**
 * File-content loader for chat attachments.
 *
 * Historically the SDK read user files as raw UTF-8, which cannot handle
 * PDF/DOCX/XLSX. This loader uses the extension's text extractors and, when
 * the selected model advertises PDF input and the feature flag is on, sends a
 * PDF as native document media instead of flattened text.
 */

const pdfSupportCache = new Map<string, Promise<boolean>>()

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

async function modelSupportsPdf(provider: string, modelId: string): Promise<boolean> {
	const sdkProviderId = toSdkProviderId(provider)
	const cacheKey = `${sdkProviderId}:${modelId}`
	const cached = pdfSupportCache.get(cacheKey)
	if (cached) {
		return cached
	}
	const probe = (async () => {
		try {
			const models = await getModelsForProvider(sdkProviderId)
			return models?.[modelId]?.modalities?.input?.includes("pdf") === true
		} catch (error) {
			Logger.warn("[UserFileLoader] Could not read model modalities:", error)
			return false
		}
	})()
	pdfSupportCache.set(cacheKey, probe)
	return probe
}

async function loadNativePdf(filePath: string): Promise<UserFileContent | undefined> {
	if (!isAttachmentFeatureEnabled("nativePdf")) {
		return undefined
	}
	const active = currentModeModel()
	if (!active) {
		return undefined
	}
	if (!(await modelSupportsPdf(active.provider, active.modelId))) {
		return undefined
	}

	const fileStat = await fs.stat(filePath)
	if (!fileStat.isFile()) {
		return undefined
	}
	// The SDK media budget is shared with images. A PDF that cannot fit falls
	// back to text extraction instead of being silently omitted at request time.
	if (fileStat.size > ATTACHMENT_LIMITS.maxTotalMediaBytes) {
		Logger.log(`[UserFileLoader] PDF is ${fileStat.size} bytes, above the native media budget; falling back to text`)
		return undefined
	}

	const buffer = await fs.readFile(filePath)
	return {
		type: "media",
		media: {
			id: `pdf-${path.basename(filePath)}-${fileStat.size}-${Math.random().toString(36).slice(2, 8)}`,
			modality: "file",
			mediaType: "application/pdf",
			source: { type: "base64", data: buffer.toString("base64") },
			name: path.basename(filePath),
			sizeBytes: fileStat.size,
		},
	}
}

export async function loadUserFileContentForChat(filePath: string): Promise<UserFileContent> {
	const extension = path.extname(filePath).toLowerCase()
	if (extension === ".pdf") {
		try {
			const native = await loadNativePdf(filePath)
			if (native) {
				return native
			}
		} catch (error) {
			Logger.warn(`[UserFileLoader] Native PDF failed for ${filePath}; falling back to text:`, error)
		}
	}

	return extractTextFromFile(filePath)
}
