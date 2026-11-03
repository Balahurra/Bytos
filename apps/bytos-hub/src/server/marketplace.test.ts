import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SKILLS_CLI_PACKAGE } from "@bytos/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildMarketplaceMcpInput,
	fetchMarketplaceCatalog,
	installMarketplaceEntry,
	installMarketplaceEntryForDesktopCommand,
	listMarketplaceInstalledEntries,
	uninstallLocalPrimitive,
	uninstallMarketplaceEntry,
	uninstallMarketplaceEntryForDesktopCommand,
} from "./marketplace";

describe("marketplace installer", () => {
	const originalWrapperPath = process.env.BYTOS_WRAPPER_PATH;
	const originalBytosDir = process.env.BYTOS_DIR;
	const originalHome = process.env.HOME;
	const originalMcpSettingsPath = process.env.BYTOS_MCP_SETTINGS_PATH;

	afterEach(() => {
		if (originalWrapperPath === undefined) {
			delete process.env.BYTOS_WRAPPER_PATH;
		} else {
			process.env.BYTOS_WRAPPER_PATH = originalWrapperPath;
		}
		if (originalBytosDir === undefined) {
			delete process.env.BYTOS_DIR;
		} else {
			process.env.BYTOS_DIR = originalBytosDir;
		}
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		if (originalMcpSettingsPath === undefined) {
			delete process.env.BYTOS_MCP_SETTINGS_PATH;
		} else {
			process.env.BYTOS_MCP_SETTINGS_PATH = originalMcpSettingsPath;
		}
		vi.restoreAllMocks();
	});

	function createInstalledOfficialPlugin(
		bytosDir: string,
		slug: string,
	): string {
		const sourceKey = `official:https://github.com/bytos/plugins.git#plugins/${slug}`;
		const hash = createHash("sha256")
			.update(sourceKey)
			.digest("hex")
			.slice(0, 12);
		const installPath = join(
			bytosDir,
			"plugins",
			"_installed",
			"official",
			`${slug}-${hash}`,
		);
		mkdirSync(join(installPath, "package"), { recursive: true });
		writeFileSync(
			join(installPath, "package.json"),
			JSON.stringify({ name: slug }, null, 2),
			"utf8",
		);
		writeFileSync(
			join(installPath, "package", "index.ts"),
			`export default { name: "${slug}", manifest: { capabilities: ["tools"] } };`,
			"utf8",
		);
		return installPath;
	}

	it("maps remote MCP catalog args to MCP settings shape", () => {
		expect(
			buildMarketplaceMcpInput([
				"context7",
				"--transport",
				"http",
				"https://mcp.context7.com/mcp",
				"--header",
				"Authorization: Bearer <token>",
			]),
		).toEqual({
			name: "context7",
			transportType: "streamableHttp",
			url: "https://mcp.context7.com/mcp",
			headers: {
				Authorization: "Bearer <token>",
			},
			disabled: false,
		});
	});

	it("maps stdio MCP catalog args to command and args", () => {
		expect(
			buildMarketplaceMcpInput(["filesystem", "npx", "-y", "server", "/tmp"]),
		).toEqual({
			name: "filesystem",
			transportType: "stdio",
			command: "npx",
			args: ["-y", "server", "/tmp"],
			disabled: false,
		});
	});

	it("preserves server flags after stdio MCP command args begin", () => {
		expect(
			buildMarketplaceMcpInput([
				"search",
				"npx",
				"-y",
				"server",
				"--transport",
				"stdio",
			]),
		).toEqual({
			name: "search",
			transportType: "stdio",
			command: "npx",
			args: ["-y", "server", "--transport", "stdio"],
			disabled: false,
		});
	});

	it("runs skills globally for Bytos without prompts", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "bytos-marketplace-home-"));
		process.env.HOME = homeDir;
		const spawnCommand = vi.fn(async () => {
			mkdirSync(join(homeDir, ".agents", "skills", "web-design-guidelines"), {
				recursive: true,
			});
			writeFileSync(
				join(homeDir, ".agents", "skills", "web-design-guidelines", "SKILL.md"),
				"---\nname: web-design-guidelines\n---\n",
			);
			return {
				exitCode: 0,
				stdout: "installed",
				stderr: "",
			};
		});

		await installMarketplaceEntry(
			{
				entry: {
					id: "web-design-guidelines",
					type: "skill",
					name: "Web Design Guidelines",
					install: {
						args: [
							"vercel-labs/agent-skills",
							"--skill",
							"web-design-guidelines",
						],
					},
				},
			},
			{ spawnCommand },
		);

		expect(spawnCommand).toHaveBeenCalledWith("npx", [
			"-y",
			SKILLS_CLI_PACKAGE,
			"add",
			"vercel-labs/agent-skills",
			"--skill",
			"web-design-guidelines",
			"-g",
			"-a",
			"bytos",
			"-y",
		]);
	});

	it("skips skill install commands when the global skill already exists", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "bytos-marketplace-home-"));
		process.env.HOME = homeDir;
		mkdirSync(join(homeDir, ".agents", "skills", "bytos-sdk"), {
			recursive: true,
		});
		writeFileSync(
			join(homeDir, ".agents", "skills", "bytos-sdk", "SKILL.md"),
			"---\nname: bytos-sdk\n---\n",
		);
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: "",
			stderr: "",
		}));

		await expect(
			installMarketplaceEntry(
				{
					entry: {
						id: "bytos-sdk",
						type: "skill",
						name: "Bytos SDK",
						install: { args: ["bytos/sdk-skill"] },
					},
				},
				{ spawnCommand },
			),
		).resolves.toMatchObject({
			status: "installed",
			message: "Bytos SDK is already installed.",
		});
		expect(spawnCommand).not.toHaveBeenCalled();
	});

	it("reports Bytos global skills as marketplace-installed", () => {
		const bytosDir = mkdtempSync(join(tmpdir(), "bytos-marketplace-bytos-"));
		process.env.BYTOS_DIR = bytosDir;
		mkdirSync(join(bytosDir, "skills", "bytos-sdk"), {
			recursive: true,
		});
		writeFileSync(
			join(bytosDir, "skills", "bytos-sdk", "SKILL.md"),
			"---\nname: bytos-sdk\n---\n",
		);

		expect(
			listMarketplaceInstalledEntries({
				entries: [
					{
						id: "bytos-sdk",
						type: "skill",
						name: "Bytos SDK",
						install: { args: ["bytos/sdk-skill"] },
					},
				],
			}),
		).toEqual({ installedKeys: ["skill:bytos-sdk"] });
	});

	it("accepts skill installs that create Bytos global skills", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "bytos-marketplace-home-"));
		const bytosDir = join(homeDir, ".bytos");
		process.env.HOME = homeDir;
		process.env.BYTOS_DIR = bytosDir;
		const spawnCommand = vi.fn(async () => {
			mkdirSync(join(bytosDir, "skills", "bytos-sdk"), {
				recursive: true,
			});
			writeFileSync(
				join(bytosDir, "skills", "bytos-sdk", "SKILL.md"),
				"---\nname: bytos-sdk\n---\n",
			);
			return {
				exitCode: 0,
				stdout: "installed",
				stderr: "",
			};
		});

		await expect(
			installMarketplaceEntry(
				{
					entry: {
						id: "bytos-sdk",
						type: "skill",
						name: "Bytos SDK",
						install: { args: ["bytos/sdk-skill"] },
					},
				},
				{ spawnCommand },
			),
		).resolves.toMatchObject({
			status: "installed",
			message: "Installed Bytos SDK globally for Bytos.",
		});
	});

	it("removes Bytos global marketplace skills without prompts", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "bytos-marketplace-home-"));
		process.env.HOME = homeDir;
		const skillDir = join(homeDir, ".agents", "skills", "bytos-sdk");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, "SKILL.md"), "---\nname: bytos-sdk\n---\n");
		const spawnCommand = vi.fn(async () => {
			rmSync(skillDir, { recursive: true, force: true });
			return {
				exitCode: 0,
				stdout: "removed",
				stderr: "",
			};
		});

		await expect(
			uninstallMarketplaceEntry(
				{
					entry: {
						id: "bytos-sdk",
						type: "skill",
						name: "Bytos SDK",
						install: { args: ["bytos/sdk-skill"] },
					},
				},
				{ spawnCommand },
			),
		).resolves.toMatchObject({
			status: "uninstalled",
			message: "Uninstalled Bytos SDK.",
		});
		expect(spawnCommand).toHaveBeenCalledWith("npx", [
			"-y",
			SKILLS_CLI_PACKAGE,
			"remove",
			"bytos-sdk",
			"-g",
			"-y",
		]);
	});

	it("does not report project-local skills as marketplace-installed globals", () => {
		const homeDir = mkdtempSync(join(tmpdir(), "bytos-marketplace-home-"));
		process.env.HOME = homeDir;

		expect(
			listMarketplaceInstalledEntries(
				{
					entries: [
						{
							id: "bytos-sdk",
							type: "skill",
							name: "Bytos SDK",
							install: { args: ["bytos/sdk-skill"] },
						},
					],
				},
				{
					skills: [
						{
							id: "bytos-sdk",
							name: "bytos-sdk",
							path: "/workspace/project/.agents/skills/bytos-sdk/SKILL.md",
						},
					],
				},
			),
		).toEqual({ installedKeys: [] });
	});

	it("rejects skill installs that exit zero but report failure", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "bytos-marketplace-home-"));
		process.env.HOME = homeDir;
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: "Failed to install 1",
			stderr: "",
		}));

		await expect(
			installMarketplaceEntry(
				{
					entry: {
						id: "bytos-sdk",
						type: "skill",
						name: "Bytos SDK",
						install: { args: ["bytos/sdk-skill"] },
					},
				},
				{ spawnCommand },
			),
		).rejects.toThrow("Skill install failed");
	});

	it("redacts common secret formats from failed install output", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "bytos-marketplace-home-"));
		process.env.HOME = homeDir;
		const spawnCommand = vi.fn(async () => ({
			exitCode: 1,
			stdout:
				"Authorization: Bearer stdout-token\nAuthorization: Basic basic-token\napi key stdout-key\nOPENAI_API_KEY=compound-key",
			stderr:
				"TOKEN=stderr-token\npassword is stderr-password\nANTHROPIC_SECRET_KEY=anthropic-secret",
		}));

		let message = "";
		try {
			await installMarketplaceEntry(
				{
					entry: {
						id: "bytos-sdk",
						type: "skill",
						name: "Bytos SDK",
						install: { args: ["bytos/sdk-skill"] },
					},
				},
				{ spawnCommand },
			);
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}

		expect(message).toContain("Authorization: Bearer [redacted]");
		expect(message).toContain("Authorization: [redacted]");
		expect(message).not.toContain("Authorization: Bearer [redacted]]");
		expect(message).toContain("api key [redacted]");
		expect(message).toContain("OPENAI_API_KEY=[redacted]");
		expect(message).toContain("TOKEN=[redacted]");
		expect(message).toContain("password is [redacted]");
		expect(message).toContain("ANTHROPIC_SECRET_KEY=[redacted]");
		expect(message).not.toContain("stdout-token");
		expect(message).not.toContain("basic-token");
		expect(message).not.toContain("stdout-key");
		expect(message).not.toContain("compound-key");
		expect(message).not.toContain("stderr-token");
		expect(message).not.toContain("stderr-password");
		expect(message).not.toContain("anthropic-secret");
	});

	it("rejects skill installs before spawning when the global skill directory is not writable", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "bytos-marketplace-home-"));
		process.env.HOME = homeDir;
		mkdirSync(join(homeDir, ".agents"), { recursive: true });
		writeFileSync(join(homeDir, ".agents", "skills"), "");
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: "",
			stderr: "",
		}));

		await expect(
			installMarketplaceEntry(
				{
					entry: {
						id: "bytos-sdk",
						type: "skill",
						name: "Bytos SDK",
						install: { args: ["bytos/sdk-skill"] },
					},
				},
				{ spawnCommand },
			),
		).rejects.toThrow(
			"Cannot install skill globally because ~/.agents/skills is not writable",
		);
		expect(spawnCommand).not.toHaveBeenCalled();
	});

	it("rejects skill installs that do not create a global skill", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "bytos-marketplace-home-"));
		process.env.HOME = homeDir;
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: "Installation complete",
			stderr: "",
		}));

		await expect(
			installMarketplaceEntry(
				{
					entry: {
						id: "bytos-sdk",
						type: "skill",
						name: "Bytos SDK",
						install: { args: ["bytos/sdk-skill"] },
					},
				},
				{ spawnCommand },
			),
		).rejects.toThrow("was not found in Bytos's global skills directories");
	});

	it("runs official plugin installs through the current Bytos CLI", async () => {
		process.env.BYTOS_WRAPPER_PATH = "/usr/local/bin/bytos";
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: JSON.stringify({ installPath: "/tmp/plugin" }),
			stderr: "",
		}));

		await installMarketplaceEntry(
			{
				entry: {
					id: "marketplace-test-plugin",
					type: "plugin",
					name: "Marketplace Test Plugin",
					install: { args: ["marketplace-test-plugin"] },
				},
			},
			{ spawnCommand },
		);

		expect(spawnCommand).toHaveBeenCalledWith("/usr/local/bin/bytos", [
			"plugin",
			"install",
			"marketplace-test-plugin",
			"--json",
		]);
	});

	it("runs MCP installs through the current Bytos CLI without prompts", async () => {
		process.env.BYTOS_WRAPPER_PATH = "/usr/local/bin/bytos";
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: JSON.stringify({
				name: "context7",
				status: "installed",
				transport: {
					type: "streamableHttp",
					url: "https://mcp.context7.com/mcp",
					headers: {
						Authorization: "Bearer token",
					},
				},
			}),
			stderr: "",
		}));

		await expect(
			installMarketplaceEntry(
				{
					entry: {
						id: "context7",
						type: "mcp",
						name: "Context7",
						install: {
							args: [
								"context7",
								"--transport",
								"http",
								"https://mcp.context7.com/mcp",
								"--header",
								"Authorization: Bearer token",
							],
						},
					},
				},
				{ spawnCommand },
			),
		).resolves.toMatchObject({
			status: "installed",
			message: "Installed Context7.",
			details: {
				name: "context7",
				status: "installed",
			},
		});

		expect(spawnCommand).toHaveBeenCalledWith("/usr/local/bin/bytos", [
			"mcp",
			"install",
			"--yes",
			"--json",
			"context7",
			"--transport",
			"http",
			"https://mcp.context7.com/mcp",
			"--header",
			"Authorization: Bearer token",
		]);
	});

	it("uninstalls official marketplace plugins through the shared core service", async () => {
		const bytosDir = mkdtempSync(join(tmpdir(), "bytos-marketplace-plugin-"));
		process.env.BYTOS_DIR = bytosDir;
		const installPath = createInstalledOfficialPlugin(bytosDir, "goal");
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: "",
			stderr: "",
		}));

		await expect(
			uninstallMarketplaceEntry(
				{
					entry: {
						id: "goal",
						type: "plugin",
						name: "Goal",
						install: { args: ["goal"] },
					},
				},
				{ spawnCommand },
			),
		).resolves.toMatchObject({
			status: "uninstalled",
			message: "Uninstalled Goal.",
		});

		expect(spawnCommand).not.toHaveBeenCalled();
		expect(existsSync(installPath)).toBe(false);
	});

	it("resolves desktop installs from the server catalog instead of browser-sent args", async () => {
		process.env.BYTOS_WRAPPER_PATH = "/usr/local/bin/bytos";
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: JSON.stringify({ installPath: "/tmp/plugin" }),
			stderr: "",
		}));

		await installMarketplaceEntryForDesktopCommand(
			{
				entry: {
					id: "marketplace-test-plugin",
					type: "plugin",
					name: "Tampered",
					install: { args: ["malicious-source"] },
				},
			},
			{
				spawnCommand,
				loadCatalog: async () => ({
					entries: [
						{
							id: "marketplace-test-plugin",
							type: "plugin",
							name: "Marketplace Test Plugin",
							install: { args: ["marketplace-test-plugin"] },
						},
					],
				}),
			},
		);

		expect(spawnCommand).toHaveBeenCalledWith("/usr/local/bin/bytos", [
			"plugin",
			"install",
			"marketplace-test-plugin",
			"--json",
		]);
	});

	it("resolves desktop uninstalls from the server catalog instead of browser-sent args", async () => {
		const bytosDir = mkdtempSync(join(tmpdir(), "bytos-marketplace-plugin-"));
		process.env.BYTOS_DIR = bytosDir;
		const installPath = createInstalledOfficialPlugin(bytosDir, "goal");
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: "",
			stderr: "",
		}));

		await uninstallMarketplaceEntryForDesktopCommand(
			{
				entry: {
					id: "goal",
					type: "plugin",
					name: "Tampered",
					install: { args: ["malicious-source"] },
				},
			},
			{
				spawnCommand,
				loadCatalog: async () => ({
					entries: [
						{
							id: "goal",
							type: "plugin",
							name: "Goal",
							install: { args: ["goal"] },
						},
					],
				}),
			},
		);

		expect(spawnCommand).not.toHaveBeenCalled();
		expect(existsSync(installPath)).toBe(false);
	});

	it("uninstalls MCP marketplace entries from Bytos MCP settings", async () => {
		const settingsPath = join(
			mkdtempSync(join(tmpdir(), "bytos-marketplace-mcp-")),
			"bytos_mcp_settings.json",
		);
		process.env.BYTOS_MCP_SETTINGS_PATH = settingsPath;
		writeFileSync(
			settingsPath,
			JSON.stringify(
				{
					mcpServers: {
						context7: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.context7.com/mcp",
							},
						},
					},
				},
				null,
				2,
			),
		);

		await expect(
			uninstallMarketplaceEntry({
				entry: {
					id: "context7",
					type: "mcp",
					name: "Context7",
					install: {
						args: [
							"context7",
							"--transport",
							"http",
							"https://mcp.context7.com/mcp",
						],
					},
				},
			}),
		).resolves.toMatchObject({
			status: "uninstalled",
			message: "Uninstalled Context7.",
		});
		expect(
			listMarketplaceInstalledEntries({
				entries: [
					{
						id: "context7",
						type: "mcp",
						name: "Context7",
						install: {
							args: [
								"context7",
								"--transport",
								"http",
								"https://mcp.context7.com/mcp",
							],
						},
					},
				],
			}),
		).toEqual({ installedKeys: [] });
	});

	it("uninstalls local MCP servers by name", async () => {
		const settingsPath = join(
			mkdtempSync(join(tmpdir(), "bytos-local-mcp-")),
			"bytos_mcp_settings.json",
		);
		process.env.BYTOS_MCP_SETTINGS_PATH = settingsPath;
		writeFileSync(
			settingsPath,
			JSON.stringify(
				{
					mcpServers: {
						context7: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.context7.com/mcp",
							},
						},
					},
				},
				null,
				2,
			),
		);

		await expect(
			uninstallLocalPrimitive({
				type: "mcp",
				id: "context7",
				name: "context7",
			}),
		).resolves.toMatchObject({
			status: "uninstalled",
			message: "Uninstalled context7.",
		});
		expect(readFileSync(settingsPath, "utf8")).not.toContain("context7");
	});

	it("uninstalls local skills by removing their configured skill directory", async () => {
		const workspaceRoot = mkdtempSync(join(tmpdir(), "bytos-local-skill-"));
		const skillDir = join(workspaceRoot, ".bytos", "skills", "review");
		mkdirSync(skillDir, { recursive: true });
		const skillPath = join(skillDir, "SKILL.md");
		writeFileSync(skillPath, "---\nname: review\n---\nReview changes.");

		await expect(
			uninstallLocalPrimitive(
				{
					type: "skill",
					id: "review",
					name: "Review",
					path: skillPath,
				},
				{ workspaceRoot },
			),
		).resolves.toMatchObject({
			status: "uninstalled",
			message: "Uninstalled Review.",
		});
		expect(existsSync(skillDir)).toBe(false);
	});

	it("reports official plugin marketplace entries installed from Bytos home", () => {
		const bytosDir = mkdtempSync(join(tmpdir(), "bytos-marketplace-test-"));
		process.env.BYTOS_DIR = bytosDir;
		const sourceKey =
			"official:https://github.com/bytos/plugins.git#plugins/goal";
		const hash = createHash("sha256")
			.update(sourceKey)
			.digest("hex")
			.slice(0, 12);
		mkdirSync(
			join(bytosDir, "plugins", "_installed", "official", `goal-${hash}`),
			{
				recursive: true,
			},
		);

		expect(
			listMarketplaceInstalledEntries({
				entries: [
					{
						id: "goal",
						type: "plugin",
						name: "Goal",
						install: { args: ["goal"] },
					},
				],
			}),
		).toEqual({ installedKeys: ["plugin:goal"] });
	});

	it("does not report plugin inventory substring matches as installed", () => {
		process.env.BYTOS_DIR = mkdtempSync(
			join(tmpdir(), "bytos-marketplace-test-"),
		);

		expect(
			listMarketplaceInstalledEntries(
				{
					entries: [
						{
							id: "goal",
							type: "plugin",
							name: "Goal",
							install: { args: ["goal"] },
						},
					],
				},
				{
					plugins: [
						{
							name: "goal-helper",
							path: "/workspace/.bytos/plugins/goal-helper/index.ts",
						},
					],
				},
			),
		).toEqual({ installedKeys: [] });
	});

	it("skips invalid marketplace entries during installed-status checks", () => {
		const bytosDir = mkdtempSync(join(tmpdir(), "bytos-marketplace-test-"));
		process.env.BYTOS_DIR = bytosDir;
		const sourceKey =
			"official:https://github.com/bytos/plugins.git#plugins/goal";
		const hash = createHash("sha256")
			.update(sourceKey)
			.digest("hex")
			.slice(0, 12);
		mkdirSync(
			join(bytosDir, "plugins", "_installed", "official", `goal-${hash}`),
			{
				recursive: true,
			},
		);

		expect(
			listMarketplaceInstalledEntries({
				entries: [
					{
						id: "broken-mcp",
						type: "mcp",
						name: "Broken MCP",
						install: {
							args: [
								"broken-mcp",
								"--transport",
								"ws",
								"https://example.com/mcp",
							],
						},
					},
					{
						id: "goal",
						type: "plugin",
						name: "Goal",
						install: { args: ["goal"] },
					},
				],
			}),
		).toEqual({ installedKeys: ["plugin:goal"] });
	});

	it("rejects invalid marketplace entries before spawning commands", async () => {
		const spawnCommand = vi.fn(async () => ({
			exitCode: 0,
			stdout: "",
			stderr: "",
		}));

		await expect(
			installMarketplaceEntry(
				{
					entry: {
						id: "bad",
						type: "skill",
						install: { args: [] },
					},
				},
				{ spawnCommand },
			),
		).rejects.toThrow("marketplace install args are required");
		expect(spawnCommand).not.toHaveBeenCalled();
	});

	it("fetches the marketplace catalog through the server helper", async () => {
		const fetchImpl = vi.fn(async () => {
			return new Response(JSON.stringify({ version: 1, entries: [] }), {
				headers: { "content-type": "application/json" },
			});
		});
		const previousUrl = process.env.BYTOS_MARKETPLACE_CATALOG_URL;
		process.env.BYTOS_MARKETPLACE_CATALOG_URL = "https://marketplace.example.test/catalog.json";

		try {
			await expect(fetchMarketplaceCatalog(fetchImpl)).resolves.toEqual({
				version: 1,
				entries: [],
			});
			expect(fetchImpl).toHaveBeenCalledWith(
				"https://marketplace.example.test/catalog.json",
				{ headers: { Accept: "application/json" } },
			);
		} finally {
			if (previousUrl === undefined) {
				delete process.env.BYTOS_MARKETPLACE_CATALOG_URL;
			} else {
				process.env.BYTOS_MARKETPLACE_CATALOG_URL = previousUrl;
			}
		}
	})

	it("returns an empty catalog when no Bytos catalog URL is configured", async () => {
		const fetchImpl = vi.fn();
		const previousUrl = process.env.BYTOS_MARKETPLACE_CATALOG_URL;
		delete process.env.BYTOS_MARKETPLACE_CATALOG_URL;

		try {
			const catalog = (await fetchMarketplaceCatalog(fetchImpl)) as { entries: unknown[] }
			expect(catalog.entries).toEqual([])
			expect(fetchImpl).not.toHaveBeenCalled()
		} finally {
			if (previousUrl !== undefined) {
				process.env.BYTOS_MARKETPLACE_CATALOG_URL = previousUrl
			}
		}
	});

	it("surfaces marketplace catalog upstream failures", async () => {
		const fetchImpl = vi.fn(async () => {
			return new Response("nope", {
				status: 503,
				statusText: "Service Unavailable",
			});
		});
		const previousUrl = process.env.BYTOS_MARKETPLACE_CATALOG_URL;
		process.env.BYTOS_MARKETPLACE_CATALOG_URL = "https://marketplace.example.test/catalog.json";

		try {
			await expect(fetchMarketplaceCatalog(fetchImpl)).rejects.toThrow(
				"Failed to fetch marketplace catalog: 503 Service Unavailable",
			);
		} finally {
			if (previousUrl === undefined) {
				delete process.env.BYTOS_MARKETPLACE_CATALOG_URL;
			} else {
				process.env.BYTOS_MARKETPLACE_CATALOG_URL = previousUrl;
			}
		}
	});
});
