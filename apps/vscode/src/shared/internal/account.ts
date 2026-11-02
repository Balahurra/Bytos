/**
 * List of email domains that are considered trusted testers for Bytos.
 */
const BYTOS_TRUSTED_TESTER_DOMAINS = ["fibilabs.tech"]

/**
 * Checks if the given email belongs to a Bytos bot user.
 * E.g. Emails ending with @bytos.dev
 */
function isBytosBotUser(email: string): boolean {
	return email.endsWith("@bytos.dev")
}

export function isBytosInternalTester(email: string): boolean {
	return isBytosBotUser(email) || BYTOS_TRUSTED_TESTER_DOMAINS.some((d) => email.endsWith(`@${d}`))
}
