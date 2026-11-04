import type { ApiConfiguration } from "@/shared/api"
import { createSecretMask } from "@/shared/storage/secret-mask"
import { SecretKeys } from "@/shared/storage/state-keys"

/**
 * Remove every credential field from the API configuration before it crosses
 * the extension-host → webview boundary.
 *
 * The webview only needs provider/model selection and "is a credential
 * configured" information. Provider forms receive a length-based mask from the
 * provider config RPC; they never receive the secret value itself.
 */
export function redactApiConfigurationForWebview(configuration: ApiConfiguration | undefined): ApiConfiguration | undefined {
	if (!configuration) {
		return configuration
	}
	const redacted: Record<string, unknown> = { ...configuration }
	for (const key of SecretKeys) {
		const value = redacted[key]
		if (typeof value === "string" && value.length > 0) {
			redacted[key] = createSecretMask(value.length)
		} else if (key in redacted) {
			redacted[key] = ""
		}
	}
	return redacted as ApiConfiguration
}
