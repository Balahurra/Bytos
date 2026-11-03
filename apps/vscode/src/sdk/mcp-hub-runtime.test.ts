import { describe, expect, it, vi } from "vitest"
import { McpHub } from "@/services/mcp/McpHub"

function createRuntimeHub(connection: Record<string, unknown>) {
	const hub = Object.create(McpHub.prototype) as McpHub
	;(hub as unknown as { connections: unknown[] }).connections = [connection]
	;(hub as unknown as { ensureConnectionInFlight: Map<string, Promise<boolean>> }).ensureConnectionInFlight = new Map()
	;(hub as unknown as { isConnecting: boolean }).isConnecting = false
	return hub
}

function connection(patch: Record<string, unknown> = {}) {
	return {
		server: {
			name: "weather",
			config: JSON.stringify({ type: "stdio", command: "weather", disabled: false }),
			status: "connected",
			disabled: false,
			...((patch.server as Record<string, unknown>) ?? {}),
		},
		client: {},
		transport: {},
		...patch,
	}
}

describe("McpHub runtime readiness", () => {
	it("reports ready once the initial connection pass completes", async () => {
		const hub = createRuntimeHub(connection())
		;(hub as unknown as { initializationPromise: Promise<void> }).initializationPromise = Promise.resolve()

		await expect(hub.waitUntilReady(50)).resolves.toBe(true)
	})

	it("stops waiting at the deadline instead of blocking chat startup", async () => {
		const hub = createRuntimeHub(connection())
		;(hub as unknown as { initializationPromise: Promise<void> }).initializationPromise = new Promise(() => {})

		const started = Date.now()
		await expect(hub.waitUntilReady(20)).resolves.toBe(false)
		expect(Date.now() - started).toBeLessThan(1000)
	})
})

describe("McpHub.ensureConnected", () => {
	it("does nothing when the server is already connected", async () => {
		const hub = createRuntimeHub(connection())
		const reconnect = vi.fn()
		;(hub as unknown as { connectToServer: unknown }).connectToServer = reconnect

		await expect(hub.ensureConnected("weather")).resolves.toBe(true)
		expect(reconnect).not.toHaveBeenCalled()
	})

	it("reconnects a dropped server from the latest settings", async () => {
		const conn = connection({ client: null, server: { name: "weather", status: "disconnected", disabled: false } })
		const hub = createRuntimeHub(conn)
		;(hub as unknown as { readAndValidateMcpSettingsFile: unknown }).readAndValidateMcpSettingsFile = async () => ({
			mcpServers: { weather: { type: "stdio", command: "weather" } },
		})
		const connectToServer = vi.fn(async () => {
			;(conn as { client: unknown }).client = {}
			;(conn as { server: { status: string } }).server.status = "connected"
		})
		;(hub as unknown as { connectToServer: unknown }).connectToServer = connectToServer
		;(hub as unknown as { notifyWebviewOfServerChanges: unknown }).notifyWebviewOfServerChanges = async () => {}

		await expect(hub.ensureConnected("weather")).resolves.toBe(true)
		expect(connectToServer).toHaveBeenCalledWith("weather", { type: "stdio", command: "weather" }, "internal")
	})

	it("does not reconnect a disabled or deleted server", async () => {
		const hub = createRuntimeHub(connection({ server: { name: "weather", status: "disconnected", disabled: true } }))
		const connectToServer = vi.fn()
		;(hub as unknown as { connectToServer: unknown }).connectToServer = connectToServer

		await expect(hub.ensureConnected("weather")).resolves.toBe(false)
		expect(connectToServer).not.toHaveBeenCalled()
	})
})
