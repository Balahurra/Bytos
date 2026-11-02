import { relative, sep } from "node:path";
import {
	resolveBytosDataDir,
	resolveBytosDir,
	setHomeDir,
} from "@bytos/shared/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLI_DEFAULT_MAX_CONSECUTIVE_MISTAKES } from "../runtime/defaults";
import { createProgram } from "./program";

/** Render an absolute path under `home` the way help text does: `~/...`. */
function tildePath(absolutePath: string, home: string): string {
	return `~/${relative(home, absolutePath).split(sep).join("/")}`;
}

describe("root option help text", () => {
	const FAKE_HOME = "/home/bytos-help-test";
	const savedEnv: Record<string, string | undefined> = {};

	beforeAll(() => {
		// Pin the resolver inputs so the defaults below are the true defaults
		// (no BYTOS_DIR/BYTOS_DATA_DIR overrides, known home directory).
		for (const key of ["BYTOS_DIR", "BYTOS_DATA_DIR"]) {
			savedEnv[key] = process.env[key];
			delete process.env[key];
		}
		setHomeDir(FAKE_HOME);
	});

	afterAll(() => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	});

	it("reports the actual resolver defaults for --config and --data-dir", () => {
		// A wide help width keeps each option description on one line so the
		// full default text can be matched.
		const help = createProgram()
			.configureHelp({ helpWidth: 500 })
			.helpInformation();

		const configDefault = tildePath(resolveBytosDir(), FAKE_HOME);
		const dataDirDefault = tildePath(resolveBytosDataDir(), FAKE_HOME);

		// Sanity-check the resolvers themselves so the assertions below can't
		// silently drift along with a resolver regression.
		expect(configDefault).toBe("~/.bytos");
		expect(dataDirDefault).toBe("~/.bytos/data");

		expect(help).toContain(
			`Configuration directory (default: ${configDefault})`,
		);
		expect(help).toContain(
			`Use isolated local state at this directory path (default: ${dataDirDefault})`,
		);
	});

	it("reports the --retries default that runs use", () => {
		const help = createProgram()
			.configureHelp({ helpWidth: 500 })
			.helpInformation();

		expect(help).toContain(
			`before exiting (default: ${CLI_DEFAULT_MAX_CONSECUTIVE_MISTAKES})`,
		);
	});

	it("rejects --retries without a count", () => {
		const program = createProgram().configureOutput({ writeErr: () => {} });

		expect(() => program.parse(["--retries"], { from: "user" })).toThrow(
			/argument missing/,
		);
	});
});
