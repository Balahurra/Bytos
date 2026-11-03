import { selectFiles as selectFilesIntegration } from "@integrations/misc/process-files"
import { StringArrays } from "@shared/proto/bytos/common"
import { SelectFilesRequest } from "@shared/proto/bytos/file"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

/**
 * Select attachments with explicit host capabilities:
 * - supportsImages: the active model can consume image input
 * - imagesOnly: the session cannot read local file paths (cloud sandbox)
 */
export async function selectFilesWithOptions(_controller: Controller, request: SelectFilesRequest): Promise<StringArrays> {
	try {
		const { images, files } = await selectFilesIntegration(request.supportsImages, request.imagesOnly)
		return StringArrays.create({ values1: images, values2: files })
	} catch (error) {
		Logger.error("Error selecting attachments:", error)
		return StringArrays.create({ values1: [], values2: [] })
	}
}
