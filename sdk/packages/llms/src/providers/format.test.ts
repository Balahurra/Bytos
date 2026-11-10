import { describe, expect, it } from "vitest";
import { extractErrorMessage } from "./format";

describe("extractErrorMessage", () => {
	it("extracts structured provider errors without fallback branches", () => {
		expect(
			extractErrorMessage({
				statusCode: 400,
				responseBody: {
					error: {
						message: "Bad request detail",
					},
				},
				message: "Bad Request",
			}),
		).toBe("Bad request detail");

		expect(
			extractErrorMessage({
				cause: new Error("Nested failure"),
			}),
		).toBe("Nested failure");

		expect(extractErrorMessage(new Error("Plain failure"))).toBe(
			"Plain failure",
		);
	});

	it("preserves native transport error wrappers and cause metadata", () => {
		const socketError = Object.assign(new Error("other side closed"), {
			name: "SocketError",
			code: "UND_ERR_SOCKET",
		});

		expect(
			extractErrorMessage(
				new TypeError("fetch failed", { cause: socketError }),
			),
		).toBe("fetch failed: SocketError: other side closed (UND_ERR_SOCKET)");
	});

	it("prefers nested stream error details over generic wrapper messages", () => {
		expect(
			extractErrorMessage({
				message: "Stream error occurred",
				errors: [
					{
						responseBody: JSON.stringify({
							error: { message: "Missing upstream API key" },
						}),
					},
				],
			}),
		).toBe("Missing upstream API key");
	});

	it("unwraps gateway-forwarded upstream errors from value.error_message", () => {
		// Exact shape streamed by Vercel AI Gateway when the upstream provider
		// (Alibaba Qwen) rejects a request: the gateway's own parse failure sits
		// in message/cause, the real rejection is JSON-encoded in
		// value.error_message.
		const contextLengthMessage =
			"This model's maximum context length is 40960 tokens. However, you requested 100 output tokens and your prompt contains at least 40861 input tokens.";
		expect(
			extractErrorMessage({
				code: "error",
				message: "Stream error occurred",
				name: "AI_TypeValidationError",
				cause: {
					name: "ZodError",
					message:
						'[\n  {\n    "code": "invalid_union",\n    "path": [],\n    "message": "Invalid input"\n  }\n]',
				},
				value: {
					error_type: "validation_error",
					error_message: JSON.stringify({
						error: {
							message: contextLengthMessage,
							code: 400,
						},
					}),
				},
			}),
		).toBe(contextLengthMessage);
	});

	it("handles a plain-string value.error_message", () => {
		expect(
			extractErrorMessage({
				message: "Stream error occurred",
				value: { error_message: "upstream rejected the request" },
			}),
		).toBe("upstream rejected the request");
	});

	it("falls back to JSON instead of [object Object] for opaque objects", () => {
		expect(extractErrorMessage({ status: 502 })).toBe('{"status":502}');
	});
});
