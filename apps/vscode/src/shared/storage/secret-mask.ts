/**
 * Mask used when a credential is known to exist but must not be sent to the
 * webview. The webview uses the same character to render a saved credential
 * and to detect "unchanged" input.
 */
export const SAVED_SECRET_MASK_CHARACTER = "\u2022"

export function isSecretMaskOnly(value: unknown): boolean {
	return typeof value === "string" && value.length > 0 && [...value].every((char) => char === SAVED_SECRET_MASK_CHARACTER)
}

export function createSecretMask(length: number): string {
	return SAVED_SECRET_MASK_CHARACTER.repeat(Math.max(0, length))
}

/** Remove mask characters from an edited credential field. */
export function stripSecretMask(value: string): string {
	return value.split(SAVED_SECRET_MASK_CHARACTER).join("")
}
