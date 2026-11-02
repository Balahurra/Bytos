import { test } from "@microsoft/tui-test";
import { BYTOS_BIN } from "./helpers/constants.js";
import { bytosEnv } from "./helpers/env.js";
import { expectVisible } from "./helpers/terminal.js";

const HELP_TERMINAL = { columns: 120, rows: 50 };

// ===========================================================================
// bytos --help  (root help)
// ===========================================================================
test.describe("bytos --help", () => {
	test.use({
		program: { file: BYTOS_BIN, args: ["--help"] },
		env: bytosEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});

	test("shows Usage line and lists all subcommands", async ({ terminal }) => {
		await expectVisible(terminal, [
			"Usage:",
			"history|h",
			"auth [options]",
			"version",
			"update [options]",
			"hub ",
		]);
	});

	test("shows all root-level option flags", async ({ terminal }) => {
		await expectVisible(terminal, [
			"--plan",
			"--timeout",
			"--model",
			"--verbose",
			"--cwd",
			"--config",
			"--thinking",
			"--retries",
			"--json",
			"--acp",
			"--update",
		]);
	});
});

// ===========================================================================
// bytos -h  (short help flag)
// ===========================================================================
test.describe("bytos -h", () => {
	test.use({
		program: { file: BYTOS_BIN, args: ["-h"] },
		env: bytosEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});

	test("shows Usage line with short flag", async ({ terminal }) => {
		await expectVisible(terminal, "Usage:");
	});
});

// ===========================================================================
// bytos history --help
// ===========================================================================
test.describe("bytos history --help", () => {
	test.use({
		program: { file: BYTOS_BIN, args: ["history", "--help"] },
		env: bytosEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});

	test("shows history usage and all flags", async ({ terminal }) => {
		await expectVisible(terminal, ["Usage:", "--limit", "--config"]);
	});
});

// ===========================================================================
// bytos h --help  (history alias)
// ===========================================================================
test.describe("bytos h --help (history alias)", () => {
	test.use({
		program: { file: BYTOS_BIN, args: ["h", "--help"] },
		env: bytosEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});

	test("shows history usage and flags via alias", async ({ terminal }) => {
		await expectVisible(terminal, ["Usage:", "--limit"]);
	});
});

// ===========================================================================
// bytos config --help
// ===========================================================================
test.describe("bytos config --help", () => {
	test.use({
		program: { file: BYTOS_BIN, args: ["config", "--help"] },
		env: bytosEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});

	test("shows config usage and --config flag", async ({ terminal }) => {
		await expectVisible(terminal, ["Usage:", "--config"]);
	});
});

// ===========================================================================
// bytos auth --help
// ===========================================================================
test.describe("bytos auth --help", () => {
	test.use({
		program: { file: BYTOS_BIN, args: ["auth", "--help"] },
		env: bytosEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});

	test("shows auth usage and all flags", async ({ terminal }) => {
		await expectVisible(terminal, [
			"Usage:",
			"--provider",
			"--apikey",
			"--modelid",
			"--baseurl",
			"--config",
		]);
	});
});

// ===========================================================================
// bytos version --help
// ===========================================================================
test.describe("bytos version --help", () => {
	test.use({
		program: { file: BYTOS_BIN, args: ["version", "--help"] },
		env: bytosEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});

	test("shows version command usage", async ({ terminal }) => {
		await expectVisible(terminal, "Usage:");
	});
});

// ===========================================================================
// bytos update --help
// ===========================================================================
test.describe("bytos update --help", () => {
	test.use({
		program: { file: BYTOS_BIN, args: ["update", "--help"] },
		env: bytosEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});

	test("shows update usage and --verbose flag", async ({ terminal }) => {
		await expectVisible(terminal, ["Usage:", "--verbose"]);
	});
});

// ===========================================================================
// bytos doctor --help
// ===========================================================================
test.describe("bytos doctor --help", () => {
	test.use({
		program: { file: BYTOS_BIN, args: ["doctor", "--help"] },
		env: bytosEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});

	test("shows doctor usage and lists fix and log subcommands", async ({
		terminal,
	}) => {
		await expectVisible(terminal, ["Usage:", "fix", "log"]);
	});
});
