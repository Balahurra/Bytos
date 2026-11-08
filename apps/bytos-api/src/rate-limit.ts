/**
 * Fixed-window token bucket for the two account endpoints.
 *
 * A Worker isolate keeps this state in memory, so it is a per-isolate guard, not
 * a global quota. That is deliberate: it costs no extra binding, never touches
 * D1/Supabase on the hot path, and still stops a single client from burning the
 * whole handoff budget or forcing unlimited JWKS/DB work. Cloudflare's own
 * platform limits cover the distributed case.
 *
 * Buckets are keyed by `<route>:<identity>`, where identity is the caller's IP
 * for the unauthenticated exchange endpoint and the authenticated user id for
 * the handoff-code endpoint (falling back to IP when unauthenticated).
 */

export interface RateLimitPolicy {
	/** Maximum requests allowed inside one window. */
	limit: number
	/** Window length in milliseconds. */
	windowMs: number
}

export interface RateLimitResult {
	allowed: boolean
	remaining: number
	/** Seconds until the window resets, for the `Retry-After` header. */
	retryAfterSeconds: number
}

const DEFAULT_POLICIES: Record<string, RateLimitPolicy> = {
	// One interactive sign-in needs one handoff code; 10/min leaves room for
	// retries without letting a stuck client loop.
	handoff: { limit: 10, windowMs: 60_000 },
	// Exchange is unauthenticated (PKCE is the proof), so it gets a wider but
	// still bounded budget per IP to blunt brute-force attempts.
	exchange: { limit: 30, windowMs: 60_000 },
}

/** Upper bound on tracked buckets, so a spray of unique IPs cannot grow memory without limit. */
const MAX_BUCKETS = 10_000

interface Bucket {
	count: number
	resetAt: number
}

export class RateLimiter {
	private readonly buckets = new Map<string, Bucket>()

	constructor(private readonly policies: Record<string, RateLimitPolicy> = DEFAULT_POLICIES) {}

	/** Parses `handoff:exchange:tokens` into a policy override map. */
	static parseOverride(value: string | undefined): Record<string, RateLimitPolicy> | undefined {
		if (!value) return undefined
		const [handoff, exchange] = value.split(":").map((part) => Number.parseInt(part, 10))
		const overrides: Record<string, RateLimitPolicy> = {}
		if (Number.isFinite(handoff) && handoff > 0) overrides.handoff = { limit: handoff, windowMs: 60_000 }
		if (Number.isFinite(exchange) && exchange > 0) overrides.exchange = { limit: exchange, windowMs: 60_000 }
		return Object.keys(overrides).length > 0 ? overrides : undefined
	}

	check(route: string, identity: string, now: number = Date.now()): RateLimitResult {
		const policy = this.policies[route]
		if (!policy) return { allowed: true, remaining: Number.POSITIVE_INFINITY, retryAfterSeconds: 0 }

		const key = `${route}:${identity}`
		const existing = this.buckets.get(key)
		if (!existing || existing.resetAt <= now) {
			this.sweep(now)
			this.buckets.set(key, { count: 1, resetAt: now + policy.windowMs })
			return { allowed: true, remaining: policy.limit - 1, retryAfterSeconds: 0 }
		}

		if (existing.count >= policy.limit) {
			return {
				allowed: false,
				remaining: 0,
				retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
			}
		}

		existing.count += 1
		return { allowed: true, remaining: policy.limit - existing.count, retryAfterSeconds: 0 }
	}

	/** Drops expired buckets once the map grows past the cap. */
	private sweep(now: number): void {
		if (this.buckets.size < MAX_BUCKETS) return
		for (const [key, bucket] of this.buckets) {
			if (bucket.resetAt <= now) this.buckets.delete(key)
		}
	}
}

/** Best-effort client identity from Cloudflare's headers, falling back to a constant. */
export function clientIdentity(request: Request): string {
	const headers = request.headers
	return (
		headers.get("cf-connecting-ip") ||
		headers.get("x-real-ip") ||
		headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
		"unknown"
	)
}
