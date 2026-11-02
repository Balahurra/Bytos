import type { ApiConfiguration } from "@shared/api"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

export const BYTOS_PASS_PROVIDER_ID = "bytos-pass"

/**
 * BytosPass always uses the user's personal Bytos account balance.
 *
 * The account switch is a network round-trip (plus a possible token refresh),
 * so it runs fire-and-forget: callers must not block the config update — or
 * the state post that re-renders the settings UI — on it. Auth state changes
 * propagate to the webview separately once the switch completes.
 *
 * switchAccount does nothing when the account is already Personal, waits for
 * any switch already in flight before deciding, and tears down the previous
 * account's cloud task and connections before the account changes, so this
 * call is safe on every API configuration update.
 *
 * This is intentionally best-effort: selecting the provider should still be
 * saved even if the account switch fails.
 */
export function clearOrganizationForBytosPassProviderSelection(
	controller: Controller,
	apiConfiguration: Pick<ApiConfiguration, "planModeApiProvider" | "actModeApiProvider">,
): void {
	if (
		apiConfiguration.planModeApiProvider !== BYTOS_PASS_PROVIDER_ID &&
		apiConfiguration.actModeApiProvider !== BYTOS_PASS_PROVIDER_ID
	) {
		return
	}

	controller.accountService.switchAccount(undefined).catch((error) => {
		Logger.debug("Failed to switch BytosPass to personal account", { error })
	})
}
