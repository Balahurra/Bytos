/**
 * Constants used across the chat view components
 */
import { ATTACHMENT_LIMITS } from "@shared/attachments"

export const CHAT_CONSTANTS = {
	MAX_IMAGES_AND_FILES_PER_MESSAGE: ATTACHMENT_LIMITS.maxPerMessage,
	QUICK_WINS_HISTORY_THRESHOLD: 300,
} as const
