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
import { clientIdentity, RateLimiter } from "./rate-limit"
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
	/** Optional override for the per-window request caps, as `handoff:exchange:tokens`. */
	RATE_LIMIT?: string
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
const STATE_PATTERN = /^[A-Za-z0-9_-]{32,256}$/
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/
const VERIFIER_PATTERN = /^[A-Za-z0-9_-]{43,128}$/

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
	if (!token) throw new HttpError(401, "invalid_token", "Missing bearer token")
	return token
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
	try {
		const value = await request.json()
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new HttpError(400, "invalid_request", "Request body must be a JSON object")
		}
		return value as Record<string, unknown>
	} catch (error) {
		if (error instanceof HttpError) throw error
		throw new HttpError(400, "invalid_request", "Invalid JSON body")
	}
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
	const token = getBearer(request)
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

	const payload = await verifyTokenOrThrow(token, env)
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

	if (!VERIFIER_PATTERN.test(verifier)) {
		throw new HttpError(400, "invalid_verifier", "Invalid PKCE verifier")
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

/**
 * Returns a 429 response when the caller is over budget, otherwise `null` so the
 * request proceeds. Kept out of the handlers so the auth logic stays readable and
 * the limiter can be tested on its own.
 */
function enforceRateLimit(routeName: string, identity: string, env: Env, origin: string | null): Response | null {
	const result = getRateLimiter(env).check(routeName, identity)
	if (result.allowed) return null
	return errorResponse("rate_limited", "Too many requests. Please wait and try again.", 429, origin, {
		"Retry-After": String(result.retryAfterSeconds),
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
	if (request.method === "POST" && path === "/api/v1/auth/handoff/code") {
		const limited = enforceRateLimit("handoff", clientIdentity(request), env, origin)
		if (limited) return limited
		return handleHandoffCode(request, env, origin)
	}
	if (request.method === "POST" && path === "/api/v1/auth/exchange") {
		const limited = enforceRateLimit("exchange", clientIdentity(request), env, origin)
		if (limited) return limited
		return handleExchange(request, env, origin)
	}
	if (request.method === "GET" && path === "/api/v1/users/me") {
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
}
