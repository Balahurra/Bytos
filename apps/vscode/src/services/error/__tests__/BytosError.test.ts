import { describe, it } from "bun:test"
import "should"
import { BytosError, BytosErrorType } from "../BytosError"

describe("BytosError", () => {
	describe("getErrorType", () => {
		it("should return QuotaExceeded when code is INFERENCE_CAP_ERROR", () => {
			const err = new BytosError({ message: "Inference cap reached", code: "INFERENCE_CAP_ERROR" })
			BytosError.getErrorType(err)!.should.equal(BytosErrorType.QuotaExceeded)
		})

		it("should classify daily Bytos free model limits separately", () => {
			const err = new BytosError(
				"Error: Error 429: Daily free limit reached on model deepseek/deepseek-v4-flash. Try again in 23h 59m",
			)

			BytosError.getErrorType(err)!.should.equal(BytosErrorType.BytosFreeModelLimit)
		})

		it("should classify the host-stamped promotion-ended code as BytosFreePromotionEnded", () => {
			// reshapeErrorForWebview stamps this code when the active model is a
			// retired bytos-free/ id (see message-translator).
			const err = new BytosError({
				message: "Model not found",
				code: "bytos_free_promotion_ended",
			})

			BytosError.getErrorType(err)!.should.equal(BytosErrorType.BytosFreePromotionEnded)
		})

		it("should classify model-not-found for a bytos-free model as BytosFreePromotionEnded", () => {
			const err = new BytosError({ message: "Error 404: Model not found" }, "bytos-free/glm-5")

			BytosError.getErrorType(err)!.should.equal(BytosErrorType.BytosFreePromotionEnded)
		})

		it("should prefer BytosFreePromotionEnded over Auth for a 404 with a bytos-free model", () => {
			// A 404 falls inside the generic 401-428 auth-status range; the
			// promotion-ended classification must win.
			const err = new BytosError({ message: "Error 404: Model not found", status: 404 }, "bytos-free/glm-5")

			const result = BytosError.getErrorType(err)
			result!.should.equal(BytosErrorType.BytosFreePromotionEnded)
		})

		it("should keep model-not-found for a non-free model on the generic path", () => {
			const err = new BytosError({ message: "Error 404: Model not found", status: 404 }, "deepseek/deepseek-v4-flash")

			const result = BytosError.getErrorType(err)
			;(result !== BytosErrorType.BytosFreePromotionEnded).should.be.true()
		})

		it("should not classify unrelated bytos-free errors as BytosFreePromotionEnded", () => {
			const err = new BytosError({ message: "Network error: socket hang up" }, "bytos-free/glm-5")

			const result = BytosError.getErrorType(err)
			;(result !== BytosErrorType.BytosFreePromotionEnded).should.be.true()
		})

		describe("HTTP status", () => {
			// A BYOK provider answering with a bare status: the message carries
			// no auth / rate-limit wording, so the status alone decides.
			const withStatus = (status: number, message = `Request failed with status code ${status}`) =>
				new BytosError({ message, status }, "qwen3-coder", "openai-compatible")

			it("classifies 401 and 403 as Auth", () => {
				for (const status of [401, 403]) {
					BytosError.getErrorType(withStatus(status))!.should.equal(BytosErrorType.Auth)
				}
			})

			it("leaves 407 on the generic row: the proxy rejected credentials, not the provider", () => {
				;(BytosError.getErrorType(withStatus(407)) === undefined).should.be.true()
			})

			it("classifies 402 as Balance, not Auth", () => {
				BytosError.getErrorType(withStatus(402))!.should.equal(BytosErrorType.Balance)
			})

			it("classifies 404, 405 and 410 as NotFound, not Auth", () => {
				for (const status of [404, 405, 410]) {
					BytosError.getErrorType(withStatus(status))!.should.equal(BytosErrorType.NotFound)
				}
			})

			it("leaves 400, 413 and 422 unclassified so the generic row shows the real status", () => {
				for (const status of [400, 413, 422]) {
					;(BytosError.getErrorType(withStatus(status)) === undefined).should.be.true()
				}
			})

			it("still classifies 429 by its rate-limit wording", () => {
				BytosError.getErrorType(withStatus(429, "Error 429: Too many requests"))!.should.equal(BytosErrorType.RateLimit)
			})

			it("lets the HTTP status override axios' ERR_BAD_REQUEST code", () => {
				// axios stamps ERR_BAD_REQUEST on every 4xx; a 404 carrying it is
				// still a not-found answer.
				const err = new BytosError({
					message: "Request failed with status code 404",
					status: 404,
					code: "ERR_BAD_REQUEST",
				})

				BytosError.getErrorType(err)!.should.equal(BytosErrorType.NotFound)
			})

			it("keeps ERR_BAD_REQUEST without a status as Auth", () => {
				const err = new BytosError({ message: "Request failed", code: "ERR_BAD_REQUEST" })

				BytosError.getErrorType(err)!.should.equal(BytosErrorType.Auth)
			})

			it("keeps message-based auth detection for status-less errors", () => {
				BytosError.getErrorType(new BytosError("Invalid API key"))!.should.equal(BytosErrorType.Auth)
			})

			it("keeps message-based auth detection for statuses outside the dedicated sets", () => {
				// Gemini answers an invalid key with HTTP 400, not 401; only the
				// wording identifies it as a credential problem.
				const err = new BytosError(
					{ message: "API key not valid. Please pass a valid API key.", status: 400 },
					"gemini-2.5-pro",
					"gemini",
				)

				BytosError.getErrorType(err)!.should.equal(BytosErrorType.Auth)
			})

			it("classifies a serialized 404 payload parsed by the webview as NotFound", () => {
				// llama-swap answers 404 for a model id it no longer serves.
				const payload = JSON.stringify({
					message: 'model "qwen3-coder" not found',
					status: 404,
					providerId: "openai-compatible",
				})

				const err = BytosError.parse(payload)!
				BytosError.getErrorType(err)!.should.equal(BytosErrorType.NotFound)
				err.isErrorType(BytosErrorType.Auth).should.be.false()
			})
		})
	})
})
