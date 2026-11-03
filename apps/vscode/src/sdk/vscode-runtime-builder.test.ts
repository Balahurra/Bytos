import sinon from "sinon"
import { describe, expect, it } from "vitest"
import { createVscodeExtraTools, McpHubToolProvider } from "./vscode-runtime-builder"

describe("McpHubToolProvider", () => {
	it("forwards the agent abort signal to McpHub", async () => {
		const callTool = sinon.stub().resolves({ content: [] })
		const ensureConnected = sinon.stub().resolves(true)
		const provider = new McpHubToolProvider({ callTool, ensureConnected } as never)
		const controller = new AbortController()

		await provider.callTool({
			serverName: "server",
			toolName: "slow-tool",
			context: {
				agentId: "agent",
				iteration: 1,
				signal: controller.signal,
			},
		})

		expect(callTool.calledOnce).toBe(true)
		expect(callTool.firstCall.args[4]).toBe(controller.signal)
		expect(ensureConnected.calledOnceWith("server")).toBe(true)
	})

	it("reconnects a dropped server before dispatching the tool call", async () => {
		const order: string[] = []
		const ensureConnected = sinon.stub().callsFake(async () => {
			order.push("ensure")
			return true
		})
		const callTool = sinon.stub().callsFake(async () => {
			order.push("call")
			return { content: [] }
		})
		const provider = new McpHubToolProvider({ callTool, ensureConnected } as never)

		await provider.callTool({ serverName: "weather", toolName: "forecast" })

		expect(order).toEqual(["ensure", "call"])
	})

	it("keeps MCP Apps tool metadata", async () => {
		const getServers = sinon.stub().returns([
			{
				name: "weather",
				tools: [
					{
						name: "show_weather",
						inputSchema: { type: "object" },
						_meta: { ui: { resourceUri: "ui://weather/view.html" } },
					},
					{ name: "plain", inputSchema: { type: "object" } },
				],
			},
		])
		const provider = new McpHubToolProvider({ getServers } as never)

		expect(await provider.listTools("weather")).toEqual([
			{
				name: "show_weather",
				description: undefined,
				inputSchema: { type: "object" },
				_meta: { ui: { resourceUri: "ui://weather/view.html" } },
			},
			{ name: "plain", description: undefined, inputSchema: { type: "object" } },
		])
	})

	it("forwards resource reads with the agent abort signal", async () => {
		const readResource = sinon.stub().resolves({ contents: [] })
		const provider = new McpHubToolProvider({ readResource } as never)
		const controller = new AbortController()

		await provider.readResource({
			serverName: "weather",
			uri: "ui://weather/view.html",
			context: { agentId: "agent", iteration: 1, signal: controller.signal },
		})

		expect(readResource.firstCall.args).toEqual(["weather", "ui://weather/view.html", controller.signal])
	})
})

describe("createVscodeExtraTools", () => {
	it("registers MCP tools under the VS Code server__tool names", async () => {
		const mcpHub = {
			getServers: () => [
				{
					name: "weather",
					config: JSON.stringify({ type: "stdio", command: "weather" }),
					status: "connected",
					tools: [{ name: "forecast", inputSchema: { type: "object", properties: {} } }],
				},
			],
		}

		const tools = await createVscodeExtraTools(mcpHub as never)

		expect(tools.map((tool) => tool.name)).toContain("weather__forecast")
	})

	it("keeps long MCP tool names parseable instead of dropping the separator", async () => {
		const serverName = "a-server-with-a-very-long-name-indeed"
		const toolName = "a-tool-with-a-very-long-name-indeed-too"
		const mcpHub = {
			getServers: () => [
				{
					name: serverName,
					config: JSON.stringify({ type: "stdio", command: "weather" }),
					status: "connected",
					tools: [{ name: toolName, inputSchema: { type: "object", properties: {} } }],
				},
			],
		}

		const tools = await createVscodeExtraTools(mcpHub as never)

		expect(tools).toHaveLength(1)
		expect(tools[0]?.name.length).toBeLessThanOrEqual(64)
		expect(tools[0]?.name).toContain("__")
	})
})
