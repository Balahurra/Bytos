import type { GatewayResolvedProviderConfig } from "@bytos/shared";
/*
 * Copyright 2026 Cline Bot Inc.
 * Bytos modifications Copyright 2026 Bytos contributors.
 *
 * Modified from the Cline project (https://github.com/cline/cline), Apache-2.0.
 * Changes by Bytos: the MVP provider-manager core was reduced to the providers
 * that ship in this build; Claude Code subscription, SAP AI Core, and other
 * providers whose SDK licenses do not permit redistribution here were removed.
 * See NOTICE and apps/vscode/THIRD-PARTY-NOTICES.txt.
 */
import { createDifyProvider } from "dify-ai-provider";
import { resolveApiKey } from "../http";
import type { ProviderFactoryResult } from "./types";

function readOptions(
	config: GatewayResolvedProviderConfig,
): Record<string, unknown> {
	return (config.options as Record<string, unknown> | undefined) ?? {};
}

export async function createClaudeCodeProviderModule(
	_config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	// Removed from the free BYOK build: the Claude Code provider requires the
	// proprietary @anthropic-ai/claude-agent-sdk, whose distribution terms
	// cannot be satisfied by bundling it into a public VSIX. Keep the provider
	// visible only if a future build ships the SDK under a compatible license.
	throw new Error(
		"The Claude Code subscription provider is not included in the BYOK build. " +
			"Configure a BYOK provider (for example Anthropic) instead.",
	);
}

export async function createOpenAICodexProviderModule(
	config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	// Dynamic import is intentional: ai-sdk-provider-codex-cli is an optional
	// peer dependency so default installs skip its ~105MB @openai/codex
	// optional dependency. The provider itself degrades gracefully when the
	// bundled binary is absent (npx -y @openai/codex, then `codex` on PATH).
	let createCodexExec: typeof import("ai-sdk-provider-codex-cli").createCodexExec;
	try {
		({ createCodexExec } = await import("ai-sdk-provider-codex-cli"));
	} catch (error) {
		throw new Error(
			"The OpenAI Codex provider requires the optional 'ai-sdk-provider-codex-cli' package. " +
				"Install it alongside @bytos/llms to use this provider.",
			{ cause: error },
		);
	}
	const provider = createCodexExec(readOptions(config));
	return {
		operations: { language: (modelId) => provider(modelId) },
	};
}

export async function createDifyProviderModule(
	config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	const apiKey = await resolveApiKey(config);
	const provider = createDifyProvider({
		baseURL: config.baseUrl,
		headers: config.headers,
		fetch: config.fetch,
		...readOptions(config),
	});
	return {
		operations: {
			language: (modelId) =>
				provider(modelId, {
					apiKey,
				}),
		},
	};
}

export async function createSapAiCoreProviderModule(
	_config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	// Removed from the free BYOK build: the SAP AI Core provider requires
	// @jerome-benoit/sap-ai-provider and @sap-cloud-sdk, which are distributed
	// under the SAP Developer License Agreement. That agreement is not
	// compatible with bundling them into a public VSIX without a separate
	// distribution review.
	throw new Error(
		"The SAP AI Core provider is not included in the BYOK build. " +
			"Use a BYOK provider with your own API key instead.",
	);
}
