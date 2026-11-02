import { describe, expect, it } from "vitest";
import { isBytosPassLimitMessage } from "../index.browser";
import {
	extractBytosFreeModelLimitResetTime,
	extractBytosPassLimitMessage,
	isBytosFreeModelLimitMessage,
} from "./errors";

describe("isBytosPassLimitMessage", () => {
	it("matches the BytosPass weekly limit message", () => {
		const message =
			"You have reached your weekly Bytospass limit. The limit resets in 7d, please try again later.";
		expect(isBytosPassLimitMessage(message)).toBe(true);
	});

	it("matches the 5-hour BytosPass limit message", () => {
		const message =
			"You have reached your 5-hour Bytospass limit. The limit resets in 5h, please try again later.";
		expect(isBytosPassLimitMessage(message)).toBe(true);
	});

	it("handles tab-heavy non-matches without regex backtracking", () => {
		expect(
			isBytosPassLimitMessage(`You have reached your\t${"\t".repeat(10_000)}`),
		).toBe(false);
		expect(
			isBytosPassLimitMessage(`You have reached your\t-${"\t".repeat(10_000)}`),
		).toBe(false);
		expect(
			isBytosPassLimitMessage(
				`You have reached your\t-\tBytospass limit.The limit resets in\t${"\t".repeat(10_000)}`,
			),
		).toBe(false);
	});
});

describe("extractBytosPassLimitMessage", () => {
	it("extracts the BytosPass weekly limit message", () => {
		const message =
			"You have reached your weekly Bytospass limit. The limit resets in 7d, please try again later.";

		const extracted = extractBytosPassLimitMessage(`Error: ${message}`);
		expect(extracted).toBe(message);
	});

	it("extracts the 5-hour BytosPass limit message", () => {
		const message =
			"You have reached your 5-hour Bytospass limit. The limit resets in 5h, please try again later.";

		const extracted = extractBytosPassLimitMessage(`Error: ${message}`);
		expect(extracted).toBe(message);
	});
});

describe("Bytos free model limit messages", () => {
	const message =
		"Daily free limit reached on model deepseek/deepseek-v4-flash. Try again in 23h 59m";

	it("detects the message in an HTTP error", () => {
		const error = `Error: Error 429: ${message}`;
		expect(isBytosFreeModelLimitMessage(error)).toBe(true);
		expect(extractBytosFreeModelLimitResetTime(error)).toBe("23h 59m");
	});

	it("does not match unrelated daily limits", () => {
		expect(
			isBytosFreeModelLimitMessage(
				"Your daily spend limit has been reached. Try again in 23h 59m",
			),
		).toBe(false);
	});
});
