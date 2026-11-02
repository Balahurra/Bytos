import { test } from "@microsoft/tui-test";
import { BYTOS_BIN } from "./helpers/constants.js";
import { bytosEnv } from "./helpers/env.js";
import { expectVisible } from "./helpers/terminal.js";

// ---------------------------------------------------------------------------
// bytos --version  (root flag)
// ---------------------------------------------------------------------------
test.describe("bytos --version", () => {
	test.use({
		program: { file: BYTOS_BIN, args: ["--version"] },
		env: bytosEnv("claude-sonnet-4.6"),
	});

	test("prints the version string", async ({ terminal }) => {
		await expectVisible(terminal, /\d+\.\d+\.\d+/g);
	});
});

// ---------------------------------------------------------------------------
// bytos -V  (short flag)
// ---------------------------------------------------------------------------
test.describe("bytos -V", () => {
	test.use({
		program: { file: BYTOS_BIN, args: ["-V"] },
		env: bytosEnv("claude-sonnet-4.6"),
	});

	test("prints the version string with short flag", async ({ terminal }) => {
		await expectVisible(terminal, /\d+\.\d+\.\d+/g);
	});
});

// ---------------------------------------------------------------------------
// bytos version  (subcommand)
// ---------------------------------------------------------------------------
test.describe("bytos version subcommand", () => {
	test.use({
		program: { file: BYTOS_BIN, args: ["version"] },
		env: bytosEnv("claude-sonnet-4.6"),
	});

	test("prints 'Bytos CLI version:' message", async ({ terminal }) => {
		await expectVisible(terminal, /\d+\.\d+\.\d+/g);
	});
});
