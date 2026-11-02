import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderSettingsManager } from "@bytos/core";
import { afterEach, describe, expect, it } from "vitest";
import {
	getPersistedProviderApiKey,
	isProviderConfigured,
} from "../../../utils/provider-auth";
import {
	buildBytosPassSubscriptionPageUrl,
	resolveOAuthWaitKeyAction,
	saveManualProviderApiKey,
} from "./provider-picker-helpers";

describe("resolveOAuthWaitKeyAction", () => {
	it("switches to manual API key entry on K when the fallback is available", () => {
		expect(resolveOAuthWaitKeyAction({ name: "k" }, true)).toBe("use_api_key");
	});

	it("cancels on K when the fallback is not available", () => {
		expect(resolveOAuthWaitKeyAction({ name: "k" }, false)).toBe("cancel");
	});

	it("cancels on any other unmodified key so users are never stuck waiting on a browser flow", () => {
		for (const name of ["escape", "q", "return", "space", "up", "x"]) {
			expect(resolveOAuthWaitKeyAction({ name }, true)).toBe("cancel");
			expect(resolveOAuthWaitKeyAction({ name }, false)).toBe("cancel");
		}
	});

	it("ignores modifier-held keys so holding Cmd/Ctrl to click the auth link never cancels", () => {
		expect(resolveOAuthWaitKeyAction({ name: "k", ctrl: true }, true)).toBe(
			"ignore",
		);
		expect(resolveOAuthWaitKeyAction({ name: "c", ctrl: true }, false)).toBe(
			"ignore",
		);
		expect(resolveOAuthWaitKeyAction({ name: "x", meta: true }, true)).toBe(
			"ignore",
		);
		expect(resolveOAuthWaitKeyAction({ name: "x", super: true }, false)).toBe(
			"ignore",
		);
		// A bare modifier press (empty name) is ignored, not a cancel.
		expect(resolveOAuthWaitKeyAction({ name: "" }, true)).toBe("ignore");
	});
});

describe("buildBytosPassSubscriptionPageUrl", () => {
	it("opens the personal subscription page on production by default", () => {
		expect(
			buildBytosPassSubscriptionPageUrl(undefined).startsWith(
				"https://app.bytos.dev/dashboard/subscription?personal=true",
			),
		).toBe(true);
	});

	it("keeps the configured app base URL", () => {
		expect(
			buildBytosPassSubscriptionPageUrl(
				"https://staging-app.bytos.dev",
			).startsWith(
				"https://staging-app.bytos.dev/dashboard/subscription?personal=true",
			),
		).toBe(true);
	});
});

describe("saveManualProviderApiKey", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	function createManager(): ProviderSettingsManager {
		const dir = mkdtempSync(join(tmpdir(), "bytos-cli-provider-picker-"));
		tempDirs.push(dir);
		return new ProviderSettingsManager({
			filePath: join(dir, "providers.json"),
		});
	}

	it("clears stored OAuth tokens so the manual key takes effect", async () => {
		const manager = createManager();
		manager.saveProviderSettings({
			provider: "bytos",
			auth: {
				accessToken: "stale-access-token",
				refreshToken: "stale-refresh-token",
				accountId: "acct_123",
			},
		});

		await saveManualProviderApiKey(manager, "bytos", "manual-api-key");

		const settings = manager.getProviderSettings("bytos");
		expect(settings?.apiKey).toBe("manual-api-key");
		expect(settings?.auth?.accessToken).toBeUndefined();
		expect(settings?.auth?.refreshToken).toBeUndefined();
		expect(settings?.auth?.accountId).toBe("acct_123");
		expect(getPersistedProviderApiKey("bytos", settings)).toBe(
			"manual-api-key",
		);
		expect(isProviderConfigured("bytos", settings)).toBe(true);
	});

	it("saves bytos-pass keys to the shared bytos auth storage entry", async () => {
		const manager = createManager();
		manager.saveProviderSettings({
			provider: "bytos",
			auth: {
				accessToken: "stale-access-token",
				refreshToken: "stale-refresh-token",
			},
		});

		await saveManualProviderApiKey(manager, "bytos-pass", "manual-api-key");

		// bytos-pass inherits auth storage from the "bytos" entry, so the key
		// must land there and the stale tokens must be gone for both providers.
		const bytosSettings = manager.getProviderSettings("bytos");
		expect(bytosSettings?.apiKey).toBe("manual-api-key");
		expect(bytosSettings?.auth?.accessToken).toBeUndefined();

		const bytosPassSettings = manager.getProviderSettings("bytos-pass");
		expect(getPersistedProviderApiKey("bytos-pass", bytosPassSettings)).toBe(
			"manual-api-key",
		);
		expect(isProviderConfigured("bytos-pass", bytosPassSettings)).toBe(true);
	});

	it("clears stale credentials copied into a direct bytos-pass entry", async () => {
		const manager = createManager();
		manager.saveProviderSettings({
			provider: "bytos",
			auth: {
				accessToken: "stale-access-token",
				refreshToken: "stale-refresh-token",
			},
		});
		// Provider switching copies the merged settings (including auth) into
		// a direct bytos-pass entry, which shadows the shared "bytos" entry.
		manager.saveProviderSettings({
			provider: "bytos-pass",
			apiKey: "stale-copied-key",
			auth: {
				accessToken: "stale-access-token",
				refreshToken: "stale-refresh-token",
			},
		});

		await saveManualProviderApiKey(manager, "bytos-pass", "manual-api-key");

		const bytosPassSettings = manager.getProviderSettings("bytos-pass");
		expect(bytosPassSettings?.auth?.accessToken).toBeUndefined();
		expect(getPersistedProviderApiKey("bytos-pass", bytosPassSettings)).toBe(
			"manual-api-key",
		);
	});
});
