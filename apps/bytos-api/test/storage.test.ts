import { beforeEach, describe, expect, it, mock } from "bun:test"
import { createHandoffStore } from "../src/storage"

const env = {
	SUPABASE_URL: "https://project.supabase.co",
	SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
	STORAGE_DRIVER: "supabase",
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
	return { ok, status, json: async () => body } as unknown as Response
}

const baseRecord = {
	id: "11111111-1111-4111-8111-111111111111",
	codeHash: "code-hash",
	userId: "22222222-2222-4222-8222-222222222222",
	userEmail: "user@example.com",
	sessionId: "session-1",
	codeChallenge: "challenge",
	codeChallengeMethod: "S256",
	redirectUri: "vscode://bytos.bytos/auth/callback",
	clientId: "vscode",
	stateHash: "state-hash",
	encryptedAccessToken: "enc-access",
	encryptedRefreshToken: "enc-refresh",
	expiresAt: Date.now() + 300_000,
	createdAt: Date.now(),
}

describe("Supabase handoff store", () => {
	let fetchMock: ReturnType<typeof mock>

	beforeEach(() => {
		fetchMock = mock(async () => jsonResponse({}))
		globalThis.fetch = fetchMock as unknown as typeof fetch
	})

	it("inserts a code through PostgREST with ISO timestamps", async () => {
		const store = createHandoffStore(env)
		await store.insert(baseRecord)

		const [url, init] = fetchMock.mock.calls[0]
		expect(String(url)).toBe("https://project.supabase.co/rest/v1/handoff_codes")
		expect(init.method).toBe("POST")
		expect(init.headers.Authorization).toBe("Bearer service-role-test")
		expect(init.headers.Prefer).toBe("return=minimal")
		const body = JSON.parse(init.body)
		expect(body.code_hash).toBe("code-hash")
		expect(body.user_id).toBe(baseRecord.userId)
		expect(body.code_challenge).toBe("challenge")
		expect(body.redirect_uri).toBe(baseRecord.redirectUri)
		expect(body.encrypted_access_token).toBe("enc-access")
		expect(typeof body.expires_at).toBe("string")
		expect(new Date(body.expires_at).getTime()).toBe(baseRecord.expiresAt)
	})

	it("consumes atomically through the RPC", async () => {
		const consumed = {
			encrypted_access_token: "enc-access",
			encrypted_refresh_token: "enc-refresh",
			user_id: baseRecord.userId,
			user_email: baseRecord.userEmail,
			session_id: baseRecord.sessionId,
		}
		fetchMock.mockImplementation(async () => jsonResponse([consumed]))
		const store = createHandoffStore(env)
		const result = await store.consume({
			codeHash: "code-hash",
			codeChallenge: "challenge",
			redirectUri: baseRecord.redirectUri,
			clientId: "vscode",
			stateHash: "state-hash",
			now: 1_700_000_000_000,
		})

		const [url, init] = fetchMock.mock.calls[0]
		expect(String(url)).toBe("https://project.supabase.co/rest/v1/rpc/consume_handoff_code")
		expect(init.method).toBe("POST")
		const body = JSON.parse(init.body)
		expect(body.p_code_hash).toBe("code-hash")
		expect(body.p_code_challenge).toBe("challenge")
		expect(body.p_redirect_uri).toBe(baseRecord.redirectUri)
		expect(body.p_client_id).toBe("vscode")
		expect(body.p_state_hash).toBe("state-hash")
		expect(body.p_now).toBe(new Date(1_700_000_000_000).toISOString())
		expect(result).toEqual(consumed)
	})

	it("returns null when the RPC returns no rows", async () => {
		fetchMock.mockImplementation(async () => jsonResponse([]))
		const store = createHandoffStore(env)
		expect(
			await store.consume({
				codeHash: "code-hash",
				codeChallenge: "challenge",
				redirectUri: baseRecord.redirectUri,
				clientId: "vscode",
				stateHash: "state-hash",
				now: Date.now(),
			}),
		).toBeNull()
	})

	it("clears encrypted tokens with a filtered PATCH", async () => {
		const store = createHandoffStore(env)
		await store.clearTokens("code-hash")

		const [url, init] = fetchMock.mock.calls[0]
		expect(String(url)).toContain("/rest/v1/handoff_codes?code_hash=eq.code-hash")
		expect(init.method).toBe("PATCH")
		expect(JSON.parse(init.body)).toEqual({
			encrypted_access_token: "",
			encrypted_refresh_token: "",
		})
	})

	it("requires a service-role key for Supabase storage", () => {
		expect(() => createHandoffStore({ ...env, SUPABASE_SERVICE_ROLE_KEY: undefined })).toThrow(
			"SUPABASE_SERVICE_ROLE_KEY",
		)
	})
})
