/*
 * Copyright 2026 Cline Bot Inc.
 * Bytos modifications Copyright 2026 Bytos contributors.
 *
 * Modified from the Cline project (https://github.com/cline/cline), Apache-2.0.
 * Changes by Bytos: tool approval defaults are fail-closed; categories that are
 * unknown to this build inherit the strictest policy instead of auto-approval.
 * See NOTICE and apps/vscode/THIRD-PARTY-NOTICES.txt.
 */

import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import type { McpHub } from "@/services/mcp/McpHub"
import { isVscodeMcpToolName, toVscodeMcpToolName } from "./mcp-tool-name"

/**
 * Build SDK `toolPolicies` for tools governed by Bytos's auto-approval UI.
 *
 * The SDK defaults unlisted tools to auto-approved. For tools controlled by
 * the AutoApproveBar toggles (including all MCP tools), force the SDK to call
 * `requestToolApproval`; the approval callback then evaluates the latest
 * settings and either silently approves or shows the approval UI. This keeps
 * active sessions in sync when the user toggles auto-approval mid-task.
 */
export function buildToolPolicies(
	_settings: AutoApprovalSettings,
	mcpHub?: McpHub,
	mcpServerNames?: readonly string[],
): Record<string, { enabled?: boolean; autoApprove?: boolean }> {
	// Fail closed: any tool not explicitly listed below requires approval.
	// The SDK merges "*" into every tool policy, so a newly added tool or a
	// plugin-registered tool cannot execute automatically by default.
	const policies: Record<string, { enabled?: boolean; autoApprove?: boolean }> = {
		"*": { autoApprove: false },
	}

	const set = (tools: string[]) => {
		for (const tool of tools) {
			policies[tool] = { autoApprove: false }
		}
	}

	// Non-privileged interaction tools do not modify the workspace or execute
	// external code; requiring a second approval prompt for them would be
	// confusing and would deadlock the question UI.
	for (const tool of ["ask_question", "submit_and_exit"]) {
		policies[tool] = { autoApprove: true }
	}

	set(["read_files", "read_file", "list_files", "list_code_definition_names", "search_codebase", "search_files"])
	set(["editor", "replace_in_file", "write_to_file", "apply_patch", "delete_file"])
	set(["run_commands", "execute_command"])
	set(["fetch_web_content", "web_fetch", "web_search"])

	if (mcpHub) {
		const allowed = mcpServerNames === undefined ? undefined : new Set(mcpServerNames)
		const servers = typeof mcpHub.getServers === "function" ? (mcpHub.getServers() ?? []) : []
		for (const server of servers) {
			if (allowed !== undefined && !allowed.has(server.name)) {
				continue
			}
			for (const tool of server.tools ?? []) {
				const sdkName = toVscodeMcpToolName({ serverName: server.name, toolName: tool.name })
				policies[sdkName] = { autoApprove: false }
			}
		}
	}

	return policies
}

/**
 * Evaluate the current UI auto-approval settings for a single SDK tool name.
 * Used both when building initial SDK policies and as a live guard in the
 * approval callback, so changes from the AutoApproveBar are respected even if
 * an SDK session was created before the toggle changed.
 */
export function isToolAutoApproved(toolName: string, settings: AutoApprovalSettings): boolean {
	if (isReadTool(toolName)) {
		return !!settings.actions.readFiles
	}
	if (isEditTool(toolName)) {
		return !!settings.actions.editFiles
	}
	if (isCommandTool(toolName)) {
		return !!settings.actions.executeSafeCommands
	}
	if (isBrowserTool(toolName)) {
		return !!settings.actions.useBrowser
	}

	if (isMcpToolName(toolName)) {
		// One global toggle governs all MCP tools; there is no per-tool opt-in.
		return !!settings.actions.useMcp
	}

	return false
}

function isReadTool(toolName: string): boolean {
	return ["read_files", "read_file", "list_files", "list_code_definition_names", "search_codebase", "search_files"].includes(
		toolName,
	)
}

export function isEditTool(toolName: string): boolean {
	return ["editor", "replace_in_file", "write_to_file", "apply_patch", "delete_file"].includes(toolName)
}

function isCommandTool(toolName: string): boolean {
	return toolName === "run_commands" || toolName === "execute_command"
}

function isBrowserTool(toolName: string): boolean {
	return toolName === "fetch_web_content" || toolName === "web_fetch" || toolName === "web_search"
}

/** MCP tools are registered by `createMcpTools` under `serverName__toolName`. */
function isMcpToolName(toolName: string): boolean {
	return isVscodeMcpToolName(toolName)
}
