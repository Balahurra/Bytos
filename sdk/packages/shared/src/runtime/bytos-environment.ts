export const BYTOS_ENVIRONMENT_ENV = "BYTOS_ENVIRONMENT";
export const BYTOS_ENVIRONMENT_OVERRIDE_ENV = "BYTOS_ENVIRONMENT_OVERRIDE";

export type BytosEnvironment = "production" | "staging" | "local";

export interface BytosEnvironmentConfig {
	readonly environment: BytosEnvironment;
	readonly appBaseUrl: string;
	readonly apiBaseUrl: string;
	readonly mcpBaseUrl: string;
	readonly workOsClientId: string;
}

export const BYTOS_ENVIRONMENTS: Readonly<
	Record<BytosEnvironment, BytosEnvironmentConfig>
> = {
	production: {
		environment: "production",
		appBaseUrl: "https://app.bytos.dev",
		apiBaseUrl: "https://api.bytos.dev",
		mcpBaseUrl: "https://api.bytos.dev/v1/mcp",
		workOsClientId: "client_01K3A541FN8TA3EPPHTD2325AR",
	},
	staging: {
		environment: "staging",
		appBaseUrl: "https://staging-app.bytos.dev",
		apiBaseUrl: "https://core-api.staging.int.bytos.dev",
		mcpBaseUrl: "https://core-api.staging.int.bytos.dev/v1/mcp",
		workOsClientId: "client_01K3A5415VF6QBQBG3XYCW91G6",
	},
	local: {
		environment: "local",
		appBaseUrl: "http://localhost:3000",
		apiBaseUrl: "http://localhost:7777",
		mcpBaseUrl: "http://localhost:7777/v1/mcp",
		workOsClientId: "client_01K6XQAY7JK6T5HXVSZW2S5VYK",
	},
};

export const DEFAULT_BYTOS_ENVIRONMENT: BytosEnvironment = "production";

export interface ResolveBytosEnvironmentOptions {
	env?: Partial<NodeJS.ProcessEnv>;
}

function normalizeBytosEnvironment(
	value: string | undefined,
): BytosEnvironment | undefined {
	const normalized = value?.trim().toLowerCase();
	if (
		normalized === "production" ||
		normalized === "staging" ||
		normalized === "local"
	) {
		return normalized;
	}
	return undefined;
}

function readProcessEnv(): NodeJS.ProcessEnv {
	// `process` may be absent in browser-style runtimes (this module ships
	// from the browser entry of `@bytos/shared`). Treat its absence as "no
	// env vars set" so callers always get a deterministic default.
	if (typeof process === "undefined" || !process?.env) {
		return {};
	}
	return process.env;
}

export function resolveBytosEnvironment(): BytosEnvironment {
	const env = readProcessEnv();
	return (
		normalizeBytosEnvironment(env[BYTOS_ENVIRONMENT_OVERRIDE_ENV]) ??
		normalizeBytosEnvironment(env[BYTOS_ENVIRONMENT_ENV]) ??
		DEFAULT_BYTOS_ENVIRONMENT
	);
}

function getEnvConfig(env?: BytosEnvironment) {
	if (typeof env === "string") {
		return BYTOS_ENVIRONMENTS[env];
	}
	return BYTOS_ENVIRONMENTS[resolveBytosEnvironment()];
}

function applyConfigOverrides(
	config: BytosEnvironmentConfig,
	env: NodeJS.ProcessEnv,
): BytosEnvironmentConfig {
	if (env.BYTOS_API_BASE_URL) {
		config = {
			...config,
			apiBaseUrl: env.BYTOS_API_BASE_URL,
			mcpBaseUrl: `${env.BYTOS_API_BASE_URL}/v1/mcp`,
		};
	}

	return config;
}

export function getBytosEnvironmentConfig(
	env?: BytosEnvironment,
): BytosEnvironmentConfig {
	const config = getEnvConfig(env);

	return applyConfigOverrides(config, readProcessEnv());
}
