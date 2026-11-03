import { createHash } from "node:crypto"

/**
 * MCP tool names exposed to the model.
 *
 * `createMcpTools` normally names tools `${serverName}__${toolName}`. The SDK
 * falls back to a hashed name without the `__` separator when the result is
 * longer than 64 characters or contains characters some providers reject.
 * The extension relies on the separator to render MCP calls (and to apply the
 * MCP auto-approve toggle), so the VS Code bridge uses this transform instead:
 * it always keeps a single `__` separator, sanitizes each side, and only then
 * truncates + hashes to fit OpenAI's 64-character function-name limit.
 */
const MAX_MCP_TOOL_NAME_LENGTH = 64
const HASH_LENGTH = 8
const SEPARATOR = "__"
const FALLBACK_PART = "mcp"

function sanitizePart(value: string): string {
	return (
		value
			// Collapse invalid characters and runs of underscores so a server name
			// can never contain the `__` separator used to split the final name.
			.replace(/[^a-zA-Z0-9_-]+/g, "_")
			.replace(/_+/g, "_")
			.replace(/^_+|_+$/g, "") || FALLBACK_PART
	)
}

function shortHash(value: string): string {
	return createHash("sha1").update(value).digest("hex").slice(0, HASH_LENGTH)
}

export function toVscodeMcpToolName(input: { serverName: string; toolName: string }): string {
	const server = sanitizePart(input.serverName)
	const tool = sanitizePart(input.toolName)
	const rawName = `${server}${SEPARATOR}${tool}`
	if (rawName.length <= MAX_MCP_TOOL_NAME_LENGTH) {
		return rawName
	}

	const suffix = `_${shortHash(rawName)}`
	const budget = MAX_MCP_TOOL_NAME_LENGTH - suffix.length - SEPARATOR.length
	// Give the tool name the larger share: two servers can share a prefix, but
	// the tool name is what tells the model what the call does.
	const serverBudget = Math.min(server.length, Math.max(1, Math.floor(budget * 0.4)))
	const toolBudget = Math.max(1, budget - serverBudget)

	return `${server.slice(0, serverBudget)}${SEPARATOR}${tool.slice(0, toolBudget)}${suffix}`
}

/** True when a tool name was produced by {@link toVscodeMcpToolName}. */
export function isVscodeMcpToolName(toolName: string): boolean {
	const separatorIndex = toolName.indexOf(SEPARATOR)
	return separatorIndex > 0 && separatorIndex + SEPARATOR.length < toolName.length
}

/** Split a VS Code MCP tool name back into its server and tool parts. */
export function parseVscodeMcpToolName(toolName: string): { serverName: string; toolName: string } | undefined {
	const separatorIndex = toolName.indexOf(SEPARATOR)
	if (separatorIndex <= 0) {
		return undefined
	}
	const serverName = toolName.substring(0, separatorIndex)
	const mcpToolName = toolName.substring(separatorIndex + SEPARATOR.length)
	if (!serverName || !mcpToolName) {
		return undefined
	}
	return { serverName, toolName: mcpToolName }
}
