import { useCallback, useMemo } from "react"
import { buildBytosPassSubscribeUrl, buildBytosPassSubscriptionPageUrl } from "@/components/onboarding/bytosPassSubscribe"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { useBytosAuth } from "@/context/BytosAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"

export const BYTOS_PASS_PROVIDER_ID = "bytos-pass"

/**
 * Shared state + actions for the BytosPass promotional surfaces (home banner,
 * account page card, settings provider hint). Promotions are hidden in
 * self-hosted mode (BytosPass is a cloud subscription) and behind org
 * remote-config provider allowlists so they never offer a provider the
 * organization disallows.
 */
export function useBytosPassPromo() {
	const { apiConfiguration, environment, navigateToSettings, remoteConfigSettings, mode, planActSeparateModelsSetting } =
		useExtensionState()
	const { bytosUser } = useBytosAuth()
	const { handleModeFieldChange } = useApiConfigurationHandlers()

	const isSelfHostedOrUnknown = !environment || environment === "selfHosted"
	const remoteProviders: string[] = remoteConfigSettings?.remoteConfiguredProviders || []
	const isBlockedByRemoteConfig = remoteProviders.length > 0 && !remoteProviders.includes(BYTOS_PASS_PROVIDER_ID)
	const isBytosPassEnabled = !isSelfHostedOrUnknown && !isBlockedByRemoteConfig

	// Mirrors the switch action's scope: with separate plan/act models the
	// promos only affect (and therefore only reflect) the current mode.
	const currentModeProvider = mode === "plan" ? apiConfiguration?.planModeApiProvider : apiConfiguration?.actModeApiProvider
	const isUsingBytosPass = planActSeparateModelsSetting
		? currentModeProvider === BYTOS_PASS_PROVIDER_ID
		: apiConfiguration?.planModeApiProvider === BYTOS_PASS_PROVIDER_ID ||
			apiConfiguration?.actModeApiProvider === BYTOS_PASS_PROVIDER_ID

	const subscribeUrl = useMemo(() => buildBytosPassSubscribeUrl(bytosUser?.appBaseUrl), [bytosUser?.appBaseUrl])
	const manageSubscriptionUrl = useMemo(() => buildBytosPassSubscriptionPageUrl(bytosUser?.appBaseUrl), [bytosUser?.appBaseUrl])

	const openSubscribePage = useCallback(() => {
		UiServiceClient.openUrl({ value: subscribeUrl }).catch((err) =>
			console.error("Failed to open BytosPass subscribe page:", err),
		)
	}, [subscribeUrl])

	const openManageSubscriptionPage = useCallback(() => {
		UiServiceClient.openUrl({ value: manageSubscriptionUrl }).catch((err) =>
			console.error("Failed to open BytosPass subscription page:", err),
		)
	}, [manageSubscriptionUrl])

	// Selects BytosPass without navigating (for surfaces that already show the
	// provider settings inline). Mirrors the provider dropdown: updates both
	// modes, or only the current mode when plan/act use separate models, so the
	// other mode's provider is never silently overwritten. Returns whether the
	// provider update actually succeeded.
	const selectBytosPassProvider = useCallback(async (): Promise<boolean> => {
		try {
			await handleModeFieldChange({ plan: "planModeApiProvider", act: "actModeApiProvider" }, BYTOS_PASS_PROVIDER_ID, mode)
			return true
		} catch (error) {
			console.error("Failed to switch to BytosPass provider:", error)
			return false
		}
	}, [handleModeFieldChange, mode])

	// Selects BytosPass for both modes and lands the user on the provider
	// settings so they can pick a model / sign in. Only navigates when the
	// provider update succeeded, so a failure doesn't strand the user on the
	// settings page with their old provider still selected.
	const switchToBytosPassProvider = useCallback(async () => {
		if (await selectBytosPassProvider()) {
			navigateToSettings("api-config")
		}
	}, [selectBytosPassProvider, navigateToSettings])

	return {
		isBytosPassEnabled,
		isUsingBytosPass,
		subscribeUrl,
		manageSubscriptionUrl,
		openSubscribePage,
		openManageSubscriptionPage,
		selectBytosPassProvider,
		switchToBytosPassProvider,
	}
}
