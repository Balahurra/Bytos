import type { Anthropic } from "@anthropic-ai/sdk"
import type { BytosMessageMetricsInfo, BytosMessageModelInfo } from "./metrics"

export type BytosPromptInputContent = string

export type BytosMessageRole = "user" | "assistant"

export interface BytosReasoningDetailParam {
	type: "reasoning.text" | string
	text: string
	signature: string
	format: "anthropic-claude-v1" | string
	index: number
}

interface BytosSharedMessageParam {
	// The id of the response that the block belongs to
	call_id?: string
}

export const REASONING_DETAILS_PROVIDERS = ["bytos", "openrouter"]

/**
 * An extension of Anthropic.MessageParam that includes Bytos-specific fields: reasoning_details.
 * This ensures backward compatibility where the messages were stored in Anthropic format with additional
 * fields unknown to Anthropic SDK.
 */
export interface BytosTextContentBlock extends Anthropic.TextBlockParam, BytosSharedMessageParam {
	// reasoning_details only exists for providers listed in REASONING_DETAILS_PROVIDERS
	reasoning_details?: BytosReasoningDetailParam[]
	// Thought Signature associates with Gemini
	signature?: string
}

export interface BytosImageContentBlock extends Anthropic.ImageBlockParam, BytosSharedMessageParam {}

export interface BytosDocumentContentBlock extends Anthropic.DocumentBlockParam, BytosSharedMessageParam {}

export interface BytosUserToolResultContentBlock extends Anthropic.ToolResultBlockParam, BytosSharedMessageParam {}

/**
 * Assistant only content types
 */
export interface BytosAssistantToolUseBlock extends Anthropic.ToolUseBlockParam, BytosSharedMessageParam {
	// reasoning_details only exists for providers listed in REASONING_DETAILS_PROVIDERS
	reasoning_details?: unknown[] | BytosReasoningDetailParam[]
	// Thought Signature associates with Gemini
	signature?: string
}

export interface BytosAssistantThinkingBlock extends Anthropic.ThinkingBlock, BytosSharedMessageParam {
	// The summary items returned by OpenAI response API
	// The reasoning details that will be moved to the text block when finalized
	summary?: unknown[] | BytosReasoningDetailParam[]
}

export interface BytosAssistantRedactedThinkingBlock extends Anthropic.RedactedThinkingBlockParam, BytosSharedMessageParam {}

export type BytosToolResponseContent = BytosPromptInputContent | Array<BytosTextContentBlock | BytosImageContentBlock>

export type BytosUserContent =
	| BytosTextContentBlock
	| BytosImageContentBlock
	| BytosDocumentContentBlock
	| BytosUserToolResultContentBlock

export type BytosAssistantContent =
	| BytosTextContentBlock
	| BytosImageContentBlock
	| BytosDocumentContentBlock
	| BytosAssistantToolUseBlock
	| BytosAssistantThinkingBlock
	| BytosAssistantRedactedThinkingBlock

export type BytosContent = BytosUserContent | BytosAssistantContent

/**
 * An extension of Anthropic.MessageParam that includes Bytos-specific fields.
 * This ensures backward compatibility where the messages were stored in Anthropic format,
 * while allowing for additional metadata specific to Bytos to avoid unknown fields in Anthropic SDK
 * added by ignoring the type checking for those fields.
 */
export interface BytosStorageMessage extends Anthropic.MessageParam {
	/**
	 * Response ID associated with this message
	 */
	id?: string
	role: BytosMessageRole
	content: BytosPromptInputContent | BytosContent[]
	/**
	 * NOTE: model information used when generating this message.
	 * Internal use for message conversion only.
	 * MUST be removed before sending message to any LLM provider.
	 */
	modelInfo?: BytosMessageModelInfo
	/**
	 * LLM operational and performance metrics for this message
	 * Includes token counts, costs.
	 */
	metrics?: BytosMessageMetricsInfo
	/**
	 * Timestamp of when the message was created
	 */
	ts?: number
}

/**
 * Converts BytosStorageMessage to Anthropic.MessageParam by removing Bytos-specific fields
 * Bytos-specific fields (like modelInfo, reasoning_details) are properly omitted.
 */
export function convertBytosStorageToAnthropicMessage(
	bytosMessage: BytosStorageMessage,
	provider = "anthropic",
): Anthropic.MessageParam {
	const { role, content } = bytosMessage

	// Handle string content - fast path
	if (typeof content === "string") {
		return { role, content }
	}

	// Removes thinking block that has no signature (invalid thinking block that's incompatible with Anthropic API)
	const filteredContent = content.filter((b) => b.type !== "thinking" || !!b.signature)

	// Handle array content - strip Bytos-specific fields for non-reasoning_details providers
	const shouldCleanContent = !REASONING_DETAILS_PROVIDERS.includes(provider)
	const cleanedContent = shouldCleanContent
		? filteredContent.map(cleanContentBlock)
		: (filteredContent as Anthropic.MessageParam["content"])

	return { role, content: cleanedContent }
}

/**
 * Bytos stores images as base64, so an image block's source is always a base64 source.
 * The Anthropic SDK types the source as a Base64ImageSource | URLImageSource union, so this
 * narrows to the base64 variant for the transform layer. URL sources are not produced by Bytos,
 * so they degrade to empty values rather than throwing.
 */
export function getBase64ImageSource(source: Anthropic.ImageBlockParam["source"]): { mediaType: string; data: string } {
	if (source.type === "base64") {
		return { mediaType: source.media_type, data: source.data }
	}
	return { mediaType: "", data: "" }
}

/**
 * Builds a base64 data URL from an image block's source. See getBase64ImageSource.
 */
export function getImageDataUrl(source: Anthropic.ImageBlockParam["source"]): string {
	const { mediaType, data } = getBase64ImageSource(source)
	return `data:${mediaType};base64,${data}`
}

/**
 * Clean a content block by removing Bytos-specific fields and returning only Anthropic-compatible fields
 */
export function cleanContentBlock(block: BytosContent): Anthropic.ContentBlock {
	// Fast path: if no Bytos-specific fields exist, return as-is
	const hasBytosFields =
		"reasoning_details" in block ||
		"call_id" in block ||
		"summary" in block ||
		(block.type !== "thinking" && "signature" in block)

	if (!hasBytosFields) {
		return block as Anthropic.ContentBlock
	}

	// Removes Bytos-specific fields & the signature field that's added for Gemini.
	const { reasoning_details, call_id, summary, ...rest } = block as any

	// Remove signature from non-thinking blocks that were added for Gemini
	if (block.type !== "thinking" && rest.signature) {
		rest.signature = undefined
	}

	return rest satisfies Anthropic.ContentBlock
}
