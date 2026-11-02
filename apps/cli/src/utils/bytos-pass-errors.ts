import {
	type BytosSubscriptionPlan,
	extractBytosFreeModelLimitResetTime,
	extractBytosPassLimitMessage,
	getBytosOrgIndividualInferenceSubscriptionMessage,
	isBytosFreeModelLimitError,
	isBytosFreeModelLimitMessage,
	isBytosModelNotFoundMessage,
	isBytosNotSubscribedError,
	isBytosNotSubscribedMessage,
	isBytosOrgIndividualInferenceSubscriptionError,
	isBytosOrgIndividualInferenceSubscriptionMessage,
	isBytosPassLimitError,
	isBytosPassLimitMessage,
} from "@bytos/core";

import { getBytosEnvironmentConfig } from "@bytos/shared";

export { getBytosOrgIndividualInferenceSubscriptionMessage };

export function getCliSubscriptionUrl(): string {
	return new URL(
		`/dashboard/subscription?personal=true`,
		getBytosEnvironmentConfig().appBaseUrl,
	).toString();
}

export function getCliNotSubscribedMessage(): string {
	return `No access to BytosPass subscription models yet. Subscribe to BytosPass, the low cost open weights model coding plan: ${getCliSubscriptionUrl()}`;
}

export function getCliBytosPassLimitMessage(message: string): string {
	const detail = getBytosPassLimitDetailMessage(message) ?? message.trim();
	const lines = [
		"BytosPass limit reached",
		detail,
		"Switch to Bytos usage-based billing and retry with the Bytos provider.",
		"Interactive CLI: open the model selector with /model, choose Bytos, then retry.",
		"Headless CLI: rerun with --provider bytos.",
	];
	return lines.filter((line) => line.trim().length > 0).join("\n");
}

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

export function getIndividualPlanFeatures(
	plans: BytosSubscriptionPlan[],
): string[] {
	const planWithFeatures = plans.find((plan) => plan.interval === "Monthly");

	return planWithFeatures?.features?.included ?? [];
}

function isFormattedBytosPassSubscriptionMessage(message: string): boolean {
	const normalized = message.trim().toLowerCase();
	return (
		normalized.includes("no access to bytospass subscription models yet") &&
		normalized.includes("subscribe to bytospass")
	);
}

export function isBytosPassSubscriptionError(error: unknown): boolean {
	if (isBytosNotSubscribedError(error)) {
		return true;
	}
	if (error instanceof Error) {
		return (
			error.name === "BytosNotSubscribedError" ||
			isBytosNotSubscribedMessage(error.message) ||
			isFormattedBytosPassSubscriptionMessage(error.message)
		);
	}
	return (
		typeof error === "string" &&
		(isBytosNotSubscribedMessage(error) ||
			isFormattedBytosPassSubscriptionMessage(error))
	);
}

export function isBytosOrgIndividualInferenceSubscriptionErrorMessage(
	error: unknown,
): boolean {
	if (isBytosOrgIndividualInferenceSubscriptionError(error)) {
		return true;
	}
	if (error instanceof Error) {
		return (
			error.name === "BytosOrgIndividualInferenceSubscriptionError" ||
			isBytosOrgIndividualInferenceSubscriptionMessage(error.message) ||
			error.message === getBytosOrgIndividualInferenceSubscriptionMessage()
		);
	}
	return (
		typeof error === "string" &&
		(isBytosOrgIndividualInferenceSubscriptionMessage(error) ||
			error === getBytosOrgIndividualInferenceSubscriptionMessage())
	);
}

export function getBytosPassLimitDetailMessage(
	error: unknown,
): string | undefined {
	return extractBytosPassLimitMessage(
		error instanceof Error ? error.message : String(error),
	);
}

export function isBytosPassLimitErrorMessage(error: unknown): boolean {
	if (isBytosPassLimitError(error)) {
		return true;
	}
	if (error instanceof Error) {
		return (
			error.name === "BytosPassLimitError" ||
			isBytosPassLimitMessage(error.message)
		);
	}
	return typeof error === "string" && isBytosPassLimitMessage(error);
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
	if (isBytosPassSubscriptionError(error)) {
		return getCliNotSubscribedMessage();
	}
	if (isBytosOrgIndividualInferenceSubscriptionErrorMessage(error)) {
		return getBytosOrgIndividualInferenceSubscriptionMessage();
	}
	if (isBytosPassLimitErrorMessage(error)) {
		return getCliBytosPassLimitMessage(
			error instanceof Error ? error.message : String(error),
		);
	}
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
