const BYTOS_FREE_MODEL_LIMIT_MARKER = "free limit reached on model";
const BYTOS_FREE_MODEL_LIMIT_RETRY_MARKER = "try again in ";
const BYTOS_MODEL_NOT_FOUND_MARKER = "model not found";

export class BytosFreeModelLimitError extends Error {
	public readonly providerId?: string;

	constructor(message: string, providerId?: string) {
		super(message);
		this.name = "BytosFreeModelLimitError";
		this.providerId = providerId;
	}
}

export function isBytosFreeModelLimitError(
	error: unknown,
): error is BytosFreeModelLimitError {
	return error instanceof BytosFreeModelLimitError;
}

export function isBytosFreeModelLimitMessage(text: string): boolean {
	return text.toLowerCase().includes(BYTOS_FREE_MODEL_LIMIT_MARKER);
}

export function isBytosModelNotFoundMessage(text: string): boolean {
	return text.toLowerCase().includes(BYTOS_MODEL_NOT_FOUND_MARKER);
}

export function extractBytosFreeModelLimitResetTime(
	text: string,
): string | undefined {
	const message = text.toLowerCase();
	const resetStart = message.indexOf(BYTOS_FREE_MODEL_LIMIT_RETRY_MARKER);
	if (resetStart === -1) {
		return undefined;
	}

	const resetTime = message
		.slice(resetStart + BYTOS_FREE_MODEL_LIMIT_RETRY_MARKER.length)
		.trim();
	return resetTime || undefined;
}
