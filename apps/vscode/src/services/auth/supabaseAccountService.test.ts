import { beforeEach, describe, expect, it, mock } from "bun:test"

const openExternal = mock(async (_url: string) => {})
const setGlobalState = mock((_key: string, _value: unknown) => {})

mock.module("@/utils/env", () => ({ openExternal }))
mock.module("@/core/storage/StateManager", () => ({
	StateManager: { get: () => ({ setGlobalState }) },
}))
mock.module("@/shared/services/Logger", () => ({
	Logger: { error: () => {}, log: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}))

import { SupabaseAccountService } from "./supabaseAccountService"

process.env.BYTOS_API_BASE_URL = "http://worker.test"
process.env.BYTOS_WEB_BASE_URL = "https://web.test"
process.env.BYTOS_SUPABASE_URL = "https://supabase.test"
process.env.BYTOS_SUPABASE_ANON_KEY = "anon-test"

class FakeSecrets {
	private readonly map = new Map<string, string>()

	async get(key: string): Promise<string | undefined> {
		return this.map.get(key)
	}

	async store(key: string, value: string): Promise<void> {
		this.map.set(key, value)
	}

	async delete(key: string): Promise<void> {
		this.map.delete(key)
	}

	has(key: string): boolean {
		return this.map.has(key)
	}

	read(key: string): string | undefined {
		return this.map.get(key)
	}
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
	return { ok, status, json: async () => body } as unknown as Response
}

function installFetch(
	overrides: { exchange?: () => Response; password?: () => Response; refresh?: () => Response; logout?: () => Response } = {},
) {
	const fetchMock = mock(async (input: RequestInfo | URL) => {
		const url = String(input)
		if (url.includes("/api/v1/auth/exchange")) {
			return (
				overrides.exchange ??
				(() =>
					jsonResponse({
						access_token: "access-token",
						refresh_token: "refresh-token",
						expires_in: 3600,
						user: { id: "user-1", email: "user@example.com" },
					}))()
			)
		}
		if (url.includes("grant_type=password")) {
			return (
				overrides.password ??
				(() =>
					jsonResponse({
						access_token: "password-access",
						refresh_token: "password-refresh",
						expires_in: 3600,
						user: { id: "user-1", email: "user@example.com", user_metadata: { full_name: "Test User" } },
					}))()
			)
		}
		if (url.includes("grant_type=refresh_token")) {
			return (
				overrides.refresh ??
				(() =>
					jsonResponse({
						access_token: "refreshed-access",
						refresh_token: "refreshed-refresh",
						expires_in: 3600,
						user: { id: "user-1", email: "user@example.com" },
					}))()
			)
		}
		if (url.includes("/auth/v1/logout")) {
			return (overrides.logout ?? (() => jsonResponse({}, true, 204)))()
		}
		throw new Error(`Unexpected fetch: ${url}`)
	})
	globalThis.fetch = fetchMock as unknown as typeof fetch
	return fetchMock
}

let secrets: FakeSecrets

function service(): SupabaseAccountService {
	return SupabaseAccountService.getInstance()
}

function parseSignupUrl(url: string): URL {
	return new URL(url)
}

describe("SupabaseAccountService", () => {
	beforeEach(() => {
		SupabaseAccountService.resetForTests()
		secrets = new FakeSecrets()
		SupabaseAccountService.initialize(secrets as never)
		openExternal.mockClear()
		setGlobalState.mockClear()
		installFetch()
	})

	it("starts signup with state, S256 PKCE and the exact callback", async () => {
		const url = await service().startSignup(true)
		const parsed = parseSignupUrl(url)
		expect(parsed.origin).toBe("https://web.test")
		expect(parsed.pathname).toBe("/signup")
		expect(parsed.searchParams.get("flow")).toBe("extension")
		expect(parsed.searchParams.get("code_challenge_method")).toBe("S256")
		expect(parsed.searchParams.get("redirect_uri")).toBe("vscode://bytos.bytos/auth/callback")
		expect(parsed.searchParams.get("client_id")).toBe("vscode")
		expect(parsed.searchParams.get("state")?.length).toBeGreaterThanOrEqual(32)
		expect(parsed.searchParams.get("code_challenge")?.length).toBe(43)
		expect(parsed.toString()).not.toContain("verifier")
		expect(openExternal).toHaveBeenCalledTimes(1)
		expect(secrets.has("bytos.supabase.pending")).toBe(true)
	})

	it("exchanges the callback code and stores the session in SecretStorage", async () => {
		const url = await service().startSignup(true)
		const state = parseSignupUrl(url).searchParams.get("state") as string

		const result = await service().handleCallback(`vscode://bytos.bytos/auth/callback?code=code-1&state=${state}`, {
			expectedScheme: "vscode",
			expectedAuthority: "bytos.bytos",
		})

		expect(result).toEqual({ ok: true, user: { uid: "user-1", email: "user@example.com" } })
		expect(secrets.has("bytos.supabase.pending")).toBe(false)
		const stored = JSON.parse(secrets.read("bytos.supabase.session") ?? "null")
		expect(stored).toMatchObject({ access_token: "access-token", refresh_token: "refresh-token" })
		expect(setGlobalState).toHaveBeenCalledWith("welcomeViewCompleted", true)
	})

	it("rejects a wrong state and keeps the pending handoff", async () => {
		const url = await service().startSignup(true)
		expect(parseSignupUrl(url).searchParams.get("state")).toBeTruthy()

		const result = await service().handleCallback("vscode://bytos.bytos/auth/callback?code=code-1&state=wrong", {
			expectedScheme: "vscode",
			expectedAuthority: "bytos.bytos",
		})

		expect(result).toEqual({ ok: false, reason: "invalid_state" })
		expect(secrets.has("bytos.supabase.pending")).toBe(true)
	})

	it("rejects an expired pending handoff", async () => {
		await service().startSignup(true)
		const pending = JSON.parse(secrets.read("bytos.supabase.pending") ?? "{}")
		pending.expiresAt = Date.now() - 1
		await secrets.store("bytos.supabase.pending", JSON.stringify(pending))

		const result = await service().handleCallback(
			`vscode://bytos.bytos/auth/callback?code=code-1&state=${encodeURIComponent(pending.state)}`,
			{ expectedScheme: "vscode", expectedAuthority: "bytos.bytos" },
		)

		expect(result).toEqual({ ok: false, reason: "expired_handoff" })
		expect(secrets.has("bytos.supabase.pending")).toBe(false)
	})

	it("rejects a callback from the wrong scheme or authority", async () => {
		const url = await service().startSignup(true)
		const state = parseSignupUrl(url).searchParams.get("state") as string

		expect(
			(
				await service().handleCallback(`https://bytos.bytos/auth/callback?code=c&state=${state}`, {
					expectedScheme: "vscode",
					expectedAuthority: "bytos.bytos",
				})
			).ok,
		).toBe(false)
		expect(
			(
				await service().handleCallback(`vscode://evil.extension/auth/callback?code=c&state=${state}`, {
					expectedScheme: "vscode",
					expectedAuthority: "bytos.bytos",
				})
			).ok,
		).toBe(false)
	})

	it("signs in with Supabase email/password and restores the session", async () => {
		const user = await service().signIn("user@example.com", "secret", true)
		expect(user).toEqual({ uid: "user-1", email: "user@example.com", displayName: "Test User", photoUrl: undefined })
		expect(secrets.has("bytos.supabase.session")).toBe(true)
		expect(setGlobalState).toHaveBeenCalledWith("welcomeViewCompleted", true)

		const restored = await service().getState()
		expect(restored?.email).toBe("user@example.com")
	})

	it("keeps a non-persistent session in memory when keep-signed-in is off", async () => {
		await service().signIn("user@example.com", "secret", false)
		expect(secrets.has("bytos.supabase.session")).toBe(false)
		expect((await service().getState())?.email).toBe("user@example.com")
	})

	it("refreshes an expired stored session", async () => {
		const session = {
			access_token: "old-access",
			refresh_token: "old-refresh",
			expires_at: Date.now() - 1,
			user: { uid: "user-1", email: "user@example.com" },
		}
		await secrets.store("bytos.supabase.session", JSON.stringify(session))
		const user = await service().getState()
		expect(user?.email).toBe("user@example.com")
		const stored = JSON.parse(secrets.read("bytos.supabase.session") ?? "null")
		expect(stored.access_token).toBe("refreshed-access")
	})

	it("uses local website and API defaults when BYTOS_ENVIRONMENT=local", async () => {
		const previousWeb = process.env.BYTOS_WEB_BASE_URL
		const previousApi = process.env.BYTOS_API_BASE_URL
		const previousEnvironment = process.env.BYTOS_ENVIRONMENT
		delete process.env.BYTOS_WEB_BASE_URL
		delete process.env.BYTOS_API_BASE_URL
		process.env.BYTOS_ENVIRONMENT = "local"
		try {
			const url = await service().startSignup(true)
			expect(new URL(url).origin).toBe("http://127.0.0.1:3000")
			expect(new URL(url).pathname).toBe("/signup")
		} finally {
			if (previousWeb === undefined) delete process.env.BYTOS_WEB_BASE_URL
			else process.env.BYTOS_WEB_BASE_URL = previousWeb
			if (previousApi === undefined) delete process.env.BYTOS_API_BASE_URL
			else process.env.BYTOS_API_BASE_URL = previousApi
			if (previousEnvironment === undefined) delete process.env.BYTOS_ENVIRONMENT
			else process.env.BYTOS_ENVIRONMENT = previousEnvironment
		}
	})

	it("clears SecretStorage and marks onboarding incomplete on sign out", async () => {
		await service().signIn("user@example.com", "secret", true)
		await service().signOut()
		expect(secrets.has("bytos.supabase.session")).toBe(false)
		expect(setGlobalState).toHaveBeenCalledWith("welcomeViewCompleted", false)
	})

	it("does not clear SecretStorage when the sign-out network call hangs", async () => {
		await service().signIn("user@example.com", "secret", true)
		installFetch({ logout: () => Promise.reject(new Error("network down")) as never })
		await service().signOut()
		// Local state must be gone even though the logout request failed.
		expect(secrets.has("bytos.supabase.session")).toBe(false)
		expect(await service().getState()).toBeNull()
	})

	it("reports a refresh failure so the UI can ask for a new sign-in", async () => {
		const session = {
			access_token: "old-access",
			refresh_token: "old-refresh",
			expires_at: Date.now() - 1,
			user: { uid: "user-1", email: "user@example.com" },
		}
		await secrets.store("bytos.supabase.session", JSON.stringify(session))
		installFetch({ refresh: () => jsonResponse({ error: "invalid_grant" }, false, 400) })

		expect(await service().getState()).toBeNull()
		expect(service().lastRefreshFailed).toBe(true)
		expect(secrets.has("bytos.supabase.session")).toBe(false)
	})
})
