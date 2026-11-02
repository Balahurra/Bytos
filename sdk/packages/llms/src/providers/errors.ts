import { getBytosEnvironmentConfig } from "@bytos/shared";

export const BYTOS_NOT_SUBSCRIBED_RESPONSE_MESSAGE =
	"the user is not subscribed to required model plan";
const BYTOS_NOT_SUBSCRIBED_FORMATTED_MESSAGE_PREFIX =
	"no access to bytospass subscription models yet. subscribe to bytospass";
export const BYTOS_ORG_INDIVIDUAL_INFERENCE_SUBSCRIPTION_RESPONSE_MESSAGE =
	"organization accounts cannot use individual model inference subscriptions";

const BYTOS_PASS_LIMIT_PREFIX = "you have reached your";
const BYTOS_PASS_LIMIT_MARKER = "bytospass limit";
const BYTOS_PASS_LIMIT_SUFFIX = "please try again later.";
const BYTOS_FREE_MODEL_LIMIT_MARKER = "free limit reached on model";
const BYTOS_FREE_MODEL_LIMIT_RETRY_MARKER = "try again in ";
const BYTOS_MODEL_NOT_FOUND_MARKER = "model not found";

function findBytosPassLimitMessageBounds(
	text: string,
): { start: number; end: number } | undefined {
	const normalized = text.toLowerCase();
	const start = normalized.indexOf(BYTOS_PASS_LIMIT_PREFIX);
	if (start === -1) {
		return undefined;
	}

	const suffixStart = normalized.indexOf(BYTOS_PASS_LIMIT_SUFFIX, start);
	if (suffixStart === -1) {
		return undefined;
	}

	const end = suffixStart + BYTOS_PASS_LIMIT_SUFFIX.length;
	if (!normalized.slice(start, end).includes(BYTOS_PASS_LIMIT_MARKER)) {
		return undefined;
	}

	return { start, end };
}

export function getBytosPassSubscriptionUrl(): string {
	return `${new URL(
		"/dashboard/subscription?personal=true",
		getBytosEnvironmentConfig().appBaseUrl,
	).toString()}`;
}

export function getBytosNotSubscribedMessage(): string {
	return `No access to BytosPass subscription models yet. Subscribe to BytosPass, the low cost open weights model coding plan: ${getBytosPassSubscriptionUrl()}`;
}

export class BytosNotSubscribedError extends Error {
	public readonly providerId?: string;

	constructor(providerId?: string) {
		super(getBytosNotSubscribedMessage());
		this.name = "BytosNotSubscribedError";
		this.providerId = providerId;
	}
}

export function getBytosOrgIndividualInferenceSubscriptionMessage(): string {
	return "Organization accounts cannot use BytosPass subscriptions. Go to /account -> change account to switch to your personal account for BytosPass";
}

export class BytosOrgIndividualInferenceSubscriptionError extends Error {
	public readonly providerId?: string;

	constructor(providerId?: string) {
		super(getBytosOrgIndividualInferenceSubscriptionMessage());
		this.name = "BytosOrgIndividualInferenceSubscriptionError";
		this.providerId = providerId;
	}
}

export class BytosPassLimitError extends Error {
	public readonly providerId?: string;

	constructor(message: string, providerId?: string) {
		super(message);
		this.name = "BytosPassLimitError";
		this.providerId = providerId;
	}
}

export class BytosFreeModelLimitError extends Error {
	public readonly providerId?: string;

	constructor(message: string, providerId?: string) {
		super(message);
		this.name = "BytosFreeModelLimitError";
		this.providerId = providerId;
	}
}

export function isBytosNotSubscribedError(
	error: unknown,
): error is BytosNotSubscribedError {
	return error instanceof BytosNotSubscribedError;
}

export function isBytosOrgIndividualInferenceSubscriptionError(
	error: unknown,
): error is BytosOrgIndividualInferenceSubscriptionError {
	return error instanceof BytosOrgIndividualInferenceSubscriptionError;
}

export function isBytosPassLimitError(
	error: unknown,
): error is BytosPassLimitError {
	return error instanceof BytosPassLimitError;
}

export function isBytosFreeModelLimitError(
	error: unknown,
): error is BytosFreeModelLimitError {
	return error instanceof BytosFreeModelLimitError;
}

export function isBytosNotSubscribedMessage(text: string): boolean {
	const normalized = text.trim().toLowerCase();
	return (
		normalized.includes(BYTOS_NOT_SUBSCRIBED_RESPONSE_MESSAGE) ||
		normalized.includes(BYTOS_NOT_SUBSCRIBED_FORMATTED_MESSAGE_PREFIX)
	);
}

export function isBytosOrgIndividualInferenceSubscriptionMessage(
	text: string,
): boolean {
	return text
		.toLowerCase()
		.includes(BYTOS_ORG_INDIVIDUAL_INFERENCE_SUBSCRIPTION_RESPONSE_MESSAGE);
}

export function isBytosPassLimitMessage(text: string): boolean {
	return findBytosPassLimitMessageBounds(text) !== undefined;
}

export function extractBytosPassLimitMessage(text: string): string | undefined {
	const bounds = findBytosPassLimitMessageBounds(text);
	return bounds ? text.slice(bounds.start, bounds.end) : undefined;
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
