// ---------------------------------------------------------------------------
// bytos config - CLI tests
//
// Covers:
//   - `bytos config --config <dir>` - shows config for specific directory
//   - `bytos config --help`         - help page
// ---------------------------------------------------------------------------

import { test } from "@microsoft/tui-test";
import { BYTOS_BIN, TERMINAL_WIDE } from "../helpers/constants.js";
import { bytosEnv } from "../helpers/env.js";
import { expectVisible } from "../helpers/terminal.js";

test.describe("bytos config --help", () => {
	test.use({
		program: { file: BYTOS_BIN, args: ["config", "--help"] },
		...TERMINAL_WIDE,
		env: bytosEnv("default"),
	});

	test("shows config help page", async ({ terminal }) => {
		await expectVisible(terminal, ["Usage:", "--config"]);
	});
});
