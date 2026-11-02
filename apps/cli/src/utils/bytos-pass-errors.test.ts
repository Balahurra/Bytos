import { describe, expect, it } from "vitest";
import {
	formatCliErrorMessage,
	getCliBytosFreeModelLimitMessage,
	getCliBytosPassLimitMessage,
	getCliNotSubscribedMessage,
	getBytosOrgIndividualInferenceSubscriptionMessage,
	getBytosPassLimitDetailMessage,
	isBytosFreeModelLimitErrorMessage,
	isBytosFreePromotionEndedErrorMessage,
	isBytosOrgIndividualInferenceSubscriptionErrorMessage,
	isBytosPassLimitErrorMessage,
	isBytosPassSubscriptionError,
} from "./bytos-pass-errors";

describe("bytos-pass-errors", () => {
	it("recognizes both raw and formatted BytosPass subscription messages", () => {
		expect(
			isBytosPassSubscriptionError(
				"the user is not subscribed to required model plan",
			),
		).toBe(true);

		const sdkFormatted =
			"No access to BytosPass subscription models yet. Subscribe to BytosPass, the low cost open weights model coding plan: https://app.bytos.dev/dashboard/subscription?personal=true";
		const formatted = getCliNotSubscribedMessage();
		expect(isBytosPassSubscriptionError(sdkFormatted)).toBe(true);
		expect(isBytosPassSubscriptionError(formatted)).toBe(true);
		expect(formatCliErrorMessage(new Error(sdkFormatted))).toBe(formatted);
		expect(formatCliErrorMessage(new Error(formatted))).toBe(formatted);
	});

	it("recognizes and formats organization account individual subscription errors", () => {
		const raw =
			"403 Error 403: organization accounts cannot use individual model inference subscriptions";
		const formatted = getBytosOrgIndividualInferenceSubscriptionMessage();

		expect(isBytosOrgIndividualInferenceSubscriptionErrorMessage(raw)).toBe(
			true,
		);
		expect(
			isBytosOrgIndividualInferenceSubscriptionErrorMessage(
				new Error(formatted),
			),
		).toBe(true);
		expect(formatCliErrorMessage(new Error(raw))).toBe(formatted);
		expect(formatCliErrorMessage(new Error(raw))).not.toContain(
			"deepseek-v4-flash",
		);
	});

	it("recognizes and formats BytosPass period limit errors with usage-billing guidance", () => {
		const raw =
			"Error: You have reached your 5-hour Bytospass limit. The limit resets in 5h, please try again later.";
		const detail =
			"You have reached your 5-hour Bytospass limit. The limit resets in 5h, please try again later.";

		expect(isBytosPassLimitErrorMessage(raw)).toBe(true);
		expect(isBytosPassLimitErrorMessage(new Error(raw))).toBe(true);
		expect(getBytosPassLimitDetailMessage(raw)).toBe(detail);
		expect(formatCliErrorMessage(new Error(raw))).toBe(
			getCliBytosPassLimitMessage(raw),
		);
		expect(formatCliErrorMessage(new Error(raw))).toContain(
			"Switch to Bytos usage-based billing",
		);
		expect(formatCliErrorMessage(new Error(raw))).toContain("--provider bytos");
	});

	it("recognizes and formats daily free model limits without usage-billing guidance", () => {
		const raw =
			"Error: Error 429: Daily free limit reached on model deepseek/deepseek-v4-flash. Try again in 23h 59m";

		expect(isBytosFreeModelLimitErrorMessage(raw)).toBe(true);
		expect(isBytosFreeModelLimitErrorMessage(new Error(raw))).toBe(true);
		expect(formatCliErrorMessage(new Error(raw))).toBe(
			getCliBytosFreeModelLimitMessage(raw),
		);
		expect(formatCliErrorMessage(new Error(raw))).not.toContain("Error 429");
		expect(formatCliErrorMessage(new Error(raw))).toContain(
			"Try again in 23h 59m",
		);
		expect(formatCliErrorMessage(new Error(raw))).toContain(
			"select another model",
		);
		expect(formatCliErrorMessage(new Error(raw))).not.toContain(
			"usage-based billing",
		);
		expect(
			isBytosFreeModelLimitErrorMessage(getCliBytosFreeModelLimitMessage(raw)),
		).toBe(true);
	});

	it("formats model-not-found errors for removed free models", () => {
		const raw = new Error("Error 404: model not found");

		expect(
			formatCliErrorMessage(raw, { modelId: "bytos-free/retired-model" }),
		).toContain("Free model promotion ended");
		expect(
			isBytosFreePromotionEndedErrorMessage(
				formatCliErrorMessage(raw, { modelId: "bytos-free/retired-model" }),
			),
		).toBe(true);
		expect(
			formatCliErrorMessage(raw, { modelId: "vendor/retired-model" }),
		).toBe(raw.message);
	});
});
