import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import type * as vscode from "vscode"
import { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import { openExternal } from "@/utils/env"

const SESSION_KEY = "bytos.supabase.session"
const PENDING_KEY = "bytos.supabase.pending"
const CALLBACK_PATH = "/auth/callback"
const CLIENT_ID = "vscode"
const AUTHORITY = "bytos.bytos"
const DEFAULT_SCHEME = "vscode"

/**
 * VS Code URI schemes the handoff callback may use. Stable VS Code registers
 * `vscode://`, Insiders registers `vscode-insiders://`. Nothing else is
 * accepted, at either end of the handshake.
 */
export const SUPPORTED_CALLBACK_SCHEMES = ["vscode", "vscode-insiders"] as const
export type CallbackScheme = (typeof SUPPORTED_CALLBACK_SCHEMES)[number]

const PENDING_TTL_MS = 10 * 60 * 1000
const REFRESH_BUFFER_MS = 60 * 1000
const SUPABASE_CONFIG_URL = "https://bytos.dev/supabase-config.js"

export function isSupportedCallbackScheme(value: string | undefined | null): value is CallbackScheme {
	if (!value) return false
	return (SUPPORTED_CALLBACK_SCHEMES as readonly string[]).includes(value)
}

/** Canonical `scheme://bytos.bytos/auth/callback` for a supported scheme. */
export function callbackUriForScheme(scheme: string): string {
	const normalized = scheme.replace(/:$/, "").toLowerCase()
	return `${normalized}://${AUTHORITY}${CALLBACK_PATH}`
}

/**
 * The scheme the running VS Code build registers, read from the host
 * (`vscode.env.uriScheme`). Falls back to `vscode` when the host does not
 * expose it (standalone, tests) or exposes something unsupported.
 */
let activeCallbackScheme: CallbackScheme = DEFAULT_SCHEME

export function setActiveCallbackScheme(scheme: string | undefined | null): void {
	if (isSupportedCallbackScheme(scheme)) activeCallbackScheme = scheme
}

export function getActiveCallbackScheme(): CallbackScheme {
	return activeCallbackScheme
}

function callbackUri(): string {
	const override = process.env.BYTOS_CALLBACK_URI?.trim()
	if (override) return override
	return callbackUriForScheme(activeCallbackScheme)
}

export interface SupabaseAccountUser {
	uid: string
	email?: string
	displayName?: string
	photoUrl?: string
}

interface SupabaseSession {
	access_token: string
	refresh_token: string
	expires_at: number
	user: SupabaseAccountUser
}

interface PendingHandoff {
	state: string
	verifier: string
	redirectUri: string
	keepSignedIn: boolean
	expiresAt: number
}

interface SupabaseConfig {
	url: string
	anonKey: string
}

export type HandoffCallbackResult = { ok: true; user: SupabaseAccountUser } | { ok: false; reason: string }

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "")
}

function isLocalEnvironment(): boolean {
	return process.env.BYTOS_ENVIRONMENT?.trim().toLowerCase() === "local"
}

/**
 * The account handoff must run against the same deployment that serves the
 * website. `BYTOS_ENVIRONMENT=local` previously kept pointing at the production
 * site/API, which silently tested a different build than the one under
 * development. Explicit env vars still win in every environment.
 */
function apiBaseUrl(): string {
	const explicit = process.env.BYTOS_API_BASE_URL?.trim()
	if (explicit) return trimTrailingSlash(explicit)
	return isLocalEnvironment() ? "http://127.0.0.1:8787" : "https://bytos-api.contact-altinay.workers.dev"
}

function webBaseUrl(): string {
	const explicit = process.env.BYTOS_WEB_BASE_URL?.trim()
	if (explicit) return trimTrailingSlash(explicit)
	return isLocalEnvironment() ? "http://127.0.0.1:3000" : "https://bytos.dev"
}

/** Non-sensitive URL shape for diagnostics; never includes query or fragment. */
function urlShape(value: string): { scheme: string; host: string; path: string } {
	try {
		const parsed = new URL(value)
		return {
			scheme: parsed.protocol.replace(/:$/, "").toLowerCase(),
			host: parsed.host.toLowerCase(),
			path: parsed.pathname,
		}
	} catch {
		return { scheme: "", host: "", path: "" }
	}
}

function hash(value: string): Buffer {
	return createHash("sha256").update(value).digest()
}

function safeEqual(left: string, right: string): boolean {
	const a = hash(left)
	const b = hash(right)
	return a.length === b.length && timingSafeEqual(a, b)
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
	return (await response.json().catch(() => ({}))) as Record<string, unknown>
}

/**
 * Thrown when a caller reaches the account service before a host has supplied
 * `SecretStorage`. Controllers catch this and return an empty account state
 * instead of letting an opaque `INTERNAL` gRPC error escape.
 */
export class SupabaseAccountServiceUnavailableError extends Error {
	constructor() {
		super("Bytos account storage is unavailable in this host")
		this.name = "SupabaseAccountServiceUnavailableError"
	}
}

export class SupabaseAccountService {
	private static instance: SupabaseAccountService | null = null
	private static initialized = false
	private memorySession: SupabaseSession | null = null
	private cachedUser: SupabaseAccountUser | null = null
	private config: SupabaseConfig | null = null
	private initializedSecrets: vscode.SecretStorage | null = null
	private refreshFailed = false

	/**
	 * Binds the host's SecretStorage. Idempotent: repeated calls (extension
	 * activation, webview provider construction, lazy controller access) simply
	 * re-point the binding at the same store and are safe to call any number of
	 * times.
	 */
	static initialize(secrets: vscode.SecretStorage): void {
		const service = SupabaseAccountService.getInstance()
		service.initializedSecrets = secrets
		SupabaseAccountService.initialized = true
	}

	static isInitialized(): boolean {
		return SupabaseAccountService.initialized && Boolean(SupabaseAccountService.instance?.initializedSecrets)
	}

	/** Test isolation. Not used by production code paths. */
	static resetForTests(): void {
		SupabaseAccountService.instance = null
		SupabaseAccountService.initialized = false
	}

	static getInstance(): SupabaseAccountService {
		if (!SupabaseAccountService.instance) {
			SupabaseAccountService.instance = new SupabaseAccountService()
		}
		return SupabaseAccountService.instance
	}

	getCachedUser(): SupabaseAccountUser | null {
		return this.cachedUser
	}

	private secrets(): vscode.SecretStorage {
		if (!this.initializedSecrets) throw new SupabaseAccountServiceUnavailableError()
		return this.initializedSecrets
	}

	private async readSecret(key: string): Promise<string | undefined> {
		return await this.secrets().get(key)
	}

	private async writeSecret(key: string, value: string): Promise<void> {
		await this.secrets().store(key, value)
	}

	private async deleteSecret(key: string): Promise<void> {
		await this.secrets().delete(key)
	}

	private async loadConfig(): Promise<SupabaseConfig> {
		if (this.config) return this.config
		const envUrl = process.env.BYTOS_SUPABASE_URL?.trim()
		const envKey = process.env.BYTOS_SUPABASE_ANON_KEY?.trim()
		if (envUrl && envKey) {
			this.config = { url: trimTrailingSlash(envUrl), anonKey: envKey }
			return this.config
		}
		const response = await fetch(SUPABASE_CONFIG_URL, { cache: "no-store" })
		if (!response.ok) throw new Error("Could not load Bytos account configuration.")
		const text = await response.text()
		const url = /"url"\s*:\s*"([^"]+)"/.exec(text)?.[1]
		const anonKey = /"anonKey"\s*:\s*"([^"]+)"/.exec(text)?.[1]
		if (!url || !anonKey) throw new Error("Bytos account configuration is incomplete.")
		this.config = { url: trimTrailingSlash(url), anonKey }
		return this.config
	}

	private sessionFromResponse(data: Record<string, unknown>, fallback?: SupabaseSession): SupabaseSession {
		const access = typeof data.access_token === "string" ? data.access_token : fallback?.access_token
		const refresh = typeof data.refresh_token === "string" ? data.refresh_token : fallback?.refresh_token
		if (!access || !refresh) throw new Error("Bytos account did not return a valid session.")
		const rawUser = (data.user ?? {}) as Record<string, unknown>
		const uid =
			typeof rawUser.id === "string"
				? rawUser.id
				: (fallback?.user.uid ?? (typeof rawUser.sub === "string" ? rawUser.sub : undefined))
		if (!uid) throw new Error("Bytos account did not return a user.")
		const metadata = (rawUser.user_metadata ?? {}) as Record<string, unknown>
		const email = typeof rawUser.email === "string" ? rawUser.email : fallback?.user.email
		const displayName =
			(typeof metadata.full_name === "string" && metadata.full_name) ||
			(typeof metadata.name === "string" && metadata.name) ||
			fallback?.user.displayName
		const photoUrl = (typeof metadata.avatar_url === "string" && metadata.avatar_url) || fallback?.user.photoUrl
		const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600
		return {
			access_token: access,
			refresh_token: refresh,
			expires_at: Date.now() + expiresIn * 1000,
			user: { uid, email, displayName, photoUrl },
		}
	}

	private async persistSession(session: SupabaseSession, keepSignedIn: boolean): Promise<void> {
		this.cachedUser = session.user
		if (keepSignedIn) {
			await this.writeSecret(SESSION_KEY, JSON.stringify(session))
			this.memorySession = null
		} else {
			this.memorySession = session
			await this.deleteSecret(SESSION_KEY)
		}
	}

	private async readSession(): Promise<SupabaseSession | null> {
		if (this.memorySession) return this.memorySession
		const raw = await this.readSecret(SESSION_KEY)
		if (!raw) return null
		try {
			const parsed = JSON.parse(raw) as SupabaseSession
			if (!parsed.access_token || !parsed.refresh_token || !parsed.user?.uid) return null
			this.cachedUser = parsed.user
			return parsed
		} catch {
			return null
		}
	}

	private async clearSession(): Promise<void> {
		this.memorySession = null
		this.cachedUser = null
		await this.deleteSecret(SESSION_KEY).catch(() => undefined)
	}

	private markWelcome(completed: boolean): void {
		try {
			StateManager.get().setGlobalState("welcomeViewCompleted", completed)
		} catch (error) {
			Logger.error("[SupabaseAccountService] Failed to update welcome state:", error)
		}
	}

	async startSignup(keepSignedIn = true): Promise<string> {
		return this.startHandoff("/signup", keepSignedIn)
	}

	async startSignin(keepSignedIn = true): Promise<string> {
		return this.startHandoff("/signin", keepSignedIn)
	}

	private async startHandoff(path: "/signup" | "/signin", keepSignedIn: boolean): Promise<string> {
		const state = randomBytes(32).toString("base64url")
		const verifier = randomBytes(64).toString("base64url")
		const challenge = createHash("sha256").update(verifier).digest("base64url")
		const pending: PendingHandoff = {
			state,
			verifier,
			redirectUri: callbackUri(),
			keepSignedIn,
			expiresAt: Date.now() + PENDING_TTL_MS,
		}
		await this.writeSecret(PENDING_KEY, JSON.stringify(pending))
		const web = urlShape(webBaseUrl())
		const callback = urlShape(pending.redirectUri)
		Logger.info("[SupabaseAccount] Starting web handoff", {
			path,
			webScheme: web.scheme,
			webHost: web.host,
			callbackScheme: callback.scheme,
			callbackAuthority: callback.host,
			callbackPath: callback.path,
			clientId: CLIENT_ID,
		})
		Logger.debug("[SupabaseAccount] Pending handoff stored", { ttlMs: PENDING_TTL_MS })

		const url = new URL(path, webBaseUrl())
		url.searchParams.set("flow", "extension")
		url.searchParams.set("state", state)
		url.searchParams.set("code_challenge", challenge)
		url.searchParams.set("code_challenge_method", "S256")
		url.searchParams.set("redirect_uri", pending.redirectUri)
		url.searchParams.set("client_id", CLIENT_ID)
		const target = url.toString()
		await openExternal(target)
		return target
	}

	async signIn(email: string, password: string, keepSignedIn = true): Promise<SupabaseAccountUser> {
		const config = await this.loadConfig()
		const response = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
			method: "POST",
			headers: {
				apikey: config.anonKey,
				Authorization: `Bearer ${config.anonKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ email, password }),
		})
		const data = await readJson(response)
		if (!response.ok) {
			const message =
				(typeof data.error_description === "string" && data.error_description) ||
				(typeof data.msg === "string" && data.msg) ||
				(typeof data.error === "string" && data.error) ||
				"Sign in failed."
			throw new Error(message)
		}
		const session = this.sessionFromResponse(data)
		await this.persistSession(session, keepSignedIn)
		this.markWelcome(true)
		return session.user
	}

	async signOut(): Promise<void> {
		const session = await this.readSession()
		await this.clearSession()
		// Signing out must not re-arm the one-time account intro. The title-bar
		// bell is the ongoing signed-out reminder; the account view only opens
		// when the user asks for it.
		if (!session) return
		try {
			const config = await this.loadConfig()
			await fetch(`${config.url}/auth/v1/logout`, {
				method: "POST",
				headers: {
					apikey: config.anonKey,
					Authorization: `Bearer ${session.access_token}`,
				},
			})
		} catch {
			// Local sign-out succeeds even when the network is unavailable.
		}
	}

	private async refresh(session: SupabaseSession): Promise<SupabaseSession | null> {
		try {
			const config = await this.loadConfig()
			const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
				method: "POST",
				headers: {
					apikey: config.anonKey,
					Authorization: `Bearer ${config.anonKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ refresh_token: session.refresh_token }),
			})
			const data = await readJson(response)
			if (!response.ok) return null
			return this.sessionFromResponse(data, session)
		} catch {
			return null
		}
	}

	async getState(): Promise<SupabaseAccountUser | null> {
		const session = await this.readSession()
		if (!session) {
			this.cachedUser = null
			return null
		}
		if (session.expires_at - Date.now() < REFRESH_BUFFER_MS) {
			const refreshed = await this.refresh(session)
			if (!refreshed) {
				await this.clearSession()
				this.refreshFailed = true
				return null
			}
			const keep = Boolean(await this.readSecret(SESSION_KEY))
			await this.persistSession(refreshed, keep)
			return refreshed.user
		}
		this.cachedUser = session.user
		return session.user
	}

	/**
	 * True when the last `getState()` discarded a stored session because the
	 * refresh token could not be redeemed. Lets the UI say "your session
	 * expired, sign in again" instead of silently showing the sign-in form.
	 */
	get lastRefreshFailed(): boolean {
		return this.refreshFailed
	}

	clearRefreshFailedFlag(): void {
		this.refreshFailed = false
	}

	async handleCallback(
		rawUrl: string,
		context: { expectedScheme: string; expectedAuthority: string },
	): Promise<HandoffCallbackResult> {
		let parsed: URL
		try {
			parsed = new URL(rawUrl)
		} catch {
			Logger.warn("[SupabaseAccount] Callback rejected", { reason: "invalid_url" })
			return { ok: false, reason: "invalid_url" }
		}
		const shape = urlShape(rawUrl)
		const callbackParams = new URLSearchParams(parsed.search.slice(1).replace(/\+/g, "%2B"))
		Logger.info("[SupabaseAccount] Callback received", {
			scheme: shape.scheme,
			authority: shape.host,
			path: shape.path,
			hasCode: callbackParams.has("code"),
			hasState: callbackParams.has("state"),
			hasError: callbackParams.has("error"),
		})
		const actualScheme = parsed.protocol.replace(/:$/, "").toLowerCase()
		// Accept any VS Code scheme the extension can actually be registered
		// under (stable or Insiders) and reject every other scheme outright.
		if (!isSupportedCallbackScheme(actualScheme)) return { ok: false, reason: "invalid_scheme" }
		if (!isSupportedCallbackScheme(context.expectedScheme.replace(/:$/, "").toLowerCase()))
			return { ok: false, reason: "invalid_scheme" }
		if (parsed.host.toLowerCase() !== context.expectedAuthority.toLowerCase())
			return { ok: false, reason: "invalid_authority" }
		if (parsed.pathname !== CALLBACK_PATH) return { ok: false, reason: "invalid_path" }

		const pendingRaw = await this.readSecret(PENDING_KEY)
		if (!pendingRaw) return { ok: false, reason: "no_pending_handoff" }
		let pending: PendingHandoff
		try {
			pending = JSON.parse(pendingRaw) as PendingHandoff
		} catch {
			await this.deleteSecret(PENDING_KEY).catch(() => undefined)
			return { ok: false, reason: "invalid_pending_handoff" }
		}
		if (!pending.state || !pending.verifier || Date.now() > pending.expiresAt) {
			await this.deleteSecret(PENDING_KEY).catch(() => undefined)
			return { ok: false, reason: "expired_handoff" }
		}

		const query = new URLSearchParams(parsed.search.slice(1).replace(/\+/g, "%2B"))
		const state = query.get("state")
		if (!state || !safeEqual(state, pending.state)) return { ok: false, reason: "invalid_state" }
		const error = query.get("error")
		if (error) {
			await this.deleteSecret(PENDING_KEY).catch(() => undefined)
			return { ok: false, reason: "cancelled" }
		}
		const code = query.get("code")
		if (!code) return { ok: false, reason: "missing_code" }

		try {
			const api = urlShape(apiBaseUrl())
			Logger.info("[SupabaseAccount] Exchange request", {
				apiScheme: api.scheme,
				apiHost: api.host,
				hasVerifier: Boolean(pending.verifier),
				hasRedirectUri: Boolean(pending.redirectUri),
			})
			const response = await fetch(`${apiBaseUrl()}/api/v1/auth/exchange`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					code,
					code_verifier: pending.verifier,
					redirect_uri: pending.redirectUri,
					client_id: CLIENT_ID,
					state,
				}),
			})
			const data = await readJson(response)
			Logger.info("[SupabaseAccount] Exchange response", { status: response.status })
			if (!response.ok) {
				const message = (typeof data.error === "string" && data.error) || "Could not complete Bytos sign-in."
				throw new Error(message)
			}
			const session = this.sessionFromResponse(data)
			await this.persistSession(session, pending.keepSignedIn)
			await this.deleteSecret(PENDING_KEY).catch(() => undefined)
			this.markWelcome(true)
			Logger.info("[SupabaseAccount] Session stored", { keepSignedIn: pending.keepSignedIn })
			return { ok: true, user: session.user }
		} catch (error) {
			Logger.error(
				"[SupabaseAccountService] Handoff exchange failed:",
				error instanceof Error ? error.message : String(error),
			)
			return { ok: false, reason: "exchange_failed" }
		}
	}
}
