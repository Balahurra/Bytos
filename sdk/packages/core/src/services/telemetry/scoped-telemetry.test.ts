import { describe, expect, it, vi } from "vitest";
import { CORE_TELEMETRY_EVENTS } from "./core-events";
import type { ITelemetryAdapter } from "./ITelemetryAdapter";
import {
	createClientScopedTelemetryService,
	resolveClientTelemetryProperties,
} from "./scoped-telemetry";
import { TelemetryService } from "./TelemetryService";

function createAdapter() {
	const emit = vi.fn();
	const dispose = vi.fn(async () => {});
	const adapter: ITelemetryAdapter = {
		name: "test",
		emit,
		emitRequired: vi.fn(),
		recordCounter: vi.fn(),
		recordHistogram: vi.fn(),
		recordGauge: vi.fn(),
		isEnabled: () => true,
		flush: async () => {},
		dispose,
	};
	return { adapter, emit, dispose };
}

describe("client-scoped telemetry", () => {
	it("maps shared client identity to cross-surface dimensions", () => {
		expect(
			resolveClientTelemetryProperties({
				source: "desktop",
				client: {
					name: "bytos-desktop",
					version: "0.0.23",
					platform: "Bytos Desktop",
					platformVersion: "0.0.23",
				},
			}),
		).toEqual({
			bytos_type: "desktop",
			extension_version: "0.0.23",
			platform: "Bytos Desktop",
			platform_version: "0.0.23",
		});
	});

	it("overrides Hub host defaults with current client and account context", () => {
		const { adapter, emit } = createAdapter();
		const parent = new TelemetryService({
			adapters: [adapter],
			distinctId: "stale-account",
			deviceId: "device-1",
			commonProperties: {
				user_id: "stale-account",
				account_id: "stale-account",
				organization_id: "stale-org",
			},
			metadata: {
				extension_version: "0.0.82",
				bytos_type: "hub",
				platform: "bytos-hub-daemon",
				platform_version: "v24.0.0",
				os_type: "darwin",
				os_version: "test-os",
			},
		});
		const telemetry = createClientScopedTelemetryService(parent, {
			source: "desktop",
			client: {
				name: "bytos-desktop",
				version: "0.0.23",
				platform: "Bytos Desktop",
				platformVersion: "0.0.23",
			},
			user: {
				distinctId: "account-1",
				accountId: "account-1",
				email: "dev@example.com",
				organizationId: "org-1",
			},
		});

		telemetry.capture({
			event: CORE_TELEMETRY_EVENTS.TASK.CREATED,
			properties: {
				ulid: "session-1",
				provider: "anthropic",
				model: "claude-sonnet-4.6",
			},
		});

		expect(emit).toHaveBeenCalledWith(CORE_TELEMETRY_EVENTS.TASK.CREATED, {
			user_id: "account-1",
			account_id: "account-1",
			account_email: "dev@example.com",
			organization_id: "org-1",
			extension_version: "0.0.23",
			bytos_type: "desktop",
			platform: "Bytos Desktop",
			platform_version: "0.0.23",
			os_type: "darwin",
			os_version: "test-os",
			ulid: "session-1",
			provider: "anthropic",
			model: "claude-sonnet-4.6",
			distinct_id: "account-1",
			device_id: "device-1",
		});
	});

	it("keeps anonymous identity while clearing stale Hub account fields", () => {
		const { adapter, emit } = createAdapter();
		const parent = new TelemetryService({
			adapters: [adapter],
			distinctId: "stale-account",
			commonProperties: {
				user_id: "stale-account",
				account_id: "stale-account",
				account_email: "stale@example.com",
				organization_id: "stale-org",
			},
			metadata: {
				extension_version: "0.0.82",
				bytos_type: "hub",
				platform: "bytos-hub-daemon",
				platform_version: "v24.0.0",
			},
		});
		const telemetry = createClientScopedTelemetryService(parent, {
			client: { name: "bytos-desktop" },
			user: { distinctId: "machine-1", accountId: null },
		});

		telemetry.capture({ event: CORE_TELEMETRY_EVENTS.TASK.CREATED });

		expect(emit).toHaveBeenCalledWith(CORE_TELEMETRY_EVENTS.TASK.CREATED, {
			bytos_type: "desktop",
			platform: "bytos-desktop",
			distinct_id: "machine-1",
			device_id: expect.any(String),
		});
	});

	it("does not dispose the process-owned parent from a session view", async () => {
		const { adapter, dispose } = createAdapter();
		const parent = new TelemetryService({ adapters: [adapter] });
		const telemetry = createClientScopedTelemetryService(parent, {
			client: { name: "bytos-desktop" },
		});

		await telemetry.dispose();

		expect(dispose).not.toHaveBeenCalled();
	});
});
