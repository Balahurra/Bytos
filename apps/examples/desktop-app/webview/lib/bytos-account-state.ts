// Shared between the sidecar (which produces this result) and the webview
// (which consumes it), like the desktop transport types.

/**
 * Typed result the `bytos_account` sidecar command returns when no Bytos
 * account credentials exist. Being signed out is an expected state, so it
 * travels as a structured response instead of a thrown error: it must not be
 * reported to error telemetry or rendered as a raw error string.
 */
export const BYTOS_ACCOUNT_NOT_AUTHENTICATED_CODE =
	"ACCOUNT_NOT_AUTHENTICATED" as const;

export type BytosAccountNotAuthenticatedResult = {
	signedIn: false;
	code: typeof BYTOS_ACCOUNT_NOT_AUTHENTICATED_CODE;
};

export const BYTOS_ACCOUNT_NOT_AUTHENTICATED_RESULT: BytosAccountNotAuthenticatedResult =
	{
		signedIn: false,
		code: BYTOS_ACCOUNT_NOT_AUTHENTICATED_CODE,
	};

export function isBytosAccountNotAuthenticatedResult(
	value: unknown,
): value is BytosAccountNotAuthenticatedResult {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as BytosAccountNotAuthenticatedResult).code ===
			BYTOS_ACCOUNT_NOT_AUTHENTICATED_CODE &&
		(value as BytosAccountNotAuthenticatedResult).signedIn === false
	);
}
