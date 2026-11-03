import { classifyAttachment } from "@shared/attachments"
import type { ChatAttachment } from "@shared/proto/bytos/task"
import { Logger } from "@/shared/services/Logger"

/**
 * Convert the additive `attachments` field into the legacy images/files shape
 * the current task pipeline understands. During the compatibility window the
 * webview sends both, so legacy arrays always win; a future client that only
 * sends typed attachments still works for the kinds we support today.
 */
export function resolveRequestAttachments(
	attachments: readonly ChatAttachment[] | undefined,
	images: readonly string[] | undefined,
	files: readonly string[] | undefined,
): { images: string[]; files: string[] } {
	const legacyImages = [...(images ?? [])]
	const legacyFiles = [...(files ?? [])]
	if (legacyImages.length > 0 || legacyFiles.length > 0 || !attachments?.length) {
		return { images: legacyImages, files: legacyFiles }
	}

	const resolvedImages: string[] = []
	const resolvedFiles: string[] = []

	for (const attachment of attachments) {
		const kind = attachment.kind || classifyAttachment(attachment.name || attachment.path || "", attachment.mimeType) || ""
		if (kind === "image") {
			if (attachment.data) {
				resolvedImages.push(attachment.data)
			}
			continue
		}
		if (kind === "text" || kind === "document") {
			if (attachment.path) {
				resolvedFiles.push(attachment.path)
			}
			continue
		}
		// video/audio/model3d are reserved for the phases that add real
		// transport support. Dropping them here is explicit instead of silently
		// treating a binary as text.
		Logger.warn(`[Attachments] Ignoring unsupported attachment kind "${kind}" (${attachment.name || "unnamed"})`)
	}

	return { images: resolvedImages, files: resolvedFiles }
}
