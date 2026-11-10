import {
	extractBytosFreeModelLimitResetTime,
	isBytosFreeModelLimitError,
	isBytosFreeModelLimitMessage,
	isBytosModelNotFoundMessage,
} from "@bytos/core";

const BYTOS_FREE_MODEL_PREFIX = "bytos-free/";
const BYTOS_FREE_PROMOTION_ENDED_HEADER = "Free model promotion ended";
const BYTOS_FREE_MODEL_LIMIT_HEADER = "Daily free model limit reached";

export function getCliBytosFreePromotionEndedMessage(): string {
	return [
		BYTOS_FREE_PROMOTION_ENDED_HEADER,
		"The free promotion for this model has ended and it is no longer available.",
		"Select another model to continue.",
		"Open the model selector with /model.",
	].join("\n");
}

export function getCliBytosFreeModelLimitMessage(message: string): string {
	const resetTime = extractBytosFreeModelLimitResetTime(message);
	return [
		BYTOS_FREE_MODEL_LIMIT_HEADER,
		"You've reached today's free usage limit for this model.",
		resetTime
			? `Try again in ${resetTime} or select another model.`
			: "Try again later or select another model.",
		"Open the model selector with /model.",
	].join("\n");
}

// Detects that a deleted free model was requested: the backend answers "model
// not found" once a free promotion ends and the bytos-free/ model is removed.
// The modelId gate keeps regular model-not-found errors on their generic path.
export function isBytosFreePromotionEndedErrorMessage(
	error: unknown,
	modelId?: string,
): boolean {
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "";
	if (
		message
			.toLowerCase()
			.includes(BYTOS_FREE_PROMOTION_ENDED_HEADER.toLowerCase())
	) {
		return true;
	}
	if (!modelId?.startsWith(BYTOS_FREE_MODEL_PREFIX)) {
		return false;
	}
	return isBytosModelNotFoundMessage(message);
}

export function isBytosFreeModelLimitErrorMessage(error: unknown): boolean {
	if (isBytosFreeModelLimitError(error)) {
		return true;
	}
	if (error instanceof Error) {
		return (
			error.name === "BytosFreeModelLimitError" ||
			isBytosFreeModelLimitMessage(error.message)
		);
	}
	return (
		typeof error === "string" &&
		(error
			.toLowerCase()
			.includes(BYTOS_FREE_MODEL_LIMIT_HEADER.toLowerCase()) ||
			isBytosFreeModelLimitMessage(error))
	);
}

export function formatCliErrorMessage(
	error: unknown,
	options?: { modelId?: string },
): string {
	if (isBytosFreeModelLimitErrorMessage(error)) {
		return getCliBytosFreeModelLimitMessage(
			error instanceof Error ? error.message : String(error),
		);
	}
	if (isBytosFreePromotionEndedErrorMessage(error, options?.modelId)) {
		return getCliBytosFreePromotionEndedMessage();
	}
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
