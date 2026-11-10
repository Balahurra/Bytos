import type { GlobalSettings } from "@bytos/core";
import type { CliAgentMode, CliCompactionMode, ParsedArgs } from "./types";

/**
 * Resolves general settings at CLI startup with the precedence
 * explicit CLI flag -> persisted global setting -> built-in default,
 * so choices made in the TUI /settings panel survive restarts (see
 * https://github.com/Balahurra/Bytos/issues/12158).
 */

export function resolveStartupMode(
	args: Pick<ParsedArgs, "mode" | "modeExplicitlySet">,
	settings: GlobalSettings,
): CliAgentMode {
	if (args.modeExplicitlySet) {
		return args.mode;
	}
	return settings.planActMode ?? args.mode;
}

/**
 * Built-in CLI approval default. Privileged tools must be opted into
 * explicitly (flag or persisted setting); an unset install is not trusted.
 */
export const CLI_DEFAULT_TOOL_AUTO_APPROVE = false;

export function resolveStartupToolAutoApprove(
	args: Pick<ParsedArgs, "autoApproveOverride">,
	settings: GlobalSettings,
	defaultToolAutoApprove: boolean,
): boolean {
	return (
		args.autoApproveOverride ??
		settings.toolAutoApprove ??
		defaultToolAutoApprove
	);
}

/**
 * Returns undefined when neither a flag nor a persisted value exists, so
 * callers fall through to Core's compaction default.
 */
export function resolveStartupCompactionMode(
	args: Pick<ParsedArgs, "compactionMode">,
	settings: GlobalSettings,
): CliCompactionMode | undefined {
	if (args.compactionMode) {
		return args.compactionMode;
	}
	if (settings.compactionEnabled === false) {
		return "off";
	}
	return settings.compactionStrategy;
}
