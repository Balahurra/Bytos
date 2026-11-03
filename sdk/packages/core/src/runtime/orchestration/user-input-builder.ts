/**
 * User-input / first-turn content assembler.
 *
 * Opens the first user content array for a turn, loading user file contents via
 * the injected `userFileContentLoader`.
 */

import type * as LlmsProviders from "@bytos/llms";
import type { UserFileContent } from "@bytos/shared";

export async function buildInitialUserContent(
	userMessage: string,
	userImages?: string[],
	userFiles?: string[],
	userFileContentLoader?: (path: string) => Promise<UserFileContent>,
): Promise<string | LlmsProviders.ContentBlock[]> {
	const imageBlocks = buildImageBlocks(userImages);
	const fileTextBlocks = await buildUserFileContentBlock(
		userFiles,
		userFileContentLoader,
	);

	if (imageBlocks.length === 0 && !fileTextBlocks) {
		return userMessage;
	}

	const content: LlmsProviders.ContentBlock[] = [
		{
			type: "text",
			text: userMessage,
		},
		...imageBlocks,
	];
	if (fileTextBlocks) {
		content.push(...fileTextBlocks);
	}
	return content;
}

/**
 * Normalize a user message shape into a plain string when possible.
 *
 * Accepts either a string or a LlmsProviders.Message; returns the best-effort
 * concatenated plain-text body. Non-text content is ignored.
 */
export function normalizeUserMessage(
	input: string | LlmsProviders.Message | undefined,
): string {
	if (input == null) {
		return "";
	}
	if (typeof input === "string") {
		return input;
	}
	const content = input.content;
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	const textParts: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object" && block.type === "text") {
			const text = (block as { text?: unknown }).text;
			if (typeof text === "string") {
				textParts.push(text);
			}
		}
	}
	return textParts.join("\n");
}

function buildImageBlocks(userImages?: string[]): LlmsProviders.ImageContent[] {
	if (!userImages || userImages.length === 0) {
		return [];
	}

	const blocks: LlmsProviders.ImageContent[] = [];
	for (const image of userImages) {
		const block = parseDataUrlImage(image);
		if (block) {
			blocks.push(block);
		}
	}
	return blocks;
}

function parseDataUrlImage(
	image: string,
): LlmsProviders.ImageContent | undefined {
	const value = image.trim();
	if (!value) {
		return undefined;
	}

	const dataUrlMatch = value.match(/^data:([^;,]+);base64,(.+)$/);
	if (dataUrlMatch) {
		const mediaType = dataUrlMatch[1];
		const data = dataUrlMatch[2];
		if (!mediaType || !data) {
			return undefined;
		}
		return {
			type: "image",
			mediaType,
			data,
		};
	}

	// Fallback: treat as plain base64 payload.
	return {
		type: "image",
		mediaType: "image/png",
		data: value,
	};
}

async function buildUserFileContentBlock(
	userFiles?: string[],
	userFileContentLoader?: (path: string) => Promise<UserFileContent>,
): Promise<LlmsProviders.ContentBlock[] | undefined> {
	if (!userFiles || userFiles.length === 0) {
		return undefined;
	}

	const loader =
		userFileContentLoader ??
		(async () => {
			throw new Error(
				"File loading is not configured in this runtime. Provide userFileContentLoader to enable userFiles support.",
			);
		});

	const contentBlocks: LlmsProviders.ContentBlock[] = [];

	for (const filePath of userFiles) {
		const normalizedPath = filePath.replace(/\\/g, "/");
		try {
			const content = await loader(filePath);
			if (typeof content === "string") {
				contentBlocks.push({
					type: "file",
					path: normalizedPath,
					content,
				});
			} else if (Array.isArray(content)) {
				contentBlocks.push(...content);
			} else {
				contentBlocks.push(content);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			contentBlocks.push({
				type: "file",
				path: normalizedPath,
				content: `Error fetching content: ${message}`,
			});
		}
	}

	return contentBlocks.length > 0 ? contentBlocks : undefined;
}
