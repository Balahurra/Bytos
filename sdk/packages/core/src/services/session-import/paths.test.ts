import { posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import {
	claudeCodeProjectsDir,
	codexHomeDir,
	type SessionImportPathEnvironment,
} from "./paths";

function windowsEnvironment(
	env: Record<string, string | undefined>,
): SessionImportPathEnvironment {
	return {
		platform: "win32",
		homeDir: "/home/inherited-from-shell",
		env,
		joinPath: win32.join,
	};
}

function posixEnvironment(
	env: Record<string, string | undefined>,
): SessionImportPathEnvironment {
	return {
		platform: "linux",
		homeDir: "/home/alice",
		env,
		joinPath: posix.join,
	};
}

describe("Windows session import paths", () => {
	it("uses USERPROFILE for each tool instead of an inherited Unix HOME", () => {
		const environment = windowsEnvironment({
			HOME: "/home/inherited-from-shell",
			USERPROFILE: String.raw`C:\Users\Alice`,
			HOMEDRIVE: "D:",
			HOMEPATH: String.raw`\Profiles\Other`,
		});

		expect(claudeCodeProjectsDir(environment)).toBe(
			String.raw`C:\Users\Alice\.claude\projects`,
		);
		expect(codexHomeDir(environment)).toBe(String.raw`C:\Users\Alice\.codex`);
	});

	it("falls back to HOMEDRIVE and HOMEPATH", () => {
		const environment = windowsEnvironment({
			HOMEDRIVE: "D:",
			HOMEPATH: String.raw`\Profiles\Alice`,
		});

		expect(codexHomeDir(environment)).toBe(
			String.raw`D:\Profiles\Alice\.codex`,
		);
	});

	it("preserves tool-specific overrides", () => {
		const environment = windowsEnvironment({
			USERPROFILE: String.raw`C:\Users\Alice`,
			CLAUDE_CONFIG_DIR: String.raw`D:\Claude Data`,
			CODEX_HOME: String.raw`\\server\share\Codex`,
		});

		expect(claudeCodeProjectsDir(environment)).toBe(
			String.raw`D:\Claude Data\projects`,
		);
		expect(codexHomeDir(environment)).toBe(String.raw`\\server\share\Codex`);
	});

	it("supports a home at the drive root", () => {
		const environment = windowsEnvironment({
			HOMEDRIVE: "D:",
			HOMEPATH: "\\",
		});

		expect(codexHomeDir(environment)).toBe(String.raw`D:\.codex`);
	});

	it("falls back to the runtime home directory without profile variables", () => {
		const environment = windowsEnvironment({});
		environment.homeDir = String.raw`C:\RuntimeHome`;

		expect(codexHomeDir(environment)).toBe(String.raw`C:\RuntimeHome\.codex`);
	});

	it("preserves whitespace in nonblank overrides", () => {
		const environment = windowsEnvironment({
			CLAUDE_CONFIG_DIR: String.raw`D:\Claude Data `,
			CODEX_HOME: String.raw`\\server\share\Codex `,
		});

		expect(claudeCodeProjectsDir(environment)).toBe(
			String.raw`D:\Claude Data \projects`,
		);
		expect(codexHomeDir(environment)).toBe(String.raw`\\server\share\Codex `);
	});

	it("ignores empty environment overrides", () => {
		const environment = windowsEnvironment({
			USERPROFILE: String.raw`C:\Users\Alice`,
			CLAUDE_CONFIG_DIR: " ",
			CODEX_HOME: "",
		});

		expect(claudeCodeProjectsDir(environment)).toBe(
			String.raw`C:\Users\Alice\.claude\projects`,
		);
		expect(codexHomeDir(environment)).toBe(String.raw`C:\Users\Alice\.codex`);
	});
});

describe("POSIX session import paths", () => {
	it.each([
		"/mnt/store ",
		" relative store ",
	])("preserves surrounding whitespace in %j", (path) => {
		const environment = posixEnvironment({
			CLAUDE_CONFIG_DIR: path,
			CODEX_HOME: path,
		});

		expect(claudeCodeProjectsDir(environment)).toBe(`${path}/projects`);
		expect(codexHomeDir(environment)).toBe(path);
	});

	it.each(["", " \t "])("ignores blank overrides %j", (value) => {
		const environment = posixEnvironment({
			CLAUDE_CONFIG_DIR: value,
			CODEX_HOME: value,
		});

		expect(claudeCodeProjectsDir(environment)).toBe(
			"/home/alice/.claude/projects",
		);
		expect(codexHomeDir(environment)).toBe("/home/alice/.codex");
	});

	it("uses the home directory for default tool stores", () => {
		const environment = posixEnvironment({ USERPROFILE: "/windows/profile" });

		expect(claudeCodeProjectsDir(environment)).toBe(
			"/home/alice/.claude/projects",
		);
		expect(codexHomeDir(environment)).toBe("/home/alice/.codex");
	});

	it("preserves tool-specific overrides", () => {
		const environment = posixEnvironment({
			CLAUDE_CONFIG_DIR: "/mnt/claude",
			CODEX_HOME: "/mnt/codex",
		});

		expect(claudeCodeProjectsDir(environment)).toBe("/mnt/claude/projects");
		expect(codexHomeDir(environment)).toBe("/mnt/codex");
	});
});
