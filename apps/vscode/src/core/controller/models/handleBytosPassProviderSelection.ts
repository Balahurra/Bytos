import type { ApiConfiguration } from "@shared/api"
import type { Controller } from "../index"

export const BYTOS_PASS_PROVIDER_ID = "bytos-pass"

/**
 * ClinePass is the key-based compatibility provider that uses Cline's hosted
 * API. It does not inspect or switch Bytos account organizations; the pasted
 * Cline API key is the only credential. Kept as a named function because all
 * API-configuration write paths call it after a provider change.
 */
export function clearOrganizationForBytosPassProviderSelection(
	_controller: Controller,
	_apiConfiguration: Pick<ApiConfiguration, "planModeApiProvider" | "actModeApiProvider">,
): void {
	// Intentionally empty.
}
