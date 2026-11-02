import { buildBytosSystemPrompt } from "@bytos/shared";
import type { DelegatedAgentRuntimeConfig } from "./delegated-agent";

export function buildTeammateSystemPrompt(
	prompt: string,
	config: DelegatedAgentRuntimeConfig,
): string {
	const trimmedPrompt = prompt.trim();
	if (config.providerId.toLowerCase() !== "bytos") {
		return trimmedPrompt;
	}

	return buildBytosSystemPrompt({
		ide: config.bytosIdeName?.trim() || "Terminal",
		workspaceRoot: config.cwd?.trim() || "/",
		providerId: config.providerId,
		rules: `# Team Teammate Role\n${trimmedPrompt}`,
		platform: config.bytosPlatform,
		metadata: config.workspaceMetadata,
	});
}

export function buildSubAgentSystemPrompt(
	// The prompt provided when spawning the subagent
	prompt: string,
	config: DelegatedAgentRuntimeConfig,
): string {
	const trimmedPrompt = prompt.trim();
	if (config.providerId.toLowerCase() !== "bytos") {
		return trimmedPrompt;
	}

	return buildBytosSystemPrompt({
		ide: config.bytosIdeName || "Terminal",
		workspaceRoot: config.cwd?.trim() || "/",
		providerId: config.providerId,
		overridePrompt: trimmedPrompt,
		metadata: config.workspaceMetadata,
		platform: config.bytosPlatform,
	});
}
