import { FeatureFlag } from "@bytos/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	accountId: "account-1" as string | undefined,
	getAllFlagsAndPayloads: vi.fn(),
	dispose: vi.fn(async () => {}),
}));

vi.mock("../storage/provider-settings-manager", () => ({
	ProviderSettingsManager: class {
		getProviderSettings() {
			return { auth: { accountId: mocks.accountId, email: "dev@bytos.dev" } };
		}
	},
}));
vi.mock("@bytos/core/services/feature-flags/posthog", () => ({
	buildBytosPostHogClient: vi.fn(() => ({})),
	PostHogFeatureFlagsProvider: class {
		getAllFlagsAndPayloads = mocks.getAllFlagsAndPayloads;
		dispose = mocks.dispose;
	},
}));

import { isBytosAccountFeatureEnabled } from "./bytos-account-feature-flags";

const flag = FeatureFlag.BYTOS_COMPOSIO_BETA;

beforeEach(async () => {
	vi.clearAllMocks();
	vi.stubEnv("TELEMETRY_SERVICE_API_KEY", "test-key");
	mocks.accountId = undefined;
	await isBytosAccountFeatureEnabled(flag); // clear the previous identity
	mocks.accountId = "account-1";
	mocks.getAllFlagsAndPayloads.mockResolvedValue({
		featureFlags: { [flag]: true },
	});
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

describe("Bytos account beta flags", () => {
	it.each([
		false,
		undefined,
		"true",
		"beta",
		1,
	])("denies %s even for an internal email", async (value) => {
		mocks.getAllFlagsAndPayloads.mockResolvedValue({
			featureFlags: { [flag]: value },
		});
		expect(await isBytosAccountFeatureEnabled(flag)).toBe(false);
	});

	it("requires the actual flag, not a truthy payload", async () => {
		mocks.getAllFlagsAndPayloads.mockResolvedValue({
			featureFlags: { [flag]: false },
			featureFlagPayloads: { [flag]: true },
		});
		expect(await isBytosAccountFeatureEnabled(flag)).toBe(false);
	});

	it("evaluates by account ID and shares concurrent evaluations", async () => {
		expect(
			await Promise.all([
				isBytosAccountFeatureEnabled(flag),
				isBytosAccountFeatureEnabled(flag),
			]),
		).toEqual([true, true]);
		expect(mocks.getAllFlagsAndPayloads).toHaveBeenCalledOnce();
		expect(mocks.getAllFlagsAndPayloads).toHaveBeenCalledWith({
			flagKeys: expect.arrayContaining([flag]),
			context: { distinctId: "account-1", userId: "account-1" },
		});
		expect(mocks.dispose).toHaveBeenCalledOnce();
	});

	it("denies signed-out accounts and missing provider configuration", async () => {
		mocks.accountId = undefined;
		expect(await isBytosAccountFeatureEnabled(flag)).toBe(false);
		mocks.accountId = "account-1";
		vi.stubEnv("TELEMETRY_SERVICE_API_KEY", "");
		expect(await isBytosAccountFeatureEnabled(flag)).toBe(false);
		expect(mocks.getAllFlagsAndPayloads).not.toHaveBeenCalled();
	});

	it("does not transfer grants to another account or across sign-out", async () => {
		expect(await isBytosAccountFeatureEnabled(flag)).toBe(true);
		mocks.accountId = "account-2";
		mocks.getAllFlagsAndPayloads.mockResolvedValue({});
		expect(await isBytosAccountFeatureEnabled(flag)).toBe(false);
		mocks.accountId = undefined;
		expect(await isBytosAccountFeatureEnabled(flag)).toBe(false);
		mocks.accountId = "account-1";
		expect(await isBytosAccountFeatureEnabled(flag)).toBe(false);
	});

	it("rejects an evaluation completed after the account changes", async () => {
		let complete!: (value: unknown) => void;
		mocks.getAllFlagsAndPayloads.mockReturnValue(
			new Promise((resolve) => {
				complete = resolve;
			}),
		);
		const pending = isBytosAccountFeatureEnabled(flag);
		mocks.accountId = "account-2";
		complete({ featureFlags: { [flag]: true } });
		expect(await pending).toBe(false);
	});

	it("refreshes cached grants after one minute", async () => {
		vi.useFakeTimers();
		expect(await isBytosAccountFeatureEnabled(flag)).toBe(true);
		mocks.getAllFlagsAndPayloads.mockResolvedValue({
			featureFlags: { [flag]: false },
		});
		vi.advanceTimersByTime(60_001);
		expect(await isBytosAccountFeatureEnabled(flag)).toBe(false);
	});

	it("fails closed on a provider failure and disposes its client", async () => {
		mocks.getAllFlagsAndPayloads.mockRejectedValue(new Error("offline"));
		expect(await isBytosAccountFeatureEnabled(flag)).toBe(false);
		expect(mocks.dispose).toHaveBeenCalledOnce();
	});
});
