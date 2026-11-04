// ---------------------------------------------------------------------------
// Environment helpers for test setup.
//
// Usage:
//   test.use({ env: bytosEnv("default") });
//   test.use({ env: bytosEnv("claude-sonnet-4.6") });
//   test.use({ env: bytosEnv("/absolute/path/to/config") });
// ---------------------------------------------------------------------------

import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEST_SUITE_ROOT = fileURLToPath(new URL("../", import.meta.url));

/**
 * Deterministic stand-in for the (unavailable) production Bytos API.
 *
 * Unauthenticated CLI tests must exercise the real HTTP/auth path without a
 * public DNS lookup or a live backend. Every request to this server answers
 * 401 with the same JSON envelope the real API uses, so the CLI's
 * authorization handling is exercised end to end.
 */
const unauthorizedApiServer = createServer((request, response) => {
	if (process.env.BYTOS_TUI_TEST_VERBOSE === "1") {
		console.error(`[mock-401] ${request.method} ${request.url}`)
	}
	response.writeHead(401, {
		"Content-Type": "application/json",
		"WWW-Authenticate": 'Bearer realm="bytos"',
	});
	response.end(JSON.stringify({ success: false, error: "Unauthorized" }));
});

await new Promise<void>((resolve, reject) => {
	unauthorizedApiServer.once("error", reject);
	unauthorizedApiServer.listen(0, "127.0.0.1", resolve);
});

const unauthorizedAddress = unauthorizedApiServer.address() as AddressInfo;

export const UNAUTHORIZED_API_BASE_URL = `http://127.0.0.1:${unauthorizedAddress.port}`;

// Do not keep the test worker alive after its tests finish.
unauthorizedApiServer.unref();
process.once("exit", () => unauthorizedApiServer.close());

let envCounter = 0;

function createIsolatedBytosDir(sourceDir: string): string {
	const tempRoot = mkdtempSync(path.join(os.tmpdir(), "bytos-tui-test-"));
	const targetDir = path.join(tempRoot, "bytos");
	cpSync(sourceDir, targetDir, {
		recursive: true,
		errorOnExist: false,
		force: true,
	});
	mkdirSync(path.join(targetDir, "home"), { recursive: true });
	return targetDir;
}

function nextHubPort(): string {
	envCounter += 1;
	const basePort = 30_000 + (process.pid % 10_000);
	return String(basePort + (envCounter % 10_000));
}

/**
 * Build the process environment for a bytos test.
 *
 * @param configDir - Named config under `configs/`, or an absolute path.
 * @param extra     - Additional env vars to merge in (override defaults).
 */
export function bytosEnv(
	configDir: string,
	extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
	const bytosPath = path.isAbsolute(configDir)
		? configDir
		: path.join(TEST_SUITE_ROOT, "configs", configDir);
	const isolatedBytosPath = createIsolatedBytosDir(bytosPath);
	const dataDir = path.join(isolatedBytosPath, "data");

	// Determine effective VCR mode: extra overrides > parent env > default "playback"
	const effectiveVcrMode =
		extra.BYTOS_VCR ?? process.env.BYTOS_VCR ?? "playback";

	// During recording, authenticated configs read real OAuth credentials from
	// ~/.bytos/data/settings/providers.json while keeping all other settings
	// (model, provider, global state) from the mock config directory.
	const isRecording = effectiveVcrMode === "record";
	const isAuthenticated = configDir !== "unauthenticated";
	const realProvidersFile =
		isRecording && isAuthenticated
			? path.join(os.homedir(), ".bytos", "data", "settings", "providers.json")
			: undefined;

	// Remove CI so terminal renderers treat the spawned process as interactive.
	// Remove VITEST so the spawned CLI binary doesn't skip initVcr().
	// cli/src/index.ts guards `initVcr` behind `process.env.VITEST !== "true"`,
	// so if the parent vitest process's VITEST=true leaks into the child, VCR
	// recording/playback is silently skipped.
	const { CI: _ci, VITEST: _vitest, ...cleanEnv } = process.env;
	if (!isAuthenticated) {
		delete cleanEnv.BYTOS_API_KEY;
	}

	// Only enable VCR when a cassette path is provided (via extra or parent env),
	// otherwise tests without cassettes would trigger a spurious
	// "[VCR] No BYTOS_VCR_CASSETTE" warning on every run.
	const hasCassette = !!(
		extra.BYTOS_VCR_CASSETTE ?? process.env.BYTOS_VCR_CASSETTE
	);
	const vcrDefaults = hasCassette
		? { BYTOS_VCR: "playback", BYTOS_VCR_FILTER: "" }
		: {};

	// the order of these env vars matter; later ones override earlier ones
	return {
		...vcrDefaults,
		...cleanEnv,
		...(realProvidersFile
			? { BYTOS_PROVIDER_SETTINGS_PATH: realProvidersFile }
			: {}),
		BYTOS_TELEMETRY_DISABLED: "1",
		HOME: path.join(isolatedBytosPath, "home"),
		BYTOS_DIR: isolatedBytosPath,
		BYTOS_DATA_DIR: dataDir,
		BYTOS_DB_DATA_DIR: path.join(dataDir, "db"),
		BYTOS_GLOBAL_SETTINGS_PATH: path.join(
			dataDir,
			"settings",
			"global-settings.json",
		),
		BYTOS_HOOKS_LOG_PATH: path.join(dataDir, "logs", "hooks.jsonl"),
		BYTOS_HUB_DISCOVERY_PATH: path.join(
			dataDir,
			"locks",
			"hub",
			"discovery.json",
		),
		BYTOS_HUB_PORT: nextHubPort(),
		BYTOS_MCP_SETTINGS_PATH: path.join(
			dataDir,
			"settings",
			"bytos_mcp_settings.json",
		),
		...(realProvidersFile
			? {}
			: {
					BYTOS_PROVIDER_SETTINGS_PATH: path.join(
						dataDir,
						"settings",
						"providers.json",
					),
				}),
		BYTOS_SESSION_DATA_DIR: path.join(dataDir, "sessions"),
		BYTOS_TEAM_DATA_DIR: path.join(dataDir, "teams"),
		// Unauthenticated tests must never reach public DNS. Point them at the
		// local 401 server so the CLI exercises its real auth-failure path.
		...(isAuthenticated ? {} : { BYTOS_API_BASE_URL: UNAUTHORIZED_API_BASE_URL }),
		BYTOS_DISABLE_BYTOS_PASS_NOTICE: "1",
		NO_UPDATE_NOTIFIER: "1",
		BYTOS_NO_AUTO_UPDATE: "1",
		...extra,
	};
}
