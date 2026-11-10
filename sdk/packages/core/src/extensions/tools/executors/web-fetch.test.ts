import { afterEach, describe, expect, it, vi } from "vitest"
import { createWebFetchExecutor } from "./web-fetch"

function responseWithUrl(body: string, url: string): Response {
	const response = new Response(body, {
		status: 200,
		headers: { "content-type": "text/plain" },
	})
	Object.defineProperty(response, "url", { value: url })
	return response
}

const context = { signal: undefined } as never

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("createWebFetchExecutor SSRF guards", () => {
	it("refuses cloud metadata endpoints before issuing a request", async () => {
		const fetchMock = vi.fn()
		vi.stubGlobal("fetch", fetchMock)
		const fetchContent = createWebFetchExecutor()

		await expect(
			fetchContent("http://169.254.169.254/latest/meta-data/", "x", context),
		).rejects.toThrow(/metadata address/i)
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it("refuses redirects that end at a cloud metadata endpoint", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				responseWithUrl("secret", "http://169.254.169.254/latest/meta-data/"),
			),
		)
		const fetchContent = createWebFetchExecutor()

		await expect(
			fetchContent("https://example.com/redirect", "x", context),
		).rejects.toThrow(/metadata address/i)
	})

	it("still fetches ordinary public content", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => responseWithUrl("hello world", "https://example.com/")),
		)
		const fetchContent = createWebFetchExecutor()

		const result = await fetchContent("https://example.com/", "x", context)
		expect(result).toContain("hello world")
	})
})
