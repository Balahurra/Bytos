import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BYTOS_ENVIRONMENT_ENV,
	BYTOS_ENVIRONMENT_OVERRIDE_ENV,
	BYTOS_ENVIRONMENTS,
	DEFAULT_BYTOS_ENVIRONMENT,
	getBytosEnvironmentConfig,
	resolveBytosEnvironment,
} from "./bytos-environment";

const ENV_KEYS = [
	BYTOS_ENVIRONMENT_ENV,
	BYTOS_ENVIRONMENT_OVERRIDE_ENV,
	"BYTOS_API_BASE_URL",
] as const;

const originalEnvValues = Object.fromEntries(
	ENV_KEYS.map((key) => [key, process.env[key]]),
);

beforeEach(() => {
	vi.unstubAllGlobals();
	for (const key of ENV_KEYS) {
		delete process.env[key];
	}
});

afterEach(() => {
	vi.unstubAllGlobals();
	for (const key of ENV_KEYS) {
		const value = originalEnvValues[key];
		if (typeof value === "string") {
			process.env[key] = value;
		} else {
			delete process.env[key];
		}
	}
});

describe("resolveBytosEnvironment", () => {
	it("defaults to production when no env var is set", () => {
		expect(resolveBytosEnvironment()).toBe(DEFAULT_BYTOS_ENVIRONMENT);
	});

	it("reads BYTOS_ENVIRONMENT from process.env", () => {
		process.env[BYTOS_ENVIRONMENT_ENV] = "staging";
		expect(resolveBytosEnvironment()).toBe("staging");

		process.env[BYTOS_ENVIRONMENT_ENV] = "local";
		expect(resolveBytosEnvironment()).toBe("local");
	});

	it("prefers BYTOS_ENVIRONMENT_OVERRIDE over BYTOS_ENVIRONMENT", () => {
		process.env[BYTOS_ENVIRONMENT_OVERRIDE_ENV] = "local";
		process.env[BYTOS_ENVIRONMENT_ENV] = "staging";

		expect(resolveBytosEnvironment()).toBe("local");
	});

	it("normalizes case and surrounding whitespace", () => {
		process.env[BYTOS_ENVIRONMENT_ENV] = "  STAGING  ";

		expect(resolveBytosEnvironment()).toBe("staging");
	});

	it("ignores unknown values and falls through to the next source", () => {
		process.env[BYTOS_ENVIRONMENT_OVERRIDE_ENV] = "qa";
		process.env[BYTOS_ENVIRONMENT_ENV] = "staging";
		expect(resolveBytosEnvironment()).toBe("staging");

		delete process.env[BYTOS_ENVIRONMENT_OVERRIDE_ENV];
		process.env[BYTOS_ENVIRONMENT_ENV] = "qa";
		expect(resolveBytosEnvironment()).toBe(DEFAULT_BYTOS_ENVIRONMENT);
	});

	it("defaults to production when process is unavailable", () => {
		vi.stubGlobal("process", undefined);

		expect(resolveBytosEnvironment()).toBe(DEFAULT_BYTOS_ENVIRONMENT);
	});
});

describe("getBytosEnvironmentConfig", () => {
	it("returns the config for an explicit environment", () => {
		expect(getBytosEnvironmentConfig("staging")).toBe(
			BYTOS_ENVIRONMENTS.staging,
		);
		expect(getBytosEnvironmentConfig("local")).toBe(BYTOS_ENVIRONMENTS.local);
		expect(getBytosEnvironmentConfig("production")).toBe(
			BYTOS_ENVIRONMENTS.production,
		);
	});

	it("falls back to production by default", () => {
		expect(getBytosEnvironmentConfig()).toBe(BYTOS_ENVIRONMENTS.production);
	});

	it("uses the resolved process.env environment when no explicit environment is provided", () => {
		process.env[BYTOS_ENVIRONMENT_ENV] = "staging";

		expect(getBytosEnvironmentConfig()).toBe(BYTOS_ENVIRONMENTS.staging);
	});

	it("applies BYTOS_API_BASE_URL without mutating the catalog config", () => {
		process.env.BYTOS_API_BASE_URL = "http://127.0.0.1:3000";

		expect(getBytosEnvironmentConfig("local")).toEqual({
			...BYTOS_ENVIRONMENTS.local,
			apiBaseUrl: "http://127.0.0.1:3000",
			mcpBaseUrl: "http://127.0.0.1:3000/v1/mcp",
		});
		expect(BYTOS_ENVIRONMENTS.local.apiBaseUrl).toBe("http://localhost:7777");
	});

	it("defaults to production when process is unavailable", () => {
		vi.stubGlobal("process", undefined);

		expect(getBytosEnvironmentConfig()).toBe(BYTOS_ENVIRONMENTS.production);
	});
});

describe("BYTOS_ENVIRONMENTS catalog", () => {
	it("exposes an environment field that matches its key", () => {
		for (const [key, config] of Object.entries(BYTOS_ENVIRONMENTS)) {
			expect(config.environment).toBe(key);
		}
	});

	it("populates appBaseUrl, apiBaseUrl, and mcpBaseUrl for every environment", () => {
		for (const config of Object.values(BYTOS_ENVIRONMENTS)) {
			expect(config.appBaseUrl).toMatch(/^https?:\/\//);
			expect(config.apiBaseUrl).toMatch(/^https?:\/\//);
			expect(config.mcpBaseUrl).toMatch(/^https?:\/\//);
		}
	});
});
