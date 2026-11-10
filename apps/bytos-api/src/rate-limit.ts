/**
 * Fixed-window token bucket for the account endpoints.
 *
 * A Worker isolate keeps this state in memory, so this is the second defense
 * layer, not a global quota. The primary limits are Cloudflare's edge-backed
 * `[[ratelimits]]` bindings, which also provide the global cross-IP counters.
 * This isolate limiter still stops a single client from burning the local
 * handoff budget or forcing unlimited JWKS/DB work on one instance.
 *
 * Buckets are keyed by `<route>:<identity>`, where identity is the normalized
 * caller IP for the unauthenticated exchange endpoint and the authenticated
 * user id for the handoff/user endpoints.
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
	limit: number
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
	// The second layer after the edge per-user limit in /handoff/code.
	handoff_user: { limit: 10, windowMs: 60_000 },
	// The second layer after the edge per-user limit in /users/me.
	users: { limit: 120, windowMs: 60_000 },
}

/** Minimal shape of Cloudflare's edge Rate Limiting binding. */
export interface EdgeRateLimitBinding {
	limit(options: { key: string }): Promise<{ success: boolean }>
}

/**
 * Checks a Cloudflare edge rate-limit binding. Missing bindings are allowed so
 * local development and tests keep the isolate limiter as a fallback.
 */
export async function edgeLimitAllows(
	binding: EdgeRateLimitBinding | undefined,
	key: string,
): Promise<boolean> {
	if (!binding) return true
	try {
		const result = await binding.limit({ key })
		return result.success
	} catch {
		// Fail open to the isolate limiter if the edge binding is unavailable.
		return true
	}
}

/** Upper bound on tracked buckets, so a spray of unique IPs cannot grow memory without limit. */
const MAX_BUCKETS = 10_000

interface Bucket {
	count: number
	resetAt: number
}

export class RateLimiter {
	private readonly buckets = new Map<string, Bucket>()
	private readonly policies: Record<string, RateLimitPolicy>

	constructor(policies: Record<string, RateLimitPolicy> = DEFAULT_POLICIES) {
		// A partial `RATE_LIMIT` override must not disable the other routes.
		this.policies = { ...DEFAULT_POLICIES, ...policies }
	}

	/** Parses `handoff:exchange:handoff_user:users` into a policy override map. */
	static parseOverride(value: string | undefined): Record<string, RateLimitPolicy> | undefined {
		if (!value) return undefined
		const [handoff, exchange, handoffUser, users] = value
			.split(":")
			.map((part) => Number.parseInt(part, 10))
		const overrides: Record<string, RateLimitPolicy> = {}
		if (Number.isFinite(handoff) && handoff > 0) overrides.handoff = { limit: handoff, windowMs: 60_000 }
		if (Number.isFinite(exchange) && exchange > 0) overrides.exchange = { limit: exchange, windowMs: 60_000 }
		if (Number.isFinite(handoffUser) && handoffUser > 0) {
			overrides.handoff_user = { limit: handoffUser, windowMs: 60_000 }
		}
		if (Number.isFinite(users) && users > 0) overrides.users = { limit: users, windowMs: 60_000 }
		return Object.keys(overrides).length > 0 ? overrides : undefined
	}

	check(route: string, identity: string, now: number = Date.now()): RateLimitResult {
		const policy = this.policies[route]
		if (!policy) {
			return {
				allowed: true,
				remaining: Number.POSITIVE_INFINITY,
				limit: Number.POSITIVE_INFINITY,
				retryAfterSeconds: 0,
			}
		}

		const key = `${route}:${identity}`
		const existing = this.buckets.get(key)
		if (!existing || existing.resetAt <= now) {
			this.sweep(now)
			this.buckets.set(key, { count: 1, resetAt: now + policy.windowMs })
			return { allowed: true, remaining: policy.limit - 1, limit: policy.limit, retryAfterSeconds: 0 }
		}

		if (existing.count >= policy.limit) {
			return {
				allowed: false,
				remaining: 0,
				limit: policy.limit,
				retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
			}
		}

		existing.count += 1
		return {
			allowed: true,
			remaining: policy.limit - existing.count,
			limit: policy.limit,
			retryAfterSeconds: 0,
		}
	}

	/** Drops expired buckets once the map grows past the cap. */
	private sweep(now: number): void {
		if (this.buckets.size < MAX_BUCKETS) return
		for (const [key, bucket] of this.buckets) {
			if (bucket.resetAt <= now) this.buckets.delete(key)
		}
	}
}

/**
 * Normalizes IPv6 to its /64 prefix so rotating addresses inside one allocation
 * cannot reset the bucket. IPv4-mapped addresses collapse to the IPv4 address.
 */
export function normalizeClientIp(value: string): string {
	const ip = String(value || "").trim().toLowerCase()
	if (!ip) return "unknown"

	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip

	const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip)
	if (mapped) return mapped[1]

	if (!ip.includes(":")) return ip

	const doubleColon = ip.indexOf("::")
	if (doubleColon === -1) {
		const groups = ip.split(":")
		if (groups.length === 8 && groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
			return `${groups.slice(0, 4).join(":")}::/64`
		}
		return ip
	}

	if (ip.indexOf("::", doubleColon + 1) !== -1) return ip
	const left = ip.slice(0, doubleColon)
	const right = ip.slice(doubleColon + 2)
	const leftGroups = left ? left.split(":") : []
	const rightGroups = right ? right.split(":") : []
	const missing = 8 - leftGroups.length - rightGroups.length
	if (missing < 0) return ip
	const groups = [...leftGroups, ...Array(missing).fill("0"), ...rightGroups]
	if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return ip
	return `${groups.slice(0, 4).join(":")}::/64`
}

/** Best-effort client identity from Cloudflare's trusted header. */
export function clientIdentity(request: Request): string {
	const headers = request.headers
	return normalizeClientIp(headers.get("cf-connecting-ip") || headers.get("x-real-ip") || "unknown")
}
