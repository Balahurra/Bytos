import { isBytosFreeModelLimitMessage, isBytosModelNotFoundMessage } from "@bytos/llms"
import { serializeError } from "serialize-error"
import { BYTOS_ACCOUNT_AUTH_ERROR_MESSAGE } from "../../shared/BytosAccount"

export enum BytosErrorType {
	Auth = "auth",
	RateLimit = "rateLimit",
	Balance = "balance",
	SpendLimit = "spendLimit",
	QuotaExceeded = "quotaExceeded",
	BytosFreeModelLimit = "bytosFreeModelLimit",
	BytosFreePromotionEnded = "bytosFreePromotionEnded",
	/** HTTP 404/405/410: the model id or endpoint path does not exist on the server. */
	NotFound = "notFound",
}

/**
 * Recovery guidance for a model-or-endpoint-not-found answer. Shared by the
 * host-side message rewrite (text-matched, since the SDK strips the HTTP
 * status before the host sees the error) and the webview's status-based
 * NotFound row, so a message that already carries it is not told twice.
 */
export const MODEL_NOT_FOUND_GUIDANCE =
	"The model may be retired or unavailable on your account, or the model ID or base URL may be wrong. Check the model ID and base URL in API Configuration settings, or switch to a different model, then retry."

// Status families with a dedicated UI. Everything else in 4xx stays on the
// generic row, which shows the real status and message. 407 is deliberately
// not Auth: it is the proxy rejecting credentials, not the provider, and the
// sign-in card would point the user at the wrong account.
const AUTH_STATUSES = new Set([401, 403])
const PAYMENT_REQUIRED_STATUS = 402
const NOT_FOUND_STATUSES = new Set([404, 405, 410])

export const BYTOS_FREE_MODEL_ID_PREFIX = "bytos-free/"
/** Error code stamped by the host when it detects a retired free model (see message-translator). */
export const BYTOS_FREE_PROMOTION_ENDED_ERROR_CODE = "bytos_free_promotion_ended"

/**
 * Detects a request against a retired free model: once a promotion ends the
 * bytos-free/ model is removed from the catalog and the backend answers "model
 * not found". The modelId gate keeps ordinary model-not-found errors on their
 * generic path. Mirrors the CLI's detection in apps/cli/src/utils/cline-pass-errors.ts.
 */
export function isBytosFreePromotionEndedMessage(message: string, modelId?: string): boolean {
	if (!modelId?.toLowerCase().startsWith(BYTOS_FREE_MODEL_ID_PREFIX)) {
		return false
	}
	return isBytosModelNotFoundMessage(message)
}

interface ErrorDetails {
	/**
	 * The HTTP status code of the error, if applicable.
	 */
	status?: number
	/**
	 * The request ID associated with the error, if available.
	 * This can be useful for debugging and support.
	 */
	request_id?: string
	/**
	 * Specific error code provided by the API or service.
	 */
	code?: string
	/**
	 * The model ID associated with the error, if applicable.
	 * This is useful for identifying which model the error relates to.
	 */
	modelId?: string
	/**
	 * The provider ID associated with the error, if applicable.
	 * This is useful for identifying which provider the error relates to.
	 */
	providerId?: string
	/**
	 * The error message associated with the error, if applicable.
	 */
	message?: string
	// Additional details that might be present in the error
	// This can include things like current balance, error messages, etc.
	details?: any
}

const RATE_LIMIT_PATTERNS = [/status code 429/i, /rate limit/i, /too many requests/i, /quota exceeded/i, /resource exhausted/i]

export class BytosError extends Error {
	readonly title = "BytosError"
	readonly _error: ErrorDetails

	// Error details per providers:
	// Bytos: error?.error
	// Ollama: error?.cause
	// tbc
	constructor(
		raw: any,
		public readonly modelId?: string,
		public readonly providerId?: string,
	) {
		const error = serializeError(raw)

		const message = error.message || error?.response?.message || String(error) || error?.cause?.means
		super(message)

		// Extract status from multiple possible locations
		const status = error.status || error.statusCode || error.response?.status
		this.modelId = modelId || error.modelId
		this.providerId = providerId || error.providerId

		// Construct the error details object to includes relevant information
		// And ensure it has a consistent structure
		this._error = {
			...error,
			message: raw.message || message,
			status,
			request_id:
				error.error?.request_id ||
				error.request_id ||
				error.response?.request_id ||
				error.response?.headers?.["x-request-id"],
			code: error.code || error?.cause?.code,
			modelId: this.modelId,
			providerId: this.providerId,
			details: error.details || error.error, // Additional details provided by the server
			stack: undefined, // Avoid serializing stack trace to keep the error object clean
		}
	}

	/**
	 *  Serializes the error to a JSON string that allows for easy transmission and storage.
	 *  This is useful for logging or sending error details to a webviews.
	 */
	public serialize(): string {
		return JSON.stringify({
			message: this.message,
			status: this._error.status,
			request_id: this._error.request_id,
			code: this._error.code,
			modelId: this.modelId,
			providerId: this.providerId,
			details: this._error.details,
		})
	}

	public get status(): number | undefined {
		return this._error.status
	}

	public get requestId(): string | undefined {
		return this._error.request_id
	}

	/**
	 * Parses a stringified error into a BytosError instance.
	 */
	static parse(errorStr?: string, modelId?: string): BytosError | undefined {
		if (!errorStr || typeof errorStr !== "string") {
			return undefined
		}
		return BytosError.transform(errorStr, modelId)
	}

	/**
	 * Transforms any object into a BytosError instance.
	 * Always returns a BytosError, even if the input is not a valid error object.
	 */
	static transform(error: any, modelId?: string, providerId?: string): BytosError {
		try {
			// If already a BytosError, return it directly to prevent infinite recursion
			if (error instanceof BytosError) {
				return error
			}
			return new BytosError(JSON.parse(error), modelId, providerId)
		} catch {
			return new BytosError(error, modelId, providerId)
		}
	}

	public isErrorType(type: BytosErrorType): boolean {
		return BytosError.getErrorType(this) === type
	}

	/**
	 * Is known error type based on the error code, status, and details.
	 * This is useful for determining how to handle the error in the UI or logic.
	 */
	static getErrorType(err: BytosError): BytosErrorType | undefined {
		const { code, status, details } = err._error
		const rawMessage = err._error?.message || err.message || JSON.stringify(err._error)
		const message = rawMessage?.toLowerCase()
		const detailMessage = typeof details?.message === "string" ? details.message : undefined

		// Check balance error first (most specific)
		if (code === "insufficient_credits" && typeof details?.current_balance === "number") {
			return BytosErrorType.Balance
		}

		// Check spend limit exceeded (org-enforced budget cap, 429 SPEND_LIMIT_EXCEEDED)
		// Must be checked before the generic rate-limit check since both use 429
		if (code === "SPEND_LIMIT_EXCEEDED" || details?.code === "SPEND_LIMIT_EXCEEDED") {
			return BytosErrorType.SpendLimit
		}

		if (
			(detailMessage ? isBytosFreeModelLimitMessage(detailMessage) : false) ||
			(rawMessage ? isBytosFreeModelLimitMessage(rawMessage) : false)
		) {
			return BytosErrorType.BytosFreeModelLimit
		}

		// Retired free models must be classified before the status branch: the
		// backend's model-not-found answer is a 404.
		if (
			code === BYTOS_FREE_PROMOTION_ENDED_ERROR_CODE ||
			details?.code === BYTOS_FREE_PROMOTION_ENDED_ERROR_CODE ||
			(detailMessage ? isBytosFreePromotionEndedMessage(detailMessage, err.modelId) : false) ||
			(rawMessage ? isBytosFreePromotionEndedMessage(rawMessage, err.modelId) : false)
		) {
			return BytosErrorType.BytosFreePromotionEnded
		}

		// The HTTP status is the provider's own verdict and decides first. Only
		// genuine credential rejections are Auth: labelling every 4xx that way
		// sent users with a wrong model id or base URL (a 404) to the sign-in
		// prompt instead of showing them the real answer. Statuses outside
		// these sets fall through to the wording checks below on purpose:
		// Gemini rejects a bad key with a 400, and only the message says so.
		if (status !== undefined) {
			if (AUTH_STATUSES.has(status)) {
				return BytosErrorType.Auth
			}
			if (status === PAYMENT_REQUIRED_STATUS) {
				return BytosErrorType.Balance
			}
			if (NOT_FOUND_STATUSES.has(status)) {
				return BytosErrorType.NotFound
			}
		}

		// ERR_BAD_REQUEST is axios' code for any 4xx, so it only stands in for
		// an auth failure when no status is available to say otherwise.
		if ((code === "ERR_BAD_REQUEST" && status === undefined) || err instanceof AuthInvalidTokenError) {
			return BytosErrorType.Auth
		}

		if (code === "INFERENCE_CAP_ERROR") {
			return BytosErrorType.QuotaExceeded
		}

		if (message) {
			// Check for specific error codes/messages if applicable
			const authErrorRegex = [/(?:in)?valid[-_ ]?(?:api )?(?:token|key)/i, /authentication[-_ ]?failed/i, /unauthorized/i]
			if (message?.includes(BYTOS_ACCOUNT_AUTH_ERROR_MESSAGE) || authErrorRegex.some((regex) => regex.test(message))) {
				return BytosErrorType.Auth
			}

			// Check rate limit patterns
			const lowerMessage = message.toLowerCase()
			if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(lowerMessage))) {
				return BytosErrorType.RateLimit
			}
		}

		return undefined
	}
}

class AuthInvalidTokenError extends Error {
	constructor(message: string) {
		super(message)
		this.name = BytosErrorType.Auth
	}
}
