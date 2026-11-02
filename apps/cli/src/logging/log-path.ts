import { join } from "node:path";
import { resolveBytosDataDir } from "@bytos/core";
import { getCliBuildInfo } from "../utils/common";

/**
 * The CLI log file: `BYTOS_LOG_PATH` when set, otherwise
 * `<data dir>/logs/<cli name>.log`. The CLI logger writes here by default and
 * `bytos doctor` reads here, so both resolve the path through this function.
 */
export function resolveCliLogPath(): string {
	return (
		process.env.BYTOS_LOG_PATH?.trim() ||
		join(resolveBytosDataDir(), "logs", `${getCliBuildInfo().name}.log`)
	);
}
