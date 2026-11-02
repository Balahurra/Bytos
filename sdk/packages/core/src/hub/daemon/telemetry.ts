import { release } from "node:os";
import {
	claimHubLauncherIdentity,
	createBytosTelemetryServiceConfig,
	type HubLauncherIdentity,
	type ITelemetryService,
	readHubLauncherIdentity,
} from "@bytos/shared";
import type { AuthSettings } from "../../services/llms/provider-settings";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import {
	clearAccountTelemetryIdentity,
	identifyAccount,
} from "../../services/telemetry/core-events";
import { resolveCoreDistinctId } from "../../services/telemetry/distinct-id";
import { createConfiguredTelemetryHandle } from "../../services/telemetry/OpenTelemetryProvider";
import { CORE_BUILD_VERSION } from "../../version";
import { resolveHubBuildId } from "../discovery";

const IDENTITY_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DISPOSE_FLUSH_TIMEOUT_MS = 5_000;

export interface HubDaemonTelemetry {
	readonly telemetry: ITelemetryService;
	/** Who started this daemon, as published on its telemetry resource. */
	readonly launcher?: HubLauncherIdentity;
	/** Flushes pending batches and disposes the underlying provider. */
	dispose(): Promise<void>;
}

/**
 * Resource attributes that say whose build is hosting the sessions. One hub
 * serves every Bytos client on the machine, and a session only carries its
 * own client's name/version (`clientName: bytos-desktop`), so without these
 * a desktop trace cannot be told apart from "desktop session on a hub the
 * CLI started" - which decides whether a build-specific telemetry gap is the
 * desktop's or the CLI's. Values are low-cardinality identifiers, never paths.
 */
export function hubDaemonResourceAttributes(
	launcher: HubLauncherIdentity | undefined = readHubLauncherIdentity(),
	options: { buildId?: string; execPath?: string } = {},
): Record<string, string> {
	const buildId = options.buildId ?? resolveHubBuildId();
	const execPath = options.execPath ?? process.execPath ?? "";
	return {
		"bytos.hub.build_id": buildId,
		// Executable name only: bytos-cli (bundled by the desktop), bytos
		// (npm), code-sidecar (older desktop), bun/node (source runs). Split on
		// both separators so a Windows path read on any platform strips too.
		"bytos.hub.runtime": (execPath.split(/[\\/]/).pop() ?? "").replace(
			/\.exe$/i,
			"",
		),
		"bytos.hub.launcher.client": launcher?.client ?? "unknown",
		"bytos.hub.launcher.version": launcher?.version ?? "unknown",
		"bytos.hub.launcher.transport": launcher?.transport ?? "local",
	};
}

/**
 * Telemetry for the detached hub daemon process.
 *
 * The daemon hosts the `LocalRuntimeHost` that emits `task.conversation_turn`
 * and `task.tokens` for every hub-backed session, so without its own handle
 * those events are dropped entirely - sessions bill on the backend while
 * reporting nothing to OTel.
 *
 * The daemon is long-lived and frequently starts before the user logs in (or
 * outlives an account switch), so the cached Bytos account id is re-resolved
 * periodically rather than only once at startup.
 */
export function createHubDaemonTelemetry(): HubDaemonTelemetry {
	// Claim rather than read: sessions this daemon hosts spawn processes that
	// inherit its environment, and a hub one of them starts must record its
	// own launcher, not this one's.
	const launcher = claimHubLauncherIdentity();
	const config = createBytosTelemetryServiceConfig({
		// Spans carry only the OTel resource, not per-event metadata, so the
		// daemon needs its own service identity: it ships in the same binary
		// as the CLI, and without this its traces would be indistinguishable
		// from CLI-local ones (`service.name: bytos`).
		serviceName: "bytos-hub-daemon",
		serviceVersion: CORE_BUILD_VERSION,
		metadata: {
			extension_version: CORE_BUILD_VERSION,
			// "hub", not "cli": daemon-hosted sessions can be triggered by the
			// CLI, desktop app, or connectors, so daemon-emitted events must be
			// distinguishable from the CLI process's own events.
			bytos_type: "hub",
			platform: "bytos-hub-daemon",
			platform_version: process.version,
			os_type: process.platform,
			os_version: release(),
		},
	});
	const handle = createConfiguredTelemetryHandle({
		...config,
		resourceAttributes: hubDaemonResourceAttributes(launcher),
	});

	// Constructed once and reused: the constructor runs legacy settings
	// migration and provider registration side effects, while
	// getProviderSettings re-reads the file on every call anyway.
	let settingsManager: ProviderSettingsManager | undefined;
	const resolveCachedBytosAuth = (): AuthSettings | null | undefined => {
		try {
			settingsManager ??= new ProviderSettingsManager();
			return settingsManager.getProviderSettings("bytos")?.auth;
		} catch {
			// Telemetry identity must never interfere with daemon operation.
			return null;
		}
	};

	let identifiedKey: string | undefined;
	const refreshIdentity = (): void => {
		const auth = resolveCachedBytosAuth();
		if (auth === null) {
			return;
		}
		const accountId = auth?.accountId?.trim();
		if (!auth || !accountId) {
			if (identifiedKey !== undefined) {
				identifiedKey = undefined;
				clearAccountTelemetryIdentity(
					handle.telemetry,
					resolveCoreDistinctId(),
				);
			}
			return;
		}
		// Re-identify on account OR active-organization change so a long-lived
		// daemon keeps org attribution current after an org switch.
		const key = `${accountId}:${auth.organizationId ?? ""}`;
		if (key === identifiedKey) {
			return;
		}
		identifiedKey = key;
		identifyAccount(handle.telemetry, {
			id: accountId,
			provider: "bytos",
			organizationId: auth.organizationId,
			organizationName: auth.organizationName,
			memberId: auth.memberId,
		});
	};

	refreshIdentity();
	const identityTimer = setInterval(
		refreshIdentity,
		IDENTITY_REFRESH_INTERVAL_MS,
	);
	identityTimer.unref?.();

	return {
		telemetry: handle.telemetry,
		launcher,
		dispose: async (): Promise<void> => {
			clearInterval(identityTimer);
			// dispose only runs on the daemon's way out; a hung exporter must
			// never keep a crashed daemon alive (holding the hub port), so
			// the flush races a hard deadline.
			let deadline: ReturnType<typeof setTimeout> | undefined;
			await Promise.race([
				(async (): Promise<void> => {
					await handle.flush();
					await handle.dispose();
				})(),
				new Promise<void>((resolve) => {
					deadline = setTimeout(resolve, DISPOSE_FLUSH_TIMEOUT_MS);
					deadline.unref?.();
				}),
			]);
			clearTimeout(deadline);
		},
	};
}
