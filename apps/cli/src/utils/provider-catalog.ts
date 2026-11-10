import {
	listLocalProviders as internalListLocalProviders,
	type ProviderSettingsManager,
} from "@bytos/core";

export async function listLocalProviders(
	manager: ProviderSettingsManager,
): ReturnType<typeof internalListLocalProviders> {
	return await internalListLocalProviders(manager, {
		isClinePassEnabled: true,
	});
}
