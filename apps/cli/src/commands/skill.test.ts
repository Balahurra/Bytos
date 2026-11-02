import { SKILLS_CLI_PACKAGE } from "@bytos/core";
import { describe, expect, it } from "vitest";
import { buildSkillsArgs } from "./skill";

describe("buildSkillsArgs", () => {
	it("runs the skills package through npx with -y", () => {
		expect(buildSkillsArgs(["list"])).toEqual([
			"-y",
			SKILLS_CLI_PACKAGE,
			"list",
		]);
	});

	it("injects --agent bytos for install-style subcommands", () => {
		expect(buildSkillsArgs(["install", "owner/repo"])).toEqual([
			"-y",
			SKILLS_CLI_PACKAGE,
			"add",
			"owner/repo",
			"--agent",
			"bytos",
		]);
		expect(buildSkillsArgs(["add", "owner/repo"])).toContain("bytos");
		expect(buildSkillsArgs(["i", "owner/repo"])).toContain("bytos");
		expect(buildSkillsArgs(["update", "owner/repo"])).toContain("bytos");
	});

	it("aliases uninstall to the skills remove subcommand", () => {
		expect(buildSkillsArgs(["uninstall", "my-skill"])).toEqual([
			"-y",
			SKILLS_CLI_PACKAGE,
			"remove",
			"my-skill",
			"--agent",
			"bytos",
		]);
	});

	it("does not inject when the user already targeted an agent", () => {
		expect(
			buildSkillsArgs(["install", "owner/repo", "--agent", "cursor"]),
		).not.toContain("bytos");
		expect(
			buildSkillsArgs(["install", "owner/repo", "-a", "cursor"]),
		).not.toContain("bytos");
		expect(
			buildSkillsArgs(["install", "owner/repo", "--agent=cursor"]),
		).not.toContain("bytos");
	});

	it("aliases install and uninstall when agent options come before the subcommand", () => {
		expect(
			buildSkillsArgs(["--agent", "cursor", "install", "owner/repo"]),
		).toEqual([
			"-y",
			SKILLS_CLI_PACKAGE,
			"--agent",
			"cursor",
			"add",
			"owner/repo",
		]);
		expect(
			buildSkillsArgs(["--agent=cursor", "uninstall", "my-skill"]),
		).toEqual([
			"-y",
			SKILLS_CLI_PACKAGE,
			"--agent=cursor",
			"remove",
			"my-skill",
		]);
	});

	it("does not scope non-install subcommands to bytos", () => {
		expect(buildSkillsArgs(["use", "owner/repo"])).not.toContain("--agent");
		expect(buildSkillsArgs(["list"])).not.toContain("--agent");
	});

	it("scopes remove-style subcommands to bytos", () => {
		expect(buildSkillsArgs(["remove"])).toEqual([
			"-y",
			SKILLS_CLI_PACKAGE,
			"remove",
			"--agent",
			"bytos",
		]);
		expect(buildSkillsArgs(["rm", "my-skill"])).toContain("bytos");
		expect(buildSkillsArgs(["r", "my-skill"])).toContain("bytos");
	});

	it("ignores leading flags when detecting the subcommand", () => {
		expect(buildSkillsArgs(["--global", "install", "owner/repo"])).toContain(
			"bytos",
		);
	});

	it("forwards an empty arg list unchanged", () => {
		expect(buildSkillsArgs([])).toEqual(["-y", SKILLS_CLI_PACKAGE]);
	});
});
