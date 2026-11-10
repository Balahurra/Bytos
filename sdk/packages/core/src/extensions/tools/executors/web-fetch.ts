/**
 * Web Fetch Executor
 *
 * Built-in implementation for fetching web content using native fetch.
 */

import type { AgentToolContext } from "@bytos/shared"
import type { WebFetchExecutor } from "../types"

/**
 * Options for the web fetch executor
 */
export interface WebFetchExecutorOptions {
	/**
	 * Timeout for fetch requests in milliseconds
	 * @default 30000 (30 seconds)
	 */
	timeoutMs?: number

	/**
	 * Maximum response size in bytes
	 * @default 5_000_000 (5MB)
	 */
	maxResponseBytes?: number

	/**
	 * User agent string
	 * @default "Mozilla/5.0 (compatible; AgentBot/1.0)"
	 */
	userAgent?: string

	/**
	 * Additional headers
	 */
	headers?: Record<string, string>

	/**
	 * Whether to follow redirects
	 * @default true
	 */
	followRedirects?: boolean

	/**
	 * Maximum number of redirects to follow
	 * @default 5
	 */
	maxRedirects?: number
}

/**
 * Cloud metadata services live on link-local addresses. A model-controlled
 * fetch must not be able to read instance credentials even if a URL (or a
 * redirect) resolves there. Localhost remains available for legitimate local
 * documentation servers.
 */
function isCloudMetadataAddress(url: URL): boolean {
	const host = url.hostname.toLowerCase()
	if (host === "metadata.google.internal" || host === "metadata.goog") {
		return true
	}
	// IPv4 link-local used by AWS/GCP/Azure instance metadata.
	if (host.startsWith("169.254.")) {
		return true
	}
	// IPv6 link-local, including IPv4-mapped forms.
	const normalized = host.replace(/^\[|\]$/g, "")
	if (normalized.startsWith("fe80:")) {
		return true
	}
	if (normalized.startsWith("::ffff:169.254.")) {
		return true
	}
	return false
}

const HTML_BLOCK_TAGS = new Set([
	"p",
	"div",
	"br",
	"hr",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"li",
	"tr",
])
const HTML_RAW_TEXT_TAGS = new Set(["script", "style"])
const HTML_NAMED_ENTITIES: Record<string, string> = {
	nbsp: " ",
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
}

interface ScannedHtmlTag {
	name: string
	closing: boolean
	end: number
}

/**
 * Reads the tag starting at `start` without relying on a tag-matching regexp,
 * so malformed tags (quoted `>`, missing close, whitespace before `>`) are
 * handled by the same scanner the browser would use.
 */
function readHtmlTag(html: string, start: number): ScannedHtmlTag | undefined {
	let i = start + 1
	let closing = false
	if (html[i] === "/") {
		closing = true
		i++
	}
	while (i < html.length && /\s/.test(html[i] ?? "")) i++
	const nameStart = i
	while (i < html.length) {
		const code = html.charCodeAt(i)
		const isNameCharacter =
			(code >= 65 && code <= 90) ||
			(code >= 97 && code <= 122) ||
			(code >= 48 && code <= 57) ||
			code === 58 ||
			code === 45
		if (!isNameCharacter) break
		i++
	}
	if (i === nameStart) return undefined
	const name = html.slice(nameStart, i).toLowerCase()
	let quote = ""
	while (i < html.length) {
		const char = html[i]
		if (quote) {
			if (char === quote) quote = ""
		} else if (char === '"' || char === "'") {
			quote = char
		} else if (char === ">") {
			return { name, closing, end: i + 1 }
		}
		i++
	}
	return { name, closing, end: html.length }
}

/** Returns the index just past the matching raw-text close tag. */
function skipRawTextElement(html: string, from: number, name: string): number {
	let i = from
	while (i < html.length) {
		const lt = html.indexOf("<", i)
		if (lt === -1) return html.length
		if (html.startsWith("<!--", lt)) {
			const end = html.indexOf("-->", lt + 4)
			i = end === -1 ? html.length : end + 3
			continue
		}
		const tag = readHtmlTag(html, lt)
		if (!tag) {
			i = lt + 1
			continue
		}
		if (tag.closing && tag.name === name) return tag.end
		i = tag.end
	}
	return html.length
}

function isValidCodePoint(code: number): boolean {
	return (
		Number.isInteger(code) &&
		code >= 0 &&
		code <= 0x10ffff &&
		!(code >= 0xd800 && code <= 0xdfff)
	)
}

/**
 * Decodes entities in a single pass. A single pass matters: decoding `&amp;`
 * before `&lt;` would turn `&amp;lt;` into `<`, i.e. unescape twice.
 */
function decodeHtmlEntities(text: string): string {
	return text.replace(
		/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g,
		(match, entity: string) => {
			if (entity.startsWith("#x") || entity.startsWith("#X")) {
				const code = Number.parseInt(entity.slice(2), 16)
				return isValidCodePoint(code) ? String.fromCodePoint(code) : match
			}
			if (entity.startsWith("#")) {
				const code = Number.parseInt(entity.slice(1), 10)
				return isValidCodePoint(code) ? String.fromCodePoint(code) : match
			}
			return HTML_NAMED_ENTITIES[entity.toLowerCase()] ?? match
		},
	)
}

/**
 * Extract text content from HTML.
 * A small scanner removes comments, skips script/style raw text and drops
 * markup before normalizing whitespace; no regexp is used to filter tags.
 */
function htmlToText(html: string): string {
	let output = ""
	let i = 0
	while (i < html.length) {
		const lt = html.indexOf("<", i)
		if (lt === -1) {
			output += html.slice(i)
			break
		}
		output += html.slice(i, lt)
		if (html.startsWith("<!--", lt)) {
			const end = html.indexOf("-->", lt + 4)
			i = end === -1 ? html.length : end + 3
			continue
		}
		const tag = readHtmlTag(html, lt)
		if (!tag) {
			output += "<"
			i = lt + 1
			continue
		}
		i = tag.end
		if (HTML_RAW_TEXT_TAGS.has(tag.name)) {
			if (!tag.closing) {
				i = skipRawTextElement(html, i, tag.name)
			}
			continue
		}
		output += HTML_BLOCK_TAGS.has(tag.name) ? "\n" : " "
	}
	return decodeHtmlEntities(output).replace(/\s+/g, " ").trim()
}

/**
 * Create a web fetch executor using native fetch
 *
 * @example
 * ```typescript
 * const webFetch = createWebFetchExecutor({
 *   timeoutMs: 15000,
 *   maxResponseBytes: 2_000_000,
 * })
 *
 * const content = await webFetch(
 *   "https://docs.example.com/api",
 *   "Extract the authentication section",
 *   context
 * )
 * ```
 */
export function createWebFetchExecutor(
	options: WebFetchExecutorOptions = {},
): WebFetchExecutor {
	const {
		timeoutMs = 30000,
		maxResponseBytes = 5_000_000,
		userAgent = "Mozilla/5.0 (compatible; AgentBot/1.0)",
		headers = {},
		followRedirects = true,
		// maxRedirects is available in options but native fetch handles it automatically
	} = options

	return async (
		url: string,
		prompt: string,
		context: AgentToolContext,
	): Promise<string> => {
		// Validate URL
		let parsedUrl: URL
		try {
			parsedUrl = new URL(url)
		} catch {
			throw new Error(`Invalid URL: ${url}`)
		}

		// Only allow http and https
		if (!["http:", "https:"].includes(parsedUrl.protocol)) {
			throw new Error(
				`Invalid protocol: ${parsedUrl.protocol}. Only http and https are supported.`,
			)
		}
		if (isCloudMetadataAddress(parsedUrl)) {
			throw new Error("Refusing to fetch a cloud metadata address.")
		}

		// Create abort controller for timeout
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), timeoutMs)
		let contextAbortHandler: (() => void) | undefined

		// Combine with context abort signal
		if (context.signal) {
			contextAbortHandler = () => controller.abort()
			context.signal.addEventListener("abort", contextAbortHandler)
		}

		try {
			const response = await fetch(url, {
				method: "GET",
				headers: {
					"User-Agent": userAgent,
					Accept:
						"text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
					"Accept-Language": "en-US,en;q=0.9",
					...headers,
				},
				redirect: followRedirects ? "follow" : "manual",
				signal: controller.signal,
			})

			clearTimeout(timeout)

			// Native fetch follows redirects internally; validate the final
			// origin too so a public URL cannot redirect the agent to metadata.
			if (response.url) {
				try {
					if (isCloudMetadataAddress(new URL(response.url))) {
						throw new Error(
							"Refusing to read a redirect to a cloud metadata address.",
						)
					}
				} catch (error) {
					if (
						error instanceof Error &&
						/metadata address/i.test(error.message)
					) {
						throw error
					}
				}
			}

			// Check for redirect limit (if we're checking manually)
			if (!followRedirects && response.status >= 300 && response.status < 400) {
				const location = response.headers.get("location")
				return `Redirect to: ${location}`
			}

			// Check response status
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}

			// Get content type
			const contentType = response.headers.get("content-type") || ""

			// Read response body with size limit
			const reader = response.body?.getReader()
			if (!reader) {
				throw new Error("Failed to read response body")
			}

			const chunks: Uint8Array[] = []
			let totalSize = 0

			while (true) {
				const { done, value } = await reader.read()
				if (done) break

				totalSize += value.length
				if (totalSize > maxResponseBytes) {
					// Bun 1.4 rejects cancel() on an already-errored stream; that
					// rejection must not surface as an unhandled rejection.
					reader.cancel().catch(() => {})
					throw new Error(
						`Response too large: exceeded ${maxResponseBytes} bytes`,
					)
				}

				chunks.push(value)
			}

			// Combine chunks
			const buffer = new Uint8Array(totalSize)
			let offset = 0
			for (const chunk of chunks) {
				buffer.set(chunk, offset)
				offset += chunk.length
			}

			// Decode as text
			const text = new TextDecoder("utf-8").decode(buffer)

			// Process content based on type
			let content: string
			if (
				contentType.includes("text/html") ||
				contentType.includes("application/xhtml")
			) {
				content = htmlToText(text)
			} else if (contentType.includes("application/json")) {
				try {
					const json = JSON.parse(text)
					content = JSON.stringify(json, null, 2)
				} catch {
					content = text
				}
			} else {
				content = text
			}

			// Format output with metadata
			const outputLines = [
				`URL: ${url}`,
				`Content-Type: ${contentType}`,
				`Size: ${totalSize} bytes`,
				``,
				`--- Content ---`,
				content.slice(0, 50000), // Limit content size for output
			]

			if (content.length > 50000) {
				outputLines.push(
					`\n[Content truncated: showing first 50000 of ${content.length} characters]`,
				)
			}

			outputLines.push(``, `--- Analysis Request ---`, `Prompt: ${prompt}`)

			return outputLines.join("\n")
		} catch (error) {
			clearTimeout(timeout)

			if (error instanceof Error) {
				if (error.name === "AbortError") {
					throw new Error(`Request timed out after ${timeoutMs}ms`)
				}
				throw error
			}
			throw new Error(`Fetch failed: ${String(error)}`)
		} finally {
			if (context.signal && contextAbortHandler) {
				context.signal.removeEventListener("abort", contextAbortHandler)
			}
		}
	}
}
