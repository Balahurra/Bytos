import { describe, expect, it } from "bun:test"
import { clientIdentity, RateLimiter } from "../src/rate-limit"

describe("RateLimiter", () => {
	it("allows requests up to the limit and rejects the next one", () => {
		const limiter = new RateLimiter({ handoff: { limit: 3, windowMs: 60_000 } })
		const now = 1_000_000

		expect(limiter.check("handoff", "1.1.1.1", now).allowed).toBe(true)
		expect(limiter.check("handoff", "1.1.1.1", now).allowed).toBe(true)
		expect(limiter.check("handoff", "1.1.1.1", now).allowed).toBe(true)

		const blocked = limiter.check("handoff", "1.1.1.1", now)
		expect(blocked.allowed).toBe(false)
		expect(blocked.remaining).toBe(0)
		expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
	})

	it("keys buckets per identity so one client cannot exhaust another's budget", () => {
		const limiter = new RateLimiter({ exchange: { limit: 1, windowMs: 60_000 } })
		const now = 1_000_000

		expect(limiter.check("exchange", "1.1.1.1", now).allowed).toBe(true)
		expect(limiter.check("exchange", "1.1.1.1", now).allowed).toBe(false)
		expect(limiter.check("exchange", "2.2.2.2", now).allowed).toBe(true)
	})

	it("keys buckets per route so a handoff attempt does not consume the exchange budget", () => {
		const limiter = new RateLimiter({
			handoff: { limit: 1, windowMs: 60_000 },
			exchange: { limit: 1, windowMs: 60_000 },
		})
		const now = 1_000_000

		expect(limiter.check("handoff", "1.1.1.1", now).allowed).toBe(true)
		expect(limiter.check("handoff", "1.1.1.1", now).allowed).toBe(false)
		expect(limiter.check("exchange", "1.1.1.1", now).allowed).toBe(true)
	})

	it("resets the budget once the window elapses", () => {
		const limiter = new RateLimiter({ handoff: { limit: 1, windowMs: 1_000 } })
		expect(limiter.check("handoff", "1.1.1.1", 1_000).allowed).toBe(true)
		expect(limiter.check("handoff", "1.1.1.1", 1_500).allowed).toBe(false)
		expect(limiter.check("handoff", "1.1.1.1", 2_001).allowed).toBe(true)
	})

	it("allows unknown routes so only the account endpoints are throttled", () => {
		const limiter = new RateLimiter({ handoff: { limit: 1, windowMs: 60_000 } })
		for (let i = 0; i < 50; i++) {
			expect(limiter.check("health", "1.1.1.1", 1_000).allowed).toBe(true)
		}
	})

	it("parses the `handoff:exchange` policy override", () => {
		expect(RateLimiter.parseOverride(undefined)).toBeUndefined()
		expect(RateLimiter.parseOverride("")).toBeUndefined()
		expect(RateLimiter.parseOverride("5:25")).toEqual({
			handoff: { limit: 5, windowMs: 60_000 },
			exchange: { limit: 25, windowMs: 60_000 },
		})
		expect(RateLimiter.parseOverride("0:0")).toBeUndefined()
	})

	it("derives client identity from the Cloudflare and proxy headers", () => {
		const withCf = new Request("https://x.test", { headers: { "cf-connecting-ip": "9.9.9.9" } })
		expect(clientIdentity(withCf)).toBe("9.9.9.9")

		const withForwarded = new Request("https://x.test", { headers: { "x-forwarded-for": "8.8.8.8, 7.7.7.7" } })
		expect(clientIdentity(withForwarded)).toBe("8.8.8.8")

		expect(clientIdentity(new Request("https://x.test"))).toBe("unknown")
	})
})
