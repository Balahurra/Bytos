import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { StateManager } from "@core/storage/StateManager"
import sinon from "sinon"
import { createVscodeExtraTools } from "@/sdk/vscode-runtime-builder"
import { McpHub } from "../McpHub"

/**
 * End-to-end MCP runtime checks: a real stdio server process is spawned
 * through McpHub, tools are discovered, a tool is called, and a dropped
 * connection is re-established for the next runtime tool call.
 *
 * The server is a tiny dependency-free JSON-RPC peer so the test exercises
 * McpHub's real StdioClientTransport path instead of a stub.
 */

const SERVER_SCRIPT = String.raw`
let buffer = "";
process.stdin.setEncoding("utf8");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const tools = [
	{
		name: "echo",
		description: "Echo text",
		inputSchema: {
			type: "object",
			properties: { text: { type: "string" } },
			required: ["text"],
		},
	},
];
function handle(message) {
	if (!message || typeof message !== "object") return;
	if (message.method === "initialize") {
		send({
			jsonrpc: "2.0",
			id: message.id,
			result: {
				protocolVersion: message.params?.protocolVersion ?? "2024-11-05",
				capabilities: { tools: {} },
				serverInfo: { name: "echo", version: "1.0.0" },
			},
		});
		return;
	}
	if (message.method === "notifications/initialized") return;
	if (message.method === "tools/list") {
		send({ jsonrpc: "2.0", id: message.id, result: { tools } });
		return;
	}
	if (message.method === "tools/call") {
		const text = String(message.params?.arguments?.text ?? "");
		send({
			jsonrpc: "2.0",
			id: message.id,
			result: { content: [{ type: "text", text }], isError: false },
		});
		return;
	}
	if (message.id !== undefined) {
		send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
	}
}
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	let index = buffer.indexOf("\n");
	while (index >= 0) {
		const line = buffer.slice(0, index).trim();
		buffer = buffer.slice(index + 1);
		if (line) {
			try {
				handle(JSON.parse(line));
			} catch {
				// Ignore malformed lines from the client.
			}
		}
		index = buffer.indexOf("\n");
	}
});
`

describe("McpHub real stdio runtime", () => {
	let sandbox: sinon.SinonSandbox
	let tempDir: string
	let serverPath: string

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		sandbox.stub(StateManager, "get").returns({
			getRemoteConfigSettings: () => ({}),
		} as unknown as StateManager)
		tempDir = mkdtempSync(join(tmpdir(), "bytos-mcp-runtime-"))
		serverPath = join(tempDir, "echo-server.mjs")
		writeFileSync(serverPath, SERVER_SCRIPT, "utf8")
	})

	afterEach(async () => {
		sandbox.restore()
		rmSync(tempDir, { recursive: true, force: true })
	})

	function createHub() {
		const hub = Object.create(McpHub.prototype) as McpHub
		;(hub as any).connections = []
		;(hub as any).isConnecting = false
		;(hub as any).clientVersion = "0.0.0"
		;(hub as any).ensureConnectionInFlight = new Map()
		;(hub as any).telemetryService = { captureMcpToolCall: sinon.stub() }
		sandbox.stub(hub as any, "notifyWebviewOfServerChanges").resolves()
		return hub
	}

	const config = () => ({
		type: "stdio" as const,
		command: process.execPath,
		args: [serverPath],
		disabled: false,
		timeout: 10,
	})

	it("connects, lists tools, and calls a tool", async () => {
		const hub = createHub()

		await (hub as any).connectToServer("echo", config(), "internal")

		const connection = (hub as any).connections.find((conn: any) => conn.server.name === "echo")
		expect(connection.server.status).toBe("connected")
		expect(connection.server.tools.map((tool: any) => tool.name)).toContain("echo")

		const result = (await hub.callTool("echo", "echo", { text: "hello mcp" }, "ulid-echo")) as {
			content: Array<{ text?: string }>
		}
		expect(result.content[0]?.text).toBe("hello mcp")

		await connection.transport.close()
	})

	it("reconnects a dropped server before the next tool call", async () => {
		const hub = createHub()
		await (hub as any).connectToServer("echo", config(), "internal")

		const connection = (hub as any).connections.find((conn: any) => conn.server.name === "echo")
		await connection.transport.close()
		connection.client = null
		connection.server.status = "disconnected"

		sandbox.stub(hub as any, "readAndValidateMcpSettingsFile").resolves({ mcpServers: { echo: config() } })

		expect(await hub.ensureConnected("echo")).toBe(true)

		const result = (await hub.callTool("echo", "echo", { text: "after reconnect" }, "ulid-reconnect")) as {
			content: Array<{ text?: string }>
		}
		expect(result.content[0]?.text).toBe("after reconnect")

		const reconnected = (hub as any).connections.find((conn: any) => conn.server.name === "echo")
		await reconnected.transport.close()
	})

	it("exposes MCP tools through the runtime extra-tools bridge", async () => {
		const hub = createHub()
		await (hub as any).connectToServer("echo", config(), "internal")

		const tools = await createVscodeExtraTools(hub)
		const echoTool = tools.find((tool) => tool.name === "echo__echo")
		expect(echoTool).toBeDefined()

		const result = (await echoTool?.execute({ text: "via extra tools" }, {
			agentId: "agent",
			iteration: 1,
			signal: new AbortController().signal,
		} as never)) as { content: Array<{ text?: string }> }
		expect(result.content[0]?.text).toBe("via extra tools")

		const connection = (hub as any).connections.find((conn: any) => conn.server.name === "echo")
		await connection.transport.close()
	})
})
