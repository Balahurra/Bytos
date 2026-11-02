import { expect, test } from "@microsoft/tui-test";
import { BYTOS_BIN } from "./helpers/constants.js";
import { bytosEnv } from "./helpers/env.js";
import { waitForChatReady } from "./helpers/page-objects/chat.js";
import { expectVisible, waitForTerminalExit } from "./helpers/terminal.js";

test.describe("bytos interactive basics", () => {
	test.use({
		program: { file: BYTOS_BIN, args: [] },
		rows: 50,
		columns: 120,
		env: bytosEnv("default"),
	});

	test("shows logo, prompt, and hints", async ({ terminal }) => {
		await waitForChatReady(terminal);
		await expectVisible(terminal, ["@ for file mentions", "Tab"]);
	});

	test("shows slash commands after / input", async ({ terminal }) => {
		await waitForChatReady(terminal);
		// Type "/" without submitting to trigger the slash menu
		terminal.write("/");
		await expectVisible(terminal, ["/settings", "/mcp"], {
			timeout: 10_000,
		});
	});

	test("opens the command palette with Ctrl+P", async ({ terminal }) => {
		await waitForChatReady(terminal);
		terminal.write("\x10");
		await expectVisible(terminal, [
			"Command Palette",
			"Change Model",
			"Manage MCP Servers",
		]);
	});
});

test.describe("bytos interactive provider flag", () => {
	test.use({
		program: { file: BYTOS_BIN, args: ["-P", "bytos"] },
		rows: 50,
		columns: 120,
		env: bytosEnv("default"),
	});

	test("exits idle TUI after one Ctrl+C", async ({ terminal }) => {
		await waitForChatReady(terminal);
		terminal.keyCtrlC();
		await expect(waitForTerminalExit(terminal, 5_000)).resolves.toBe(0);
	});
});
