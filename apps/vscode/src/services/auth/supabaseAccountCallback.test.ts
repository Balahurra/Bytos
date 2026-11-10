import { beforeEach, describe, expect, it, mock } from "bun:test"

/**
 * Production-path tests for the web -> VS Code account callback.
 *
 * These drive `SupabaseAccountService.handleCallback` itself — the code the VS
 * Code URI handler actually calls — rather than a helper. They exercise the
 * scheme/authority/path checks, state comparison, expiry, replay and the
 * exchange HTTP contract against a fake SecretStorage and a fake fetch.
 */

const openExternal = mock(async (_url: string) => {})

mock.module("@/utils/env", () => ({ openExternal }))
mock.module("@/core/storage/StateManager", () => ({
	StateManager: { get: () => ({ setGlobalState: () => {} }) },
}))
mock.module("@/shared/services/Logger", () => ({
	Logger: { error: () => {}, log: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}))

import {
	callbackUriForScheme,
	getActiveCallbackScheme,
	SUPPORTED_CALLBACK_SCHEMES,
	SupabaseAccountService,
	setActiveCallbackScheme,
} from "./supabaseAccountService"

process.env.BYTOS_API_BASE_URL = "http://worker.test"
process.env.BYTOS_WEB_BASE_URL = "https://web.test"

class FakeSecrets {
	readonly map = new Map<string, string>()
	async get(key: string): Promise<string | undefined> {
		return this.map.get(key)
	}
	async store(key: string, value: string): Promise<void> {
		this.map.set(key, value)
	}
	async delete(key: string): Promise<void> {
		this.map.delete(key)
	}
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
	return { ok, status, json: async () => body } as unknown as Response
}

let secrets: FakeSecrets
let exchangeCalls = 0

function installFetch(): void {
	exchangeCalls = 0
	globalThis.fetch = mock(async (input: RequestInfo | URL) => {
		const url = String(input)
		if (url.includes("/api/v1/auth/exchange")) {
			exchangeCalls += 1
			return jsonResponse({
				access_token: "access-token",
				refresh_token: "refresh-token",
				expires_in: 3600,
				user: { id: "user-1", email: "user@example.com" },
			})
		}
		throw new Error(`Unexpected fetch: ${url}`)
	}) as unknown as typeof fetch
}

const SCHEME = "vscode"
const AUTHORITY = "bytos.bytos"
const CONTEXT = { expectedScheme: SCHEME, expectedAuthority: AUTHORITY }

/** Runs a real handoff start and returns the state it persisted (via the returned URL). */
async function startHandoff(): Promise<string> {
	const url = await SupabaseAccountService.getInstance().startSignup(true)
	return new URL(url).searchParams.get("state") as string
}

function callbackFor(scheme: string, state: string, params: Record<string, string> = { code: "the-code" }): string {
	const url = new URL(`${scheme}://${AUTHORITY}/auth/callback`)
	url.searchParams.set("state", state)
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
	return url.toString()
}

describe("SupabaseAccountService.handleCallback (production path)", () => {
	beforeEach(() => {
		SupabaseAccountService.resetForTests()
		secrets = new FakeSecrets()
		SupabaseAccountService.initialize(secrets as never)
		setActiveCallbackScheme(SCHEME)
		installFetch()
		openExternal.mockClear()
	})

	describe("callback scheme", () => {
		it("supports exactly the stable and Insiders VS Code schemes", () => {
			expect([...SUPPORTED_CALLBACK_SCHEMES]).toEqual(["vscode", "vscode-insiders"])
			expect(callbackUriForScheme("vscode")).toBe("vscode://bytos.bytos/auth/callback")
			expect(callbackUriForScheme("vscode-insiders")).toBe("vscode-insiders://bytos.bytos/auth/callback")
		})

		it("defaults to the stable scheme and adopts a supported host scheme", () => {
			SupabaseAccountService.resetForTests()
			expect(getActiveCallbackScheme()).toBe("vscode")
			setActiveCallbackScheme("vscode-insiders")
			expect(getActiveCallbackScheme()).toBe("vscode-insiders")
			setActiveCallbackScheme("vscode")
			expect(getActiveCallbackScheme()).toBe("vscode")
		})

		it("ignores an unsupported host scheme rather than adopting it", () => {
			setActiveCallbackScheme("vscode")
			setActiveCallbackScheme("cursor")
			expect(getActiveCallbackScheme()).toBe("vscode")
		})

		it("builds the handoff URL on the active scheme (Insiders)", async () => {
			setActiveCallbackScheme("vscode-insiders")
			const url = await SupabaseAccountService.getInstance().startSignup(true)
			expect(new URL(url).searchParams.get("redirect_uri")).toBe("vscode-insiders://bytos.bytos/auth/callback")
		})

		it("accepts an Insiders callback while the host is Insiders", async () => {
			setActiveCallbackScheme("vscode-insiders")
			const state = await startHandoff()
			const result = await SupabaseAccountService.getInstance().handleCallback(callbackFor("vscode-insiders", state), {
				expectedScheme: "vscode-insiders",
				expectedAuthority: AUTHORITY,
			})
			expect(result.ok).toBe(true)
			expect(exchangeCalls).toBe(1)
		})

		it("rejects a non-VS-Code scheme even when the state is correct", async () => {
			const state = await startHandoff()
			const result = await SupabaseAccountService.getInstance().handleCallback(callbackFor("https", state), CONTEXT)
			expect(result).toEqual({ ok: false, reason: "invalid_scheme" })
			expect(exchangeCalls).toBe(0)
		})

		it("rejects an arbitrary custom scheme", async () => {
			const state = await startHandoff()
			const result = await SupabaseAccountService.getInstance().handleCallback(callbackFor("cursor", state), CONTEXT)
			expect(result).toEqual({ ok: false, reason: "invalid_scheme" })
		})

		it("rejects a wrong authority", async () => {
			const state = await startHandoff()
			const result = await SupabaseAccountService.getInstance().handleCallback(
				`vscode://evil.extension/auth/callback?state=${state}&code=c`,
				CONTEXT,
			)
			expect(result).toEqual({ ok: false, reason: "invalid_authority" })
		})

		it("rejects a wrong path", async () => {
			const state = await startHandoff()
			const result = await SupabaseAccountService.getInstance().handleCallback(
				`vscode://${AUTHORITY}/not-the-callback?state=${state}&code=c`,
				CONTEXT,
			)
			expect(result).toEqual({ ok: false, reason: "invalid_path" })
		})
	})

	describe("state, replay and exchange", () => {
		it("exchanges a valid callback exactly once and stores the session", async () => {
			const state = await startHandoff()
			const result = await SupabaseAccountService.getInstance().handleCallback(callbackFor("vscode", state), CONTEXT)

			expect(result).toEqual({
				ok: true,
				user: { uid: "user-1", email: "user@example.com", displayName: undefined, photoUrl: undefined },
			})
			expect(exchangeCalls).toBe(1)
			expect(secrets.map.has("bytos.supabase.session")).toBe(true)
			expect(secrets.map.has("bytos.supabase.pending")).toBe(false)
		})

		it("rejects a wrong state without consuming the pending handoff", async () => {
			const state = await startHandoff()
			const service = SupabaseAccountService.getInstance()

			expect(await service.handleCallback(callbackFor("vscode", "not-the-state"), CONTEXT)).toEqual({
				ok: false,
				reason: "invalid_state",
			})
			// The legitimate callback must still work afterwards.
			expect((await service.handleCallback(callbackFor("vscode", state), CONTEXT)).ok).toBe(true)
		})

		it("rejects a replayed callback once the code was consumed", async () => {
			const state = await startHandoff()
			const service = SupabaseAccountService.getInstance()

			expect((await service.handleCallback(callbackFor("vscode", state), CONTEXT)).ok).toBe(true)
			const replay = await service.handleCallback(callbackFor("vscode", state), CONTEXT)

			expect(replay.ok).toBe(false)
			expect(exchangeCalls).toBe(1)
		})

		it("rejects an expired pending handoff and clears it", async () => {
			await startHandoff()
			const pending = JSON.parse(secrets.map.get("bytos.supabase.pending") ?? "{}")
			pending.expiresAt = Date.now() - 1
			secrets.map.set("bytos.supabase.pending", JSON.stringify(pending))

			const result = await SupabaseAccountService.getInstance().handleCallback(
				callbackFor("vscode", pending.state),
				CONTEXT,
			)
			expect(result).toEqual({ ok: false, reason: "expired_handoff" })
			expect(secrets.map.has("bytos.supabase.pending")).toBe(false)
		})

		it("treats an OAuth cancellation as a one-time cancel and never exchanges", async () => {
			const state = await startHandoff()
			const service = SupabaseAccountService.getInstance()

			expect(await service.handleCallback(callbackFor("vscode", state, { error: "access_denied" }), CONTEXT)).toEqual({
				ok: false,
				reason: "cancelled",
			})
			expect(exchangeCalls).toBe(0)
			expect(secrets.map.has("bytos.supabase.pending")).toBe(false)
		})

		it("rejects a callback with no pending handoff", async () => {
			const result = await SupabaseAccountService.getInstance().handleCallback(
				callbackFor("vscode", "orphan-state"),
				CONTEXT,
			)
			expect(result).toEqual({ ok: false, reason: "no_pending_handoff" })
			expect(exchangeCalls).toBe(0)
		})

		it("lets exactly one of two concurrent callbacks establish the session", async () => {
			const state = await startHandoff()
			const service = SupabaseAccountService.getInstance()
			// Model the Worker's atomic single-use consume: the first exchange of this
			// code succeeds, every later exchange of the same code is rejected. The
			// fake reads this counter at call time, so it behaves atomically even when
			// both callbacks are in flight together.
			exchangeCalls = 0
			const original = globalThis.fetch
			globalThis.fetch = mock(async (input: RequestInfo | URL) => {
				const url = String(input)
				if (!url.includes("/api/v1/auth/exchange")) throw new Error(`Unexpected fetch: ${url}`)
				const attempt = (exchangeCalls += 1)
				if (attempt > 1) {
					return jsonResponse({ success: false, code: "invalid_or_expired_code" }, false, 400)
				}
				return jsonResponse({
					access_token: "access-token",
					refresh_token: "refresh-token",
					expires_in: 3600,
					user: { id: "user-1", email: "user@example.com" },
				})
			}) as unknown as typeof fetch

			const [a, b] = await Promise.all([
				service.handleCallback(callbackFor("vscode", state), CONTEXT),
				service.handleCallback(callbackFor("vscode", state), CONTEXT),
			])
			globalThis.fetch = original

			expect([a.ok, b.ok].filter(Boolean).length).toBe(1)
			expect(exchangeCalls).toBe(2)
		})

		it("never returns tokens to the caller", async () => {
			const state = await startHandoff()
			const result = await SupabaseAccountService.getInstance().handleCallback(callbackFor("vscode", state), CONTEXT)
			const serialized = JSON.stringify(result)
			expect(serialized).not.toContain("access-token")
			expect(serialized).not.toContain("refresh-token")
		})
	})
})
