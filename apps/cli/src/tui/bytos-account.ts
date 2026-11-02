import {
	type BytosAccountBalance,
	type BytosAccountOrganization,
	type BytosAccountOrganizationBalance,
	BytosAccountService,
	type BytosAccountUser,
	type BytosSubscriptionPlan,
	formatProviderOAuthApiKey,
	getPersistedProviderApiKey,
	getProviderOAuthCredentialsFromSettings,
	getValidBytosCredentials,
	type ProviderSettings,
	ProviderSettingsManager,
	persistBytosAccountTelemetryIdentity,
	resolveBytosAccountTelemetryIdentity,
	saveLocalProviderOAuthCredentials,
	type UserCurrentPlan,
} from "@bytos/core";
import { getBytosEnvironmentConfig } from "@bytos/shared";
import { formatCreditBalance, normalizeCreditBalance } from "../utils/output";
import { identifyTelemetryAccount } from "../utils/telemetry";
import type { Config } from "../utils/types";

export const BYTOS_CREDITS_DASHBOARD_URL =
	"https://app.bytos.dev/dashboard/account?tab=credits";

type BytosAccountConfig = Pick<Config, "apiKey" | "logger" | "providerId">;

const BYTOS_PASS_PROVIDER_ID = "bytos-pass";

export interface BytosAccountSnapshot {
	user: BytosAccountUser;
	balance: BytosAccountBalance;
	organizationBalance: BytosAccountOrganizationBalance | null;
	organizations: BytosAccountOrganization[];
	activeOrganization: BytosAccountOrganization | null;
	displayedBalance: number;
}

export function formatBytosCredits(value: number): string {
	return formatCreditBalance(normalizeCreditBalance(value));
}

// FIXME: These message checks are temporary until structured error types are
// passed through to the CLI instead of plain error strings.
export function isBytosAccountAuthErrorMessage(message: string): boolean {
	const normalized = message.trim().toLowerCase();
	return (
		normalized === "no bytos account auth token found" ||
		normalized.includes("requires re-authentication")
	);
}

export function isBytosAccountCreditsErrorMessage(message: string): boolean {
	const normalized = message.trim().toLowerCase();
	// The Bytos API's 402 response carries `code: "insufficient_credits"` and
	// the message "Not enough credits available". Depending on how much of the
	// payload survives error extraction, the CLI may see the raw JSON blob or
	// just the human-readable message, so match both. The
	// "insufficient balance" pair is an older backend phrasing kept for safety.
	return (
		normalized.includes("insufficient_credits") ||
		normalized.includes("not enough credits") ||
		(normalized.includes("insufficient balance") &&
			normalized.includes("bytos credits balance"))
	);
}

function resolveAccountApiBaseUrl(input: {
	bytosApiBaseUrl?: string;
	bytosProviderSettings?: ProviderSettings;
}): string {
	const settingsBaseUrl = input.bytosProviderSettings?.baseUrl?.trim();
	if (settingsBaseUrl) {
		return settingsBaseUrl;
	}
	const configuredBaseUrl = input.bytosApiBaseUrl?.trim();
	if (configuredBaseUrl) {
		return configuredBaseUrl;
	}
	return getBytosEnvironmentConfig().apiBaseUrl;
}

function resolveBytosAccountAuthToken(input: {
	config: BytosAccountConfig;
	bytosProviderSettings?: ProviderSettings;
}): string | undefined {
	const configApiKey =
		input.config.providerId === "bytos" ? input.config.apiKey.trim() : "";
	return (
		getPersistedProviderApiKey("bytos", input.bytosProviderSettings) ||
		configApiKey ||
		undefined
	);
}

async function resolveValidBytosAccountAuthToken(input: {
	config: BytosAccountConfig;
	bytosProviderSettings?: ProviderSettings;
	manager: ProviderSettingsManager;
	apiBaseUrl: string;
}): Promise<string | undefined> {
	const settings = input.bytosProviderSettings;
	const credentials = settings
		? getProviderOAuthCredentialsFromSettings("bytos", settings)
		: null;
	if (settings && credentials) {
		const nextCredentials = await getValidBytosCredentials(credentials, {
			apiBaseUrl: input.apiBaseUrl,
		});
		if (!nextCredentials) {
			throw new Error(
				"Bytos account requires re-authentication. Run bytos auth bytos.",
			);
		}
		const nextAccessToken = formatProviderOAuthApiKey("bytos", nextCredentials);
		if (nextCredentials !== credentials) {
			saveLocalProviderOAuthCredentials(
				input.manager,
				"bytos",
				settings,
				nextCredentials,
				{ setLastUsed: false },
			);
		}
		return nextAccessToken;
	}
	return resolveBytosAccountAuthToken({
		config: input.config,
		bytosProviderSettings: settings,
	});
}

export async function createBytosAccountService(input: {
	config: BytosAccountConfig;
	bytosApiBaseUrl?: string;
	bytosProviderSettings?: ProviderSettings;
	providerSettingsManager?: ProviderSettingsManager;
}): Promise<BytosAccountService | undefined> {
	const manager =
		input.providerSettingsManager ?? new ProviderSettingsManager();
	const settings =
		manager.getProviderSettings("bytos") ?? input.bytosProviderSettings;
	const apiBaseUrl = resolveAccountApiBaseUrl({
		bytosApiBaseUrl: input.bytosApiBaseUrl,
		bytosProviderSettings: settings,
	});
	const authToken = await resolveValidBytosAccountAuthToken({
		config: input.config,
		bytosProviderSettings: settings,
		manager,
		apiBaseUrl,
	});
	if (!authToken) {
		return undefined;
	}
	return new BytosAccountService({
		apiBaseUrl,
		getAuthToken: async () => authToken,
	});
}

export async function loadBytosAccountSnapshot(input: {
	config: BytosAccountConfig;
	bytosApiBaseUrl?: string;
	bytosProviderSettings?: ProviderSettings;
}): Promise<BytosAccountSnapshot> {
	const service = await createBytosAccountService(input);
	if (!service) {
		throw new Error("No Bytos account auth token found");
	}

	const user = await service.fetchMe();
	const organizations = user.organizations ?? [];
	const activeOrganization =
		organizations.find((organization) => organization.active) ?? null;
	const [balance, organizationBalance] = await Promise.all([
		service.fetchBalance(user.id),
		activeOrganization
			? service.fetchOrganizationBalance(activeOrganization.organizationId)
			: Promise.resolve(null),
	]);
	const displayedBalance = activeOrganization
		? (organizationBalance?.balance ?? balance.balance)
		: balance.balance;
	const accountContext = resolveBytosAccountTelemetryIdentity(user);
	identifyTelemetryAccount(accountContext, input.config.logger);
	persistBytosAccountTelemetryIdentity(
		new ProviderSettingsManager(),
		accountContext,
	);

	return {
		user,
		balance,
		organizationBalance,
		organizations,
		activeOrganization,
		displayedBalance,
	};
}

export async function switchBytosAccount(input: {
	config: BytosAccountConfig;
	organizationId?: string | null;
	bytosApiBaseUrl?: string;
	bytosProviderSettings?: ProviderSettings;
}): Promise<void> {
	const service = await createBytosAccountService(input);
	if (!service) {
		throw new Error("No Bytos account auth token found");
	}
	await service.switchAccount(input.organizationId);
}

export async function loadIndividualSubscriptionPlans(input: {
	config: BytosAccountConfig;
	bytosApiBaseUrl?: string;
	bytosProviderSettings?: ProviderSettings;
}): Promise<BytosSubscriptionPlan[]> {
	const service = await createBytosAccountService(input);
	if (!service) {
		throw new Error("No Bytos account auth token found");
	}
	return service.fetchAvailableSubscriptionPlans({ type: "individual" });
}

export async function loadCurrentUserPlan(input: {
	config: BytosAccountConfig;
	bytosApiBaseUrl?: string;
	bytosProviderSettings?: ProviderSettings;
}): Promise<UserCurrentPlan | undefined> {
	const service = await createBytosAccountService(input);
	if (!service) {
		throw new Error("No Bytos account auth token found");
	}
	return service.fetchCurrentUserPlan();
}

export async function loadCurrentUserPlanFromProviderSettings(input: {
	providerSettingsManager: ProviderSettingsManager;
	bytosApiBaseUrl?: string;
}): Promise<UserCurrentPlan | undefined> {
	const service = await createBytosAccountService({
		config: { apiKey: "", logger: undefined, providerId: "bytos" },
		bytosApiBaseUrl: input.bytosApiBaseUrl,
		providerSettingsManager: input.providerSettingsManager,
	});
	if (!service) {
		throw new Error("No Bytos account auth token found");
	}
	return service.fetchCurrentUserPlan();
}

export async function loadIndividualSubscriptionPlansFromProviderSettings(input: {
	providerSettingsManager: ProviderSettingsManager;
	bytosApiBaseUrl?: string;
}): Promise<BytosSubscriptionPlan[]> {
	const service = await createBytosAccountService({
		config: { apiKey: "", logger: undefined, providerId: "bytos" },
		bytosApiBaseUrl: input.bytosApiBaseUrl,
		providerSettingsManager: input.providerSettingsManager,
	});
	if (!service) {
		throw new Error("No Bytos account auth token found");
	}
	return service.fetchAvailableSubscriptionPlans({ type: "individual" });
}

async function onChangeToBytosPass(config: BytosAccountConfig) {
	try {
		await switchBytosAccount({
			config: config,
			organizationId: null,
		});
	} catch (error) {
		config.logger?.debug("Failed to switch BytosPass to personal account", {
			error,
		});
	}
}

export async function onProviderChange(input: {
	config: BytosAccountConfig;
	providerId: string;
}): Promise<void> {
	if (input.providerId === BYTOS_PASS_PROVIDER_ID) {
		return onChangeToBytosPass(input.config);
	}

	return;
}
