import { cleanupHandoffCodes } from "./cleanup"
import {
	decryptHandoffValue,
	encryptHandoffValue,
	jwtRemainingSeconds,
	randomToken,
	sha256Base64Url,
	sha256Hex,
} from "./crypto"
import { allowedOrigin, errorResponse, jsonResponse, preflightResponse } from "./respond"
import { type ConsumedHandoff, createHandoffStore } from "./storage"
import { clientIdentity, edgeLimitAllows, RateLimiter } from "./rate-limit"
import {
	fetchProfile,
	fetchSupabaseUser,
	isVerifiedUser,
	type SupabaseEnv,
	verifySupabaseJwt,
} from "./supabase"

export interface Env extends SupabaseEnv {
	DB?: D1Database
	HANDOFF_ENCRYPTION_KEY: string
	CORS_ORIGINS?: string
	STORAGE_DRIVER?: string
	SUPABASE_SERVICE_ROLE_KEY?: string
	/** Optional override for the isolate caps, as `handoff:exchange:handoff_user:users`. */
	RATE_LIMIT?: string
	EDGE_LIMIT_EXCHANGE_IP?: RateLimit
	EDGE_LIMIT_EXCHANGE_GLOBAL?: RateLimit
	EDGE_LIMIT_HANDOFF_IP?: RateLimit
	EDGE_LIMIT_HANDOFF_GLOBAL?: RateLimit
	EDGE_LIMIT_HANDOFF_USER?: RateLimit
	EDGE_LIMIT_USERS_ME_IP?: RateLimit
	EDGE_LIMIT_USERS_ME_USER?: RateLimit
}

const CLIENT_ID = "vscode"
/**
 * Redirect URIs the extension may legitimately receive its callback on. Stable
 * VS Code registers `vscode://`, Insiders registers `vscode-insiders://`; the
 * extension chooses at handoff time from `vscode.env.uriScheme`. Any other
 * scheme or authority is rejected.
 */
const ALLOWED_CALLBACK_URIS = new Set([
	"vscode://bytos.bytos/auth/callback",
	"vscode-insiders://bytos.bytos/auth/callback",
])
const CODE_TTL_MS = 5 * 60 * 1000
const MAX_BODY_BYTES = 16 * 1024
const MAX_BEARER_TOKEN_LENGTH = 8192
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/
const STATE_PATTERN = /^[A-Za-z0-9_-]{32,256}$/
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/
const VERIFIER_PATTERN = /^[A-Za-z0-9_-]{43,128}$/
const EDGE_RETRY_AFTER_SECONDS = 60

async function verifyTokenOrThrow(token: string, env: Env) {
	try {
		return await verifySupabaseJwt(token, env)
	} catch {
		throw new HttpError(401, "invalid_token", "Invalid or expired token")
	}
}

async function fetchUserOrThrow(token: string, env: Env) {
	try {
		return await fetchSupabaseUser(token, env)
	} catch {
		throw new HttpError(401, "invalid_token", "Invalid or expired token")
	}
}

class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message)
	}
}

function getBearer(request: Request): string {
	const header = request.headers.get("Authorization") ?? ""
	if (!header.startsWith("Bearer ")) throw new HttpError(401, "invalid_token", "Missing bearer token")
	const token = header.slice("Bearer ".length).trim()
	if (!token || token.length > MAX_BEARER_TOKEN_LENGTH || !JWT_PATTERN.test(token)) {
		throw new HttpError(401, "invalid_token", "Invalid bearer token")
	}
	return token
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
	const declared = request.headers.get("Content-Length")
	if (declared !== null) {
		const length = Number(declared)
		if (!Number.isFinite(length) || length < 0) {
			throw new HttpError(400, "invalid_request", "Invalid Content-Length")
		}
		if (length > MAX_BODY_BYTES) {
			throw new HttpError(413, "payload_too_large", "Request body exceeds 16 KB")
		}
	}

	if (!request.body) return new Uint8Array()
	const reader = request.body.getReader()
	const chunks: Uint8Array[] = []
	let total = 0
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			if (!value) continue
			total += value.byteLength
			if (total > MAX_BODY_BYTES) {
				try {
					await reader.cancel()
				} catch {
					/* best-effort cancel */
				}
				throw new HttpError(413, "payload_too_large", "Request body exceeds 16 KB")
			}
			chunks.push(value)
		}
	} finally {
		try {
			reader.releaseLock()
		} catch {
			/* already released */
		}
	}

	const bytes = new Uint8Array(total)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.byteLength
	}
	return bytes
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
	const contentType = (request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase()
	if (contentType !== "application/json") {
		throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json")
	}

	const bytes = await readBoundedBody(request)
	let value: unknown
	try {
		value = JSON.parse(new TextDecoder().decode(bytes))
	} catch {
		throw new HttpError(400, "invalid_request", "Invalid JSON body")
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new HttpError(400, "invalid_request", "Request body must be a JSON object")
	}
	return value as Record<string, unknown>
}

function requireString(body: Record<string, unknown>, key: string, maxLength = 4096): string {
	const value = body[key]
	if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
		throw new HttpError(400, "invalid_request", `Invalid or missing ${key}`)
	}
	return value
}

function assertCallbackUri(value: string): void {
	if (!ALLOWED_CALLBACK_URIS.has(value)) {
		throw new HttpError(400, "invalid_redirect_uri", "Unsupported redirect URI")
	}
}

async function handleHandoffCode(request: Request, env: Env, origin: string | null): Promise<Response> {
	const body = await readJson(request)

	const challenge = requireString(body, "code_challenge", 128)
	const method = requireString(body, "code_challenge_method", 16)
	const state = requireString(body, "state", 256)
	const redirectUri = requireString(body, "redirect_uri", 512)
	const clientId = requireString(body, "client_id", 32)
	const refreshToken = requireString(body, "refresh_token", 4096)

	if (method !== "S256" || !CHALLENGE_PATTERN.test(challenge)) {
		throw new HttpError(400, "invalid_request", "PKCE S256 challenge is required")
	}
	if (!STATE_PATTERN.test(state)) {
		throw new HttpError(400, "invalid_request", "Invalid state")
	}
	assertCallbackUri(redirectUri)
	if (clientId !== CLIENT_ID) {
		throw new HttpError(400, "invalid_request", "Invalid client_id")
	}

	const token = getBearer(request)
	const payload = await verifyTokenOrThrow(token, env)
	const subject = payload.sub as string
	const edgeLimited = await enforceEdgeLimits(
		[
			{ binding: env.EDGE_LIMIT_HANDOFF_USER, key: `handoff:user:${subject}`, limit: 10 },
			{ binding: env.EDGE_LIMIT_HANDOFF_GLOBAL, key: "handoff:global", limit: 300 },
		],
		"/api/v1/auth/handoff/code",
		origin,
	)
	if (edgeLimited) return edgeLimited
	const isolatedLimited = enforceRateLimit("handoff_user", "/api/v1/auth/handoff/code", subject, env, origin)
	if (isolatedLimited) return isolatedLimited

	const user = await fetchUserOrThrow(token, env)
	if (user.id !== payload.sub) {
		throw new HttpError(401, "invalid_token", "Token subject mismatch")
	}
	if (!isVerifiedUser(user)) {
		throw new HttpError(403, "email_not_verified", "Verify your email before connecting VS Code")
	}

	const code = randomToken(32)
	const codeHash = await sha256Hex(code)
	const stateHash = await sha256Hex(state)
	const userId = user.id
	const aad = `${codeHash}|${userId}|${clientId}`
	const encryptedAccess = await encryptHandoffValue(token, env.HANDOFF_ENCRYPTION_KEY, aad)
	const encryptedRefresh = await encryptHandoffValue(refreshToken, env.HANDOFF_ENCRYPTION_KEY, aad)
	const now = Date.now()
	const sessionId = typeof payload.session_id === "string" ? payload.session_id : null

	const store = createHandoffStore(env)
	await store.insert({
		id: crypto.randomUUID(),
		codeHash,
		userId,
		userEmail: user.email ?? "",
		sessionId,
		codeChallenge: challenge,
		codeChallengeMethod: method,
		redirectUri,
		clientId,
		stateHash,
		encryptedAccessToken: encryptedAccess,
		encryptedRefreshToken: encryptedRefresh,
		expiresAt: now + CODE_TTL_MS,
		createdAt: now,
	})

	return jsonResponse({ code, expires_in: CODE_TTL_MS / 1000 }, 200, origin)
}

async function handleExchange(request: Request, env: Env, origin: string | null): Promise<Response> {
	const body = await readJson(request)
	const code = requireString(body, "code", 256)
	const verifier = requireString(body, "code_verifier", 128)
	const redirectUri = requireString(body, "redirect_uri", 512)
	const clientId = requireString(body, "client_id", 32)
	const state = requireString(body, "state", 256)

	if (!CODE_PATTERN.test(code)) {
		throw new HttpError(400, "invalid_request", "Invalid authorization code")
	}
	if (!VERIFIER_PATTERN.test(verifier)) {
		throw new HttpError(400, "invalid_verifier", "Invalid PKCE verifier")
	}
	if (!STATE_PATTERN.test(state)) {
		throw new HttpError(400, "invalid_request", "Invalid state")
	}
	assertCallbackUri(redirectUri)
	if (clientId !== CLIENT_ID) {
		throw new HttpError(400, "invalid_request", "Invalid client_id")
	}

	const challenge = await sha256Base64Url(verifier)
	const codeHash = await sha256Hex(code)
	const stateHash = await sha256Hex(state)
	const now = Date.now()

	const store = createHandoffStore(env)
	const row: ConsumedHandoff | null = await store.consume({
		codeHash,
		codeChallenge: challenge,
		redirectUri,
		clientId,
		stateHash,
		now,
	})

	if (!row) {
		throw new HttpError(400, "invalid_or_expired_code", "This sign-in code is invalid, expired, or already used")
	}

	const aad = `${codeHash}|${row.user_id}|${clientId}`
	const accessToken = await decryptHandoffValue(row.encrypted_access_token, env.HANDOFF_ENCRYPTION_KEY, aad)
	const refreshToken = await decryptHandoffValue(row.encrypted_refresh_token, env.HANDOFF_ENCRYPTION_KEY, aad)

	// Remove the encrypted credentials after a successful decrypt; the row stays as a replay tombstone.
	await store.clearTokens(codeHash)

	// Report the token's real lifetime instead of inventing one. The access token
	// is the session token Supabase issued, so a fixed `expires_in` could hand
	// the extension an already-expired bearer that it treats as fresh.
	const remaining = jwtRemainingSeconds(accessToken, now)
	if (remaining === null) {
		throw new HttpError(
			400,
			"expired_access_token",
			"This sign-in session has expired. Sign in again from the Bytos website.",
		)
	}

	return jsonResponse(
		{
			access_token: accessToken,
			refresh_token: refreshToken,
			token_type: "bearer",
			expires_in: remaining,
			user: { id: row.user_id, email: row.user_email || undefined },
		},
		200,
		origin,
	)
}

async function handleUsersMe(request: Request, env: Env, origin: string | null): Promise<Response> {
	const token = getBearer(request)
	const payload = await verifyTokenOrThrow(token, env)
	const sub = payload.sub as string
	const edgeLimited = await enforceEdgeLimits(
		[{ binding: env.EDGE_LIMIT_USERS_ME_USER, key: `users:user:${sub}`, limit: 120 }],
		"/api/v1/users/me",
		origin,
	)
	if (edgeLimited) return edgeLimited
	const isolatedLimited = enforceRateLimit("users", "/api/v1/users/me", sub, env, origin)
	if (isolatedLimited) return isolatedLimited
	const profile = await fetchProfile(token, sub, env)
	const displayName =
		[profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() ||
		profile?.username ||
		(typeof payload.email === "string" ? payload.email.split("@")[0] : "") ||
		""

	return jsonResponse(
		{
			success: true,
			data: {
				id: sub,
				email: profile?.email ?? (typeof payload.email === "string" ? payload.email : ""),
				displayName,
				photoUrl: "",
				createdAt: profile?.created_at ?? "",
				updatedAt: profile?.updated_at ?? "",
				organizations: [],
			},
		},
		200,
		origin,
	)
}

/** Isolate-local limiter. Policy overrides are read from `env.RATE_LIMIT` per isolate. */
let rateLimiter: RateLimiter | null = null
let rateLimiterConfig = ""

function getRateLimiter(env: Env): RateLimiter {
	const config = env.RATE_LIMIT?.trim() ?? ""
	if (!rateLimiter || rateLimiterConfig !== config) {
		rateLimiter = new RateLimiter(RateLimiter.parseOverride(config) ?? undefined)
		rateLimiterConfig = config
	}
	return rateLimiter
}

function logRateLimit(endpoint: string, limit: number): void {
	console.warn("[bytos-api] rate limit", { endpoint, status: 429, limit })
}

/**
 * Returns a 429 response when the caller is over budget, otherwise `null` so the
 * request proceeds. This is the isolate-local second layer; the edge bindings
 * below provide the global counters.
 */
function enforceRateLimit(
	routeName: string,
	endpoint: string,
	identity: string,
	env: Env,
	origin: string | null,
): Response | null {
	const result = getRateLimiter(env).check(routeName, identity)
	if (result.allowed) return null
	logRateLimit(endpoint, result.limit)
	return errorResponse("rate_limited", "Too many requests. Please wait and try again.", 429, origin, {
		"Retry-After": String(result.retryAfterSeconds),
	})
}

interface EdgeLimitCheck {
	binding: RateLimit | undefined
	key: string
	limit: number
}

/**
 * Cloudflare's Rate Limiting binding is edge-backed (not isolate memory). The
 * checks run in parallel; a missing binding is skipped so local development
 * still uses the isolate limiter.
 */
async function enforceEdgeLimits(
	checks: EdgeLimitCheck[],
	endpoint: string,
	origin: string | null,
): Promise<Response | null> {
	const outcomes = await Promise.all(checks.map((check) => edgeLimitAllows(check.binding, check.key)))
	const deniedIndex = outcomes.findIndex((allowed) => !allowed)
	if (deniedIndex === -1) return null

	logRateLimit(endpoint, checks[deniedIndex].limit)
	return errorResponse("rate_limited", "Too many requests. Please wait and try again.", 429, origin, {
		"Retry-After": String(EDGE_RETRY_AFTER_SECONDS),
	})
}

async function route(request: Request, env: Env): Promise<Response> {
	const origin = allowedOrigin(request, env.CORS_ORIGINS)
	if (request.method === "OPTIONS") return preflightResponse(origin)

	const url = new URL(request.url)
	const path = url.pathname

	if (request.method === "GET" && path === "/health") {
		return jsonResponse({ ok: true }, 200, origin)
	}

	const ip = clientIdentity(request)

	if (request.method === "POST" && path === "/api/v1/auth/handoff/code") {
		const edgeLimited = await enforceEdgeLimits(
			[{ binding: env.EDGE_LIMIT_HANDOFF_IP, key: `handoff:ip:${ip}`, limit: 20 }],
			"/api/v1/auth/handoff/code",
			origin,
		)
		if (edgeLimited) return edgeLimited
		const limited = enforceRateLimit("handoff", "/api/v1/auth/handoff/code", ip, env, origin)
		if (limited) return limited
		return handleHandoffCode(request, env, origin)
	}
	if (request.method === "POST" && path === "/api/v1/auth/exchange") {
		const edgeLimited = await enforceEdgeLimits(
			[
				{ binding: env.EDGE_LIMIT_EXCHANGE_IP, key: `exchange:ip:${ip}`, limit: 30 },
				{ binding: env.EDGE_LIMIT_EXCHANGE_GLOBAL, key: "exchange:global", limit: 300 },
			],
			"/api/v1/auth/exchange",
			origin,
		)
		if (edgeLimited) return edgeLimited
		const limited = enforceRateLimit("exchange", "/api/v1/auth/exchange", ip, env, origin)
		if (limited) return limited
		return handleExchange(request, env, origin)
	}
	if (request.method === "GET" && path === "/api/v1/users/me") {
		const edgeLimited = await enforceEdgeLimits(
			[{ binding: env.EDGE_LIMIT_USERS_ME_IP, key: `users:ip:${ip}`, limit: 240 }],
			"/api/v1/users/me",
			origin,
		)
		if (edgeLimited) return edgeLimited
		return handleUsersMe(request, env, origin)
	}
	return errorResponse("not_found", "Not found", 404, origin)
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const origin = allowedOrigin(request, env.CORS_ORIGINS)
		try {
			return await route(request, env)
		} catch (error) {
			if (error instanceof HttpError) {
				return errorResponse(error.code, error.message, error.status, origin)
			}
			console.error("bytos-api unhandled error", error instanceof Error ? error.stack : String(error))
			return errorResponse("internal_error", "Internal server error", 500, origin)
		}
	},

	async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
		try {
			const result = await cleanupHandoffCodes(env)
			console.log("[bytos-api] handoff cleanup", {
				status: result.status,
				deleted: result.deleted,
			})
		} catch {
			// Never log the storage error: it can contain request/response detail.
			console.error("[bytos-api] handoff cleanup", { status: "error" })
		}
	},
}
