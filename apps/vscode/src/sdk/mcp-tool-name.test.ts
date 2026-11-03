import { describe, expect, it } from "vitest"
import { isVscodeMcpToolName, parseVscodeMcpToolName, toVscodeMcpToolName } from "./mcp-tool-name"

describe("toVscodeMcpToolName", () => {
	it("keeps the server__tool separator for short names", () => {
		expect(toVscodeMcpToolName({ serverName: "github", toolName: "create_issue" })).toBe("github__create_issue")
	})

	it("sanitizes each part without losing the separator", () => {
		const name = toVscodeMcpToolName({ serverName: "My Server!", toolName: "read file" })
		expect(name).toBe("My_Server__read_file")
		expect(parseVscodeMcpToolName(name)).toEqual({ serverName: "My_Server", toolName: "read_file" })
	})

	it("collapses runs of underscores so the first __ is always the separator", () => {
		const name = toVscodeMcpToolName({ serverName: "my__server", toolName: "do__thing" })
		expect(name).toBe("my_server__do_thing")
		expect(parseVscodeMcpToolName(name)).toEqual({ serverName: "my_server", toolName: "do_thing" })
	})

	it("keeps long names within the provider limit and still parseable", () => {
		const name = toVscodeMcpToolName({
			serverName: "a-very-long-mcp-server-name-that-goes-on-and-on",
			toolName: "an-even-longer-tool-name-that-would-normally-be-hashed-without-a-separator",
		})

		expect(name.length).toBeLessThanOrEqual(64)
		expect(isVscodeMcpToolName(name)).toBe(true)
		expect(parseVscodeMcpToolName(name)).toBeDefined()
		expect(name).toContain("__")
	})

	it("is deterministic and distinguishes different long tools", () => {
		const longServer = "server-with-a-name-long-enough-to-force-the-hash-path-for-sure"
		const first = toVscodeMcpToolName({ serverName: longServer, toolName: "tool_one" })
		const second = toVscodeMcpToolName({ serverName: longServer, toolName: "tool_two" })

		expect(toVscodeMcpToolName({ serverName: longServer, toolName: "tool_one" })).toBe(first)
		expect(first).not.toBe(second)
	})
})
