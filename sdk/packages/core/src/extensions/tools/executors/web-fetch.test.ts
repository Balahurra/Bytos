import { afterEach, describe, expect, it, vi } from "vitest"
import { createWebFetchExecutor } from "./web-fetch"

function responseWithUrl(
	body: string,
	url: string,
	contentType = "text/plain",
): Response {
	const response = new Response(body, {
		status: 200,
		headers: { "content-type": contentType },
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

	it("strips markup, script/style raw text and comments from HTML", async () => {
		const html = [
			"<html><head><style>body{color:red}</style></head><body>",
			"<script>alert('bad()')</script >",
			"<h1>Title</h1><p>A &amp; B</p><!-- hidden -->",
			'<SCRIPT type="text/javascript">danger()</script foo="bar">',
			"<p>Done</p></body></html>",
		].join("")
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				responseWithUrl(html, "https://example.com/", "text/html; charset=utf-8"),
			),
		)
		const fetchContent = createWebFetchExecutor()

		const result = await fetchContent("https://example.com/", "x", context)
		expect(result).toContain("Title")
		expect(result).toContain("A & B")
		expect(result).toContain("Done")
		expect(result).not.toContain("alert")
		expect(result).not.toContain("danger")
		expect(result).not.toContain("color:red")
		expect(result).not.toContain("hidden")
	})

	it("decodes entities once instead of double-unescaping", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				responseWithUrl(
					"<p>&amp;lt;script&amp;gt; &amp;amp; &#65; &#x42;</p>",
					"https://example.com/",
					"text/html",
				),
			),
		)
		const fetchContent = createWebFetchExecutor()

		const result = await fetchContent("https://example.com/", "x", context)
		expect(result).toContain("&lt;script&gt; &amp; A B")
		expect(result).not.toContain("<script>")
	})
})
