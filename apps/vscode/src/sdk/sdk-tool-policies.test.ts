import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { describe, expect, it } from "vitest"
import { toVscodeMcpToolName } from "./mcp-tool-name"
import { buildToolPolicies, isToolAutoApproved } from "./sdk-tool-policies"

describe("isToolAutoApproved", () => {
	it("does not auto-approve command tools by default", () => {
		expect(isToolAutoApproved("run_commands", DEFAULT_AUTO_APPROVAL_SETTINGS)).toBe(false)
	})

	it("uses executeSafeCommands as the single command approval flag", () => {
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				executeSafeCommands: false,
				executeAllCommands: true,
			},
		}

		expect(isToolAutoApproved("run_commands", settings)).toBe(false)
	})

	it("auto-approves all MCP tools when the Use MCP servers toggle is on", () => {
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: { ...DEFAULT_AUTO_APPROVAL_SETTINGS.actions, useMcp: true },
		}

		expect(isToolAutoApproved("firecrawl__scrape", settings)).toBe(true)
	})

	it("prompts for MCP tools when the Use MCP servers toggle is off", () => {
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: { ...DEFAULT_AUTO_APPROVAL_SETTINGS.actions, useMcp: false },
		}

		expect(isToolAutoApproved("firecrawl__scrape", settings)).toBe(false)
	})

	it("recognizes truncated MCP tool names produced by the VS Code bridge", () => {
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: { ...DEFAULT_AUTO_APPROVAL_SETTINGS.actions, useMcp: true },
		}
		const longName = toVscodeMcpToolName({
			serverName: "a-server-with-a-very-long-name-indeed",
			toolName: "a-tool-with-a-very-long-name-indeed-too",
		})

		expect(isToolAutoApproved(longName, settings)).toBe(true)
	})

	it("forces every MCP tool through the approval callback, including truncated names", () => {
		const longName = toVscodeMcpToolName({
			serverName: "a-server-with-a-very-long-name-indeed",
			toolName: "a-tool-with-a-very-long-name-indeed-too",
		})
		const mcpHub = {
			getServers: () => [
				{
					name: "a-server-with-a-very-long-name-indeed",
					tools: [{ name: "a-tool-with-a-very-long-name-indeed-too" }],
				},
			],
		}

		const policies = buildToolPolicies(DEFAULT_AUTO_APPROVAL_SETTINGS, mcpHub as never)

		expect(policies[longName]).toEqual({ autoApprove: false })
	})

	it("only registers policies for the phase allowlist", () => {
		const mcpHub = {
			getServers: () => [
				{ name: "allowed", tools: [{ name: "run" }] },
				{ name: "blocked", tools: [{ name: "run" }] },
			],
		}

		const policies = buildToolPolicies(DEFAULT_AUTO_APPROVAL_SETTINGS, mcpHub as never, ["allowed"])

		expect(policies["allowed__run"]).toEqual({ autoApprove: false })
		expect(policies["blocked__run"]).toBeUndefined()
	})
})
