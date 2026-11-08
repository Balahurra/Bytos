import { describe, expect, it } from "bun:test"
import { clientIdentity, edgeLimitAllows, normalizeClientIp, RateLimiter } from "../src/rate-limit"

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

	it("parses the `handoff:exchange:handoff_user:users` policy override", () => {
		expect(RateLimiter.parseOverride(undefined)).toBeUndefined()
		expect(RateLimiter.parseOverride("")).toBeUndefined()
		expect(RateLimiter.parseOverride("5:25")).toEqual({
			handoff: { limit: 5, windowMs: 60_000 },
			exchange: { limit: 25, windowMs: 60_000 },
		})
		expect(RateLimiter.parseOverride("5:25:3:120")).toEqual({
			handoff: { limit: 5, windowMs: 60_000 },
			exchange: { limit: 25, windowMs: 60_000 },
			handoff_user: { limit: 3, windowMs: 60_000 },
			users: { limit: 120, windowMs: 60_000 },
		})
		expect(RateLimiter.parseOverride("0:0")).toBeUndefined()
	})

	it("keeps default policies when a partial override is supplied", () => {
		const limiter = new RateLimiter(RateLimiter.parseOverride("5:25"))
		expect(limiter.check("users", "user-1", 1_000).limit).toBe(120)
		expect(limiter.check("handoff_user", "user-1", 1_000).limit).toBe(10)
	})

	it("derives client identity from Cloudflare's IP header only", () => {
		const withCf = new Request("https://x.test", { headers: { "cf-connecting-ip": "9.9.9.9" } })
		expect(clientIdentity(withCf)).toBe("9.9.9.9")

		const withRealIp = new Request("https://x.test", { headers: { "x-real-ip": "8.8.8.8" } })
		expect(clientIdentity(withRealIp)).toBe("8.8.8.8")

		const withForwarded = new Request("https://x.test", {
			headers: { "x-forwarded-for": "8.8.8.8, 7.7.7.7" },
		})
		expect(clientIdentity(withForwarded)).toBe("unknown")

		expect(clientIdentity(new Request("https://x.test"))).toBe("unknown")
	})

	it("normalizes IPv6 to a /64 bucket and unwraps IPv4-mapped addresses", () => {
		expect(normalizeClientIp("2001:db8:abcd:1234:5678:9abc:def0:1234")).toBe("2001:db8:abcd:1234::/64")
		expect(normalizeClientIp("2001:db8:abcd:1234:ffff::1")).toBe("2001:db8:abcd:1234::/64")
		expect(normalizeClientIp("::ffff:192.0.2.1")).toBe("192.0.2.1")
		expect(normalizeClientIp("203.0.113.5")).toBe("203.0.113.5")
		expect(normalizeClientIp("not-an-ip")).toBe("not-an-ip")
	})

	it("uses edge bindings and fails open if the edge limiter is unavailable", async () => {
		const keys: string[] = []
		const binding = {
			async limit(options: { key: string }) {
				keys.push(options.key)
				return { success: false }
			},
		}
		expect(await edgeLimitAllows(binding, "exchange:ip:1.2.3.4")).toBe(false)
		expect(keys).toEqual(["exchange:ip:1.2.3.4"])
		expect(await edgeLimitAllows(undefined, "exchange:ip:1.2.3.4")).toBe(true)

		const failing = {
			async limit() {
				throw new Error("edge unavailable")
			},
		}
		expect(await edgeLimitAllows(failing, "exchange:ip:1.2.3.4")).toBe(true)
	})
})
