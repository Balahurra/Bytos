// ---------------------------------------------------------------------------
// Shared constants for all test files.
//
// tui-test workers run with a minimal PATH, so we resolve the binary
// explicitly rather than relying on PATH lookup at test runtime.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

function resolveBytosBin(): string {
	const localBin = path.resolve(process.cwd(), "..", "..", "dist", "index.js");
	if (fs.existsSync(localBin)) {
		return localBin;
	}

	throw new Error(
		"Unable to resolve bytos binary. Run bun -F @bytos/cli build",
	);
}

export const BYTOS_BIN = resolveBytosBin();

// Standard terminal dimensions used across test suites
export const TERMINAL_WIDE = { columns: 120, rows: 50 } as const;
export const TERMINAL_NARROW = { columns: 80, rows: 30 } as const;

export const EXIT_CODE_SUCCESS = 0;
export const EXIT_CODE_FAIL = 1;
export const EXIT_CODE_TIMEOUT = 124;
