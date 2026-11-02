import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	AGENT_CONFIG_DIRECTORY_NAME,
	BYTOS_CHAT_WORKSPACE_DIRECTORY_NAME,
	BYTOS_CONNECTOR_SETTINGS_FILE_NAME,
	BYTOS_MCP_SETTINGS_FILE_NAME,
	BYTOS_WORKSPACES_DIRECTORY_NAME,
	discoverPluginModulePaths,
	getPluginDisplayName,
	HOOKS_CONFIG_DIRECTORY_NAME,
	isAgentPluginDirectory,
	isChatWorkspacePath,
	RULES_CONFIG_DIRECTORY_NAME,
	resolveAgentPluginSearchPaths,
	resolveAgentsConfigDirPath,
	resolveChatWorkspacePath,
	resolveBytosDataDir,
	resolveConfiguredPluginModulePaths,
	resolveConnectorDataDir,
	resolveConnectorSettingsPath,
	resolveDbDataDir,
	resolveGlobalAgentsRulesPath,
	resolveGlobalRulesConfigPaths,
	resolveGlobalSettingsPath,
	resolveHooksConfigSearchPaths,
	resolveMcpSettingsPath,
	resolvePluginModuleEntries,
	resolveProviderSettingsPath,
	resolveRulesConfigSearchPaths,
	resolveSessionDataDir,
	resolveTeamDataDir,
	resolveWorkflowsConfigSearchPaths,
	resolveWorkspaceRulesConfigPaths,
	setHomeDir,
} from "./paths";

type EnvSnapshot = {
	BYTOS_DIR: string | undefined;
	BYTOS_DATA_DIR: string | undefined;
	BYTOS_CONNECTOR_DATA_DIR: string | undefined;
	BYTOS_CONNECTOR_SETTINGS_PATH: string | undefined;
	BYTOS_DB_DATA_DIR: string | undefined;
	BYTOS_GLOBAL_SETTINGS_PATH: string | undefined;
	BYTOS_MCP_SETTINGS_PATH: string | undefined;
	BYTOS_PROVIDER_SETTINGS_PATH: string | undefined;
	BYTOS_SESSION_DATA_DIR: string | undefined;
	BYTOS_TEAM_DATA_DIR: string | undefined;
};

function captureEnv(): EnvSnapshot {
	return {
		BYTOS_DIR: process.env.BYTOS_DIR,
		BYTOS_DATA_DIR: process.env.BYTOS_DATA_DIR,
		BYTOS_CONNECTOR_DATA_DIR: process.env.BYTOS_CONNECTOR_DATA_DIR,
		BYTOS_CONNECTOR_SETTINGS_PATH: process.env.BYTOS_CONNECTOR_SETTINGS_PATH,
		BYTOS_DB_DATA_DIR: process.env.BYTOS_DB_DATA_DIR,
		BYTOS_GLOBAL_SETTINGS_PATH: process.env.BYTOS_GLOBAL_SETTINGS_PATH,
		BYTOS_MCP_SETTINGS_PATH: process.env.BYTOS_MCP_SETTINGS_PATH,
		BYTOS_PROVIDER_SETTINGS_PATH: process.env.BYTOS_PROVIDER_SETTINGS_PATH,
		BYTOS_SESSION_DATA_DIR: process.env.BYTOS_SESSION_DATA_DIR,
		BYTOS_TEAM_DATA_DIR: process.env.BYTOS_TEAM_DATA_DIR,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	process.env.BYTOS_DATA_DIR = snapshot.BYTOS_DATA_DIR;
	process.env.BYTOS_CONNECTOR_DATA_DIR = snapshot.BYTOS_CONNECTOR_DATA_DIR;
	process.env.BYTOS_CONNECTOR_SETTINGS_PATH =
		snapshot.BYTOS_CONNECTOR_SETTINGS_PATH;
	process.env.BYTOS_DIR = snapshot.BYTOS_DIR;
	process.env.BYTOS_DB_DATA_DIR = snapshot.BYTOS_DB_DATA_DIR;
	process.env.BYTOS_GLOBAL_SETTINGS_PATH = snapshot.BYTOS_GLOBAL_SETTINGS_PATH;
	process.env.BYTOS_MCP_SETTINGS_PATH = snapshot.BYTOS_MCP_SETTINGS_PATH;
	process.env.BYTOS_PROVIDER_SETTINGS_PATH =
		snapshot.BYTOS_PROVIDER_SETTINGS_PATH;
	process.env.BYTOS_SESSION_DATA_DIR = snapshot.BYTOS_SESSION_DATA_DIR;
	process.env.BYTOS_TEAM_DATA_DIR = snapshot.BYTOS_TEAM_DATA_DIR;
}

describe("storage path resolution", () => {
	let snapshot: EnvSnapshot = captureEnv();

	afterEach(() => {
		restoreEnv(snapshot);
	});

	it("only auto-discovers Agent Plugins from the user home", () => {
		const homeRoot = mkdtempSync(join(tmpdir(), "bytos-agent-plugin-home-"));
		const previousHome = process.env.HOME ?? "~";
		try {
			setHomeDir(homeRoot);
			expect(resolveAgentPluginSearchPaths()).toEqual([
				join(homeRoot, ".agents", "plugins"),
			]);
		} finally {
			setHomeDir(previousHome);
			rmSync(homeRoot, { recursive: true, force: true });
		}
	});

	it("uses BYTOS_DATA_DIR as-is when set", () => {
		snapshot = captureEnv();
		process.env.BYTOS_DATA_DIR = "/tmp/bytos-data";

		expect(resolveBytosDataDir()).toBe("/tmp/bytos-data");
	});

	it("falls back to BYTOS_DATA_DIR/sessions for session storage", () => {
		snapshot = captureEnv();
		delete process.env.BYTOS_SESSION_DATA_DIR;
		process.env.BYTOS_DATA_DIR = "/tmp/bytos-data";

		expect(resolveSessionDataDir()).toBe(join("/tmp/bytos-data", "sessions"));
	});

	it("falls back to BYTOS_DATA_DIR/teams for team storage", () => {
		snapshot = captureEnv();
		delete process.env.BYTOS_TEAM_DATA_DIR;
		process.env.BYTOS_DATA_DIR = "/tmp/bytos-data";

		expect(resolveTeamDataDir()).toBe(join("/tmp/bytos-data", "teams"));
	});

	it("falls back to BYTOS_DATA_DIR/connectors for connector storage", () => {
		snapshot = captureEnv();
		delete process.env.BYTOS_CONNECTOR_DATA_DIR;
		process.env.BYTOS_DATA_DIR = "/tmp/bytos-data";

		expect(resolveConnectorDataDir()).toBe(
			join("/tmp/bytos-data", "connectors"),
		);
	});

	it("falls back to BYTOS_DATA_DIR/connectors/settings.json for connector settings", () => {
		snapshot = captureEnv();
		delete process.env.BYTOS_CONNECTOR_DATA_DIR;
		delete process.env.BYTOS_CONNECTOR_SETTINGS_PATH;
		process.env.BYTOS_DATA_DIR = "/tmp/bytos-data";

		expect(resolveConnectorSettingsPath()).toBe(
			join("/tmp/bytos-data", "connectors", BYTOS_CONNECTOR_SETTINGS_FILE_NAME),
		);
	});

	it("uses BYTOS_CONNECTOR_SETTINGS_PATH as-is when set", () => {
		snapshot = captureEnv();
		process.env.BYTOS_CONNECTOR_SETTINGS_PATH =
			"/tmp/bytos-connectors/custom-settings.json";

		expect(resolveConnectorSettingsPath()).toBe(
			"/tmp/bytos-connectors/custom-settings.json",
		);
	});

	it("falls back to BYTOS_DATA_DIR/db for sqlite storage", () => {
		snapshot = captureEnv();
		delete process.env.BYTOS_DB_DATA_DIR;
		process.env.BYTOS_DATA_DIR = "/tmp/bytos-data";

		expect(resolveDbDataDir()).toBe(join("/tmp/bytos-data", "db"));
	});

	it("falls back to BYTOS_DATA_DIR/settings/providers.json for provider settings", () => {
		snapshot = captureEnv();
		delete process.env.BYTOS_PROVIDER_SETTINGS_PATH;
		process.env.BYTOS_DATA_DIR = "/tmp/bytos-data";

		expect(resolveProviderSettingsPath()).toBe(
			join("/tmp/bytos-data", "settings", "providers.json"),
		);
	});

	it("falls back to BYTOS_DATA_DIR/settings/global-settings.json for global settings", () => {
		snapshot = captureEnv();
		delete process.env.BYTOS_GLOBAL_SETTINGS_PATH;
		process.env.BYTOS_DATA_DIR = "/tmp/bytos-data";

		expect(resolveGlobalSettingsPath()).toBe(
			join("/tmp/bytos-data", "settings", "global-settings.json"),
		);
	});

	it("falls back to BYTOS_DATA_DIR/settings/bytos_mcp_settings.json for MCP settings", () => {
		snapshot = captureEnv();
		delete process.env.BYTOS_MCP_SETTINGS_PATH;
		process.env.BYTOS_DATA_DIR = "/tmp/bytos-data";

		expect(resolveMcpSettingsPath()).toBe(
			join("/tmp/bytos-data", "settings", BYTOS_MCP_SETTINGS_FILE_NAME),
		);
	});

	it("falls back to ~/.bytos/.agents for agent configs", () => {
		snapshot = captureEnv();
		process.env.BYTOS_DIR = "/tmp/home/.bytos";

		expect(resolveAgentsConfigDirPath()).toBe(
			join("/tmp/home", ".bytos", AGENT_CONFIG_DIRECTORY_NAME),
		);
	});

	it("resolves global hooks from ~/.bytos", () => {
		snapshot = captureEnv();
		process.env.BYTOS_DIR = "/tmp/home/.bytos";
		process.env.BYTOS_DATA_DIR = "/tmp/home/.bytos/data";

		expect(resolveHooksConfigSearchPaths()).toEqual(
			expect.arrayContaining([
				join("/tmp/home", ".bytos", HOOKS_CONFIG_DIRECTORY_NAME),
			]),
		);
		expect(resolveHooksConfigSearchPaths()).not.toContain(
			join("/tmp/home", ".bytos", "data", HOOKS_CONFIG_DIRECTORY_NAME),
		);
	});

	it("resolves global rules from ~/.bytos", () => {
		snapshot = captureEnv();
		process.env.BYTOS_DIR = "/tmp/home/.bytos";
		process.env.BYTOS_DATA_DIR = "/tmp/home/.bytos/data";

		expect(resolveRulesConfigSearchPaths()).toEqual(
			expect.arrayContaining([
				resolveGlobalAgentsRulesPath(),
				join("/tmp/home", ".bytos", RULES_CONFIG_DIRECTORY_NAME),
				// xdg-user-dir's unconfigured Documents fallback (bytos/bytos#13542)
				join(
					dirname(dirname(resolveGlobalAgentsRulesPath())),
					"Bytos",
					"Rules",
				),
			]),
		);
		expect(resolveRulesConfigSearchPaths()).not.toContain(
			join("/tmp/home", ".bytos", "data", RULES_CONFIG_DIRECTORY_NAME),
		);
	});

	it("resolves both workspace rule layouts (.bytosrules and .bytos/rules)", () => {
		const workspacePath = join("/repo", "demo");

		expect(resolveWorkspaceRulesConfigPaths(workspacePath)).toEqual([
			join(workspacePath, ".bytosrules"),
			join(workspacePath, ".bytos", RULES_CONFIG_DIRECTORY_NAME),
		]);
		expect(resolveRulesConfigSearchPaths(workspacePath)).toEqual(
			expect.arrayContaining(resolveWorkspaceRulesConfigPaths(workspacePath)),
		);
	});

	it("includes OneDrive-redirected Documents rule locations when the env vars are set", () => {
		snapshot = captureEnv();
		const previousOneDrive = process.env.OneDrive;
		const previousOneDriveConsumer = process.env.OneDriveConsumer;
		try {
			process.env.OneDrive = join("/tmp", "user", "OneDrive");
			process.env.OneDriveConsumer = join("/tmp", "user", "OneDrive");

			const globalPaths = resolveGlobalRulesConfigPaths();
			// Deduped: OneDrive and OneDriveConsumer point at the same folder.
			expect(
				globalPaths.filter(
					(candidate) =>
						candidate ===
						join("/tmp", "user", "OneDrive", "Documents", "Bytos", "Rules"),
				),
			).toHaveLength(1);
			expect(resolveRulesConfigSearchPaths("/repo/demo")).toContain(
				join("/tmp", "user", "OneDrive", "Documents", "Bytos", "Rules"),
			);
		} finally {
			process.env.OneDrive = previousOneDrive;
			process.env.OneDriveConsumer = previousOneDriveConsumer;
		}
	});

	it("omits OneDrive rule locations when the env vars are unset", () => {
		const previousOneDrive = process.env.OneDrive;
		const previousOneDriveConsumer = process.env.OneDriveConsumer;
		const previousOneDriveCommercial = process.env.OneDriveCommercial;
		try {
			delete process.env.OneDrive;
			delete process.env.OneDriveConsumer;
			delete process.env.OneDriveCommercial;

			for (const candidate of resolveGlobalRulesConfigPaths()) {
				expect(candidate).not.toContain("OneDrive");
			}
		} finally {
			process.env.OneDrive = previousOneDrive;
			process.env.OneDriveConsumer = previousOneDriveConsumer;
			process.env.OneDriveCommercial = previousOneDriveCommercial;
		}
	});

	it("resolves legacy and new workflow paths, with .bytos paths later for duplicate-name precedence", () => {
		snapshot = captureEnv();
		process.env.BYTOS_DIR = "/tmp/home/.bytos";
		const workspacePath = "/repo/demo";

		const paths = resolveWorkflowsConfigSearchPaths(workspacePath);

		expect(paths).toEqual([
			join(workspacePath, ".bytosrules", "workflows"),
			expect.stringContaining(join("Documents", "Bytos", "Workflows")),
			join("/tmp/home", ".bytos", "workflows"),
			join(workspacePath, ".bytos", "workflows"),
		]);
	});
});

describe("chat workspace paths", () => {
	let snapshot: EnvSnapshot = captureEnv();

	afterEach(() => {
		restoreEnv(snapshot);
	});

	it("exports the canonical path segments", () => {
		expect(BYTOS_WORKSPACES_DIRECTORY_NAME).toBe("workspaces");
		expect(BYTOS_CHAT_WORKSPACE_DIRECTORY_NAME).toBe("chat");
	});

	it("resolves the shared chat workspace under the bytos data dir", () => {
		snapshot = captureEnv();
		delete process.env.BYTOS_DATA_DIR;
		process.env.BYTOS_DIR = "/tmp/home/.bytos";

		expect(resolveChatWorkspacePath()).toBe(
			join("/tmp/home/.bytos", "data", "workspaces", "chat"),
		);
	});

	it("honors the BYTOS_DATA_DIR override", () => {
		snapshot = captureEnv();
		process.env.BYTOS_DATA_DIR = "/tmp/bytos-data";

		expect(resolveChatWorkspacePath()).toBe(
			join("/tmp/bytos-data", "workspaces", "chat"),
		);
	});

	it.each([
		"/home/user/.bytos/data/workspaces/chat",
		"//home//user//.bytos//data//workspaces//chat//",
		"C:\\Users\\dev\\.bytos\\data\\workspaces\\chat\\",
		"\\\\server\\share\\.bytos\\data\\workspaces\\chat",
	])("recognizes chat workspace root %s", (path) => {
		expect(isChatWorkspacePath(path)).toBe(true);
	});

	it.each([
		".bytos/data/workspaces/chat",
		"/tmp/chat",
		"/tmp/bytos/sessions/session-a1b2c3-temp/project",
		"/home/user/bytos/data/workspaces/chat",
		"/home/user/.bytos/workspaces/chat",
		"/home/user/.bytos/data/other/chat",
		"/home/user/.bytos/data/workspaces/Chat",
		"/home/user/.bytos/data/workspaces/chat/my-app",
		"/home/user/.bytos/data/workspaces",
	])("rejects non-chat workspace path %s", (path) => {
		expect(isChatWorkspacePath(path)).toBe(false);
	});
});

describe("getPluginDisplayName", () => {
	const tempRoots: string[] = [];

	function createTempRoot(): string {
		const root = mkdtempSync(join(tmpdir(), "bytos-plugin-name-"));
		tempRoots.push(root);
		return root;
	}

	afterEach(() => {
		for (const root of tempRoots.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("uses the package name for package-backed installed plugin entries", () => {
		const root = createTempRoot();
		const packageDir = join(
			root,
			"_installed",
			"local",
			"agents-squad-057fda0dd505",
			"package",
		);
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({ name: "bytos-agents-squad-plugin" }),
		);
		const entryPath = join(packageDir, "index.ts");
		writeFileSync(entryPath, "export default {};");

		expect(getPluginDisplayName(entryPath, root)).toBe(
			"bytos-agents-squad-plugin",
		);
	});

	it("finds the package name in an ancestor directory within the search root", () => {
		const root = createTempRoot();
		const packageDir = join(root, "my-plugin");
		const srcDir = join(packageDir, "src");
		mkdirSync(srcDir, { recursive: true });
		writeFileSync(
			join(packageDir, "package.json"),
			JSON.stringify({ name: "my-plugin" }),
		);
		const entryPath = join(srcDir, "index.ts");
		writeFileSync(entryPath, "export default {};");

		expect(getPluginDisplayName(entryPath, root)).toBe("my-plugin");
	});

	it("falls back to the file basename when package.json has no usable name", () => {
		const root = createTempRoot();
		const packageDir = join(root, "unnamed", "package");
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(join(packageDir, "package.json"), JSON.stringify({}));
		const entryPath = join(packageDir, "index.ts");
		writeFileSync(entryPath, "export default {};");

		expect(getPluginDisplayName(entryPath, root)).toBe("index");
	});

	it("falls back to the file basename for bare plugin modules", () => {
		const root = createTempRoot();
		const entryPath = join(root, "x-poster.js");
		writeFileSync(entryPath, "module.exports = {};");

		expect(getPluginDisplayName(entryPath, root)).toBe("x-poster");
	});

	it("does not read package.json files above the search root", () => {
		const outer = createTempRoot();
		writeFileSync(
			join(outer, "package.json"),
			JSON.stringify({ name: "outer-package" }),
		);
		const root = join(outer, "plugins");
		mkdirSync(root, { recursive: true });
		const entryPath = join(root, "index.ts");
		writeFileSync(entryPath, "export default {};");

		expect(getPluginDisplayName(entryPath, root)).toBe("index");
	});
});

describe("Bytos plugin discovery boundary", () => {
	const tempRoots: string[] = [];

	function createTempRoot(): string {
		const root = mkdtempSync(join(tmpdir(), "bytos-plugin-boundary-"));
		tempRoots.push(root);
		return root;
	}

	function writeFile(path: string, contents: string): string {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, contents);
		return path;
	}

	/**
	 * A minimal conformant Agent Plugin: a skill with an executable script, a
	 * second vendor's extension directory, and a vendored dependency. None of it
	 * is a Bytos plugin module.
	 */
	function writeAgentPlugin(pluginRoot: string): void {
		writeFile(
			join(pluginRoot, "plugin.json"),
			JSON.stringify({
				$schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
				name: "summarizer",
			}),
		);
		writeFile(
			join(pluginRoot, "mcp.json"),
			JSON.stringify({
				$schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
				mcpServers: {},
			}),
		);
		writeFile(
			join(pluginRoot, "skills", "summarize", "SKILL.md"),
			"---\nname: summarize\n---\n",
		);
		writeFile(
			join(pluginRoot, "skills", "summarize", "scripts", "fetch.js"),
			"throw new Error('skill script must never be imported');",
		);
		writeFile(
			join(pluginRoot, "skills", "summarize", "scripts", "build.ts"),
			"export const helper = 1;",
		);
		writeFile(
			join(pluginRoot, "com.example.client", "setup.js"),
			"throw new Error('another vendor namespace must never be imported');",
		);
		writeFile(
			join(pluginRoot, "node_modules", "left-pad", "package.json"),
			JSON.stringify({ name: "left-pad", main: "index.js" }),
		);
		writeFile(
			join(pluginRoot, "node_modules", "left-pad", "index.js"),
			"module.exports = () => {};",
		);
	}

	afterEach(() => {
		for (const root of tempRoots.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("claims nothing from an Agent Plugin dropped into a Bytos plugin root", () => {
		const root = createTempRoot();
		writeAgentPlugin(join(root, "summarizer"));

		expect(discoverPluginModulePaths(root)).toEqual([]);
	});

	it("claims nothing when the scan root is itself an Agent Plugin", () => {
		const root = createTempRoot();
		writeAgentPlugin(root);

		expect(discoverPluginModulePaths(root)).toEqual([]);
	});

	it("never descends into node_modules", () => {
		const root = createTempRoot();
		const entryPath = writeFile(
			join(root, "my-plugin", "index.ts"),
			"export default {};",
		);
		writeFile(
			join(root, "my-plugin", "node_modules", "dep", "index.js"),
			"module.exports = {};",
		);

		expect(discoverPluginModulePaths(root)).toEqual([entryPath]);
	});

	it("never descends into dot directories", () => {
		const root = createTempRoot();
		const entryPath = writeFile(join(root, "plugin.ts"), "export default {};");
		writeFile(
			join(root, ".git", "hooks", "pre-commit.js"),
			"module.exports={};",
		);

		expect(discoverPluginModulePaths(root)).toEqual([entryPath]);
	});

	it("still discovers bare Bytos plugin modules", () => {
		const root = createTempRoot();
		const first = writeFile(join(root, "alpha.ts"), "export default {};");
		const second = writeFile(
			join(root, "nested", "beta.js"),
			"export default {};",
		);

		expect(discoverPluginModulePaths(root)).toEqual([first, second]);
	});

	it("still honors package.json-declared Bytos plugin entries", () => {
		const root = createTempRoot();
		const packageDir = join(root, "declared");
		writeFile(
			join(packageDir, "package.json"),
			JSON.stringify({ bytos: { plugins: [{ paths: ["entry.ts"] }] } }),
		);
		const entryPath = writeFile(
			join(packageDir, "entry.ts"),
			"export default {};",
		);
		writeFile(join(packageDir, "helper.ts"), "export const helper = 1;");

		expect(discoverPluginModulePaths(root)).toEqual([entryPath]);
	});

	it("resolves no module entries for an Agent Plugin directory", () => {
		const root = createTempRoot();
		writeAgentPlugin(root);
		// An index.ts at the root would otherwise be claimed as the Bytos plugin
		// entry point, so this asserts the manifest wins over the index fallback.
		writeFile(join(root, "index.ts"), "export default {};");

		expect(resolvePluginModuleEntries(root)).toBeNull();
	});

	it("resolves no modules for an explicitly configured Agent Plugin path", () => {
		const root = createTempRoot();
		writeAgentPlugin(join(root, "summarizer"));

		expect(resolveConfiguredPluginModulePaths(["summarizer"], root)).toEqual(
			[],
		);
	});

	it("detects an Agent Plugin manifest only when it is a regular file", () => {
		const root = createTempRoot();
		expect(isAgentPluginDirectory(root)).toBe(false);

		mkdirSync(join(root, "plugin.json"), { recursive: true });
		expect(isAgentPluginDirectory(root)).toBe(false);

		rmSync(join(root, "plugin.json"), { recursive: true, force: true });
		writeFileSync(join(root, "plugin.json"), "{}");
		expect(isAgentPluginDirectory(root)).toBe(true);
	});
});
