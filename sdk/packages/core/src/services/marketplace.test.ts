import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setBytosDir, setHomeDir } from "@bytos/shared/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { uninstallMarketplaceEntry } from "./marketplace";
import { SKILLS_CLI_PACKAGE } from "./skills-cli";

describe("marketplace service", () => {
	let root = "";
	let home = "";
	let originalHome: string | undefined;
	let originalBytosDir: string | undefined;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "core-marketplace-"));
		home = join(root, "home");
		originalHome = process.env.HOME;
		originalBytosDir = process.env.BYTOS_DIR;
		process.env.HOME = home;
		process.env.BYTOS_DIR = join(home, ".bytos");
		setHomeDir(home);
		setBytosDir(process.env.BYTOS_DIR);
	});

	afterEach(() => {
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		if (originalBytosDir === undefined) {
			delete process.env.BYTOS_DIR;
		} else {
			process.env.BYTOS_DIR = originalBytosDir;
		}
		rmSync(root, { recursive: true, force: true });
	});

	it("uninstalls marketplace MCP servers from settings by default", async () => {
		const settingsPath = join(root, "bytos_mcp_settings.json");
		await writeFile(
			settingsPath,
			JSON.stringify(
				{
					mcpServers: {
						context7: { transport: { type: "stdio", command: "node" } },
						other: { transport: { type: "stdio", command: "node" } },
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const result = await uninstallMarketplaceEntry(
			{
				id: "context7",
				type: "mcp",
				name: "Context7",
				install: { args: ["context7", "node", "server.js"] },
			},
			{ mcpSettingsPath: settingsPath },
		);

		expect(result).toMatchObject({
			id: "context7",
			type: "mcp",
			status: "uninstalled",
			message: "Uninstalled Context7.",
		});
		const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
			mcpServers?: Record<string, unknown>;
		};
		expect(settings.mcpServers?.context7).toBeUndefined();
		expect(settings.mcpServers?.other).toBeDefined();
	});

	it("uninstalls marketplace skills through skills CLI remove", async () => {
		const skillDir = join(home, ".agents", "skills", "review-team");
		await mkdir(skillDir, { recursive: true });
		await writeFile(
			join(skillDir, "SKILL.md"),
			"---\nname: Review\n---\n",
			"utf8",
		);
		const calls: Array<{ command: string; args: string[] }> = [];

		const result = await uninstallMarketplaceEntry(
			{
				id: "review-team",
				type: "skill",
				name: "Review Team",
				install: {
					args: ["github.com/bytos/skills@review-team"],
				},
			},
			{
				spawnCommand: async (command, args) => {
					calls.push({ command, args });
					rmSync(skillDir, { recursive: true, force: true });
					return { exitCode: 0, stdout: "removed", stderr: "" };
				},
			},
		);

		expect(result).toMatchObject({
			id: "review-team",
			type: "skill",
			status: "uninstalled",
			message: "Uninstalled Review Team.",
		});
		expect(calls).toEqual([
			{
				command: "npx",
				args: ["-y", SKILLS_CLI_PACKAGE, "remove", "review-team", "-g", "-y"],
			},
		]);
		expect(existsSync(skillDir)).toBe(false);
	});

	it("cleans up remaining marketplace skill directories after skills CLI remove succeeds", async () => {
		const bytosSkillDir = join(
			process.env.BYTOS_DIR ?? "",
			"skills",
			"review-team",
		);
		await mkdir(bytosSkillDir, { recursive: true });
		await writeFile(join(bytosSkillDir, "SKILL.md"), "# Review Team", "utf8");

		const result = await uninstallMarketplaceEntry(
			{
				id: "review-team",
				type: "skill",
				name: "Review Team",
				install: { args: ["github.com/bytos/skills@review-team"] },
			},
			{
				spawnCommand: async () => ({
					exitCode: 0,
					stdout: "removed",
					stderr: "",
				}),
			},
		);

		expect(result.status).toBe("uninstalled");
		expect(result.output).toContain(`Removed: ${bytosSkillDir}`);
		expect(existsSync(bytosSkillDir)).toBe(false);
	});

	it("uninstalls official marketplace plugins by marketplace slug", async () => {
		const installPath = join(
			home,
			".bytos",
			"plugins",
			"_installed",
			"official",
			"goal-123456789abc",
		);
		const entryPath = join(installPath, "package", "index.ts");
		await mkdir(join(installPath, "package"), { recursive: true });
		await writeFile(
			join(installPath, "package.json"),
			JSON.stringify({ name: "goal" }, null, 2),
			"utf8",
		);
		await writeFile(
			entryPath,
			"export default { name: 'goal', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);

		const result = await uninstallMarketplaceEntry({
			id: "goal",
			type: "plugin",
			name: "Goal",
			install: { args: ["goal"] },
		});

		expect(result).toMatchObject({
			id: "goal",
			type: "plugin",
			status: "uninstalled",
			message: "Uninstalled Goal.",
		});
		expect(existsSync(installPath)).toBe(false);
	});
});
