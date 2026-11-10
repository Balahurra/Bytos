import { describe, expect, it } from "bun:test"
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import worker, { type Env } from "../src/index"

const SUPABASE_URL = "https://project.supabase.co"
const JWKS_URL = `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`
const USERINFO_URL = `${SUPABASE_URL}/auth/v1/user`
const REDIRECT = "vscode://bytos.bytos/auth/callback"
const USER_ID = "11111111-1111-4111-8111-111111111111"
const ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64")

const { publicKey, privateKey } = await generateKeyPair("ES256")
const jwk = await exportJWK(publicKey)
jwk.kid = "request-guard-test"
jwk.alg = "ES256"
jwk.use = "sig"

const token = await new SignJWT({
	role: "authenticated",
	email: "user@example.com",
	session_id: "session-1",
})
	.setProtectedHeader({ alg: "ES256", kid: jwk.kid, typ: "JWT" })
	.setIssuer(`${SUPABASE_URL}/auth/v1`)
	.setAudience("authenticated")
	.setSubject(USER_ID)
	.setIssuedAt()
	.setExpirationTime("1h")
	.sign(privateKey)

const user = {
	id: USER_ID,
	email: "user@example.com",
	email_confirmed_at: "2026-01-01T00:00:00.000Z",
	confirmed_at: "2026-01-01T00:00:00.000Z",
	identities: [{ provider: "email" }],
}

const profile = {
	id: USER_ID,
	email: "user@example.com",
	first_name: "Test",
	last_name: "User",
	username: "testuser",
	created_at: "2026-01-01T00:00:00.000Z",
	updated_at: "2026-01-01T00:00:00.000Z",
}

type MockOptions = {
	rpcBody?: unknown
	profileBody?: unknown
}

function installFetch(options: MockOptions = {}) {
	const calls: string[] = []
	const original = globalThis.fetch
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = input instanceof Request ? input.url : String(input)
		calls.push(url)

		let status = 200
		let body: unknown = {}
		if (url.includes("/.well-known/jwks.json")) body = { keys: [jwk] }
		else if (url.includes("/auth/v1/user")) body = user
		else if (url.includes("/rest/v1/profiles")) body = options.profileBody ?? [profile]
		else if (url.includes("/rest/v1/rpc/consume_handoff_code")) body = options.rpcBody ?? []
		else if (url.includes("/rest/v1/handoff_codes")) body = {}
		else {
			status = 404
			body = { error: "not_found" }
		}

		const response = {
			ok: status >= 200 && status < 300,
			status,
			headers: new Headers(),
			json: async () => body,
			text: async () => JSON.stringify(body),
			clone() {
				return this
			},
		}
		return response as unknown as Response
	}) as typeof fetch

	return {
		calls,
		restore() {
			globalThis.fetch = original
		},
	}
}

function edge(success: boolean, keys?: string[]) {
	return {
		async limit(options: { key: string }) {
			keys?.push(options.key)
			return { success }
		},
	}
}

function makeEnv(overrides: Partial<Env> = {}): Env {
	return {
		SUPABASE_URL,
		SUPABASE_ANON_KEY: "anon-test",
		SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
		SUPABASE_JWKS_URL: JWKS_URL,
		SUPABASE_USERINFO_URL: USERINFO_URL,
		HANDOFF_ENCRYPTION_KEY: ENCRYPTION_KEY,
		STORAGE_DRIVER: "supabase",
		RATE_LIMIT: "100:100:100:100",
		EDGE_LIMIT_EXCHANGE_IP: edge(true),
		EDGE_LIMIT_EXCHANGE_GLOBAL: edge(true),
		EDGE_LIMIT_HANDOFF_IP: edge(true),
		EDGE_LIMIT_HANDOFF_GLOBAL: edge(true),
		EDGE_LIMIT_HANDOFF_USER: edge(true),
		EDGE_LIMIT_USERS_ME_IP: edge(true),
		EDGE_LIMIT_USERS_ME_USER: edge(true),
		...overrides,
	} as Env
}

function exchangeRequest(ip: string, contentType = "application/json", body = "{}") {
	return new Request("https://api.test/api/v1/auth/exchange", {
		method: "POST",
		headers: { "Content-Type": contentType, "cf-connecting-ip": ip },
		body,
	})
}

function validExchangeBody() {
	return JSON.stringify({
		code: "a".repeat(43),
		code_verifier: "b".repeat(43),
		redirect_uri: REDIRECT,
		client_id: "vscode",
		state: "c".repeat(32),
	})
}

function validHandoffBody() {
	return JSON.stringify({
		code_challenge: "d".repeat(43),
		code_challenge_method: "S256",
		state: "e".repeat(32),
		redirect_uri: REDIRECT,
		client_id: "vscode",
		refresh_token: "refresh-token-test",
	})
}

function handoffRequest(ip: string) {
	return new Request("https://api.test/api/v1/auth/handoff/code", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
			"cf-connecting-ip": ip,
		},
		body: validHandoffBody(),
	})
}

function usersMeRequest(ip: string) {
	return new Request("https://api.test/api/v1/users/me", {
		headers: { Authorization: `Bearer ${token}`, "cf-connecting-ip": ip },
	})
}

describe("edge rate limits", () => {
	it("returns 429 with Retry-After and never touches Supabase when the IP edge limit is hit", async () => {
		const fetch = installFetch()
		const keys: string[] = []
		const env = makeEnv({
			RATE_LIMIT: "101:100:100:100",
			EDGE_LIMIT_EXCHANGE_IP: edge(false, keys),
		})
		try {
			const response = await worker.fetch(
				exchangeRequest("2001:db8:abcd:1234:5678:9abc:def0:1234"),
				env,
			)
			expect(response.status).toBe(429)
			expect(response.headers.get("Retry-After")).toBe("60")
			expect(response.headers.get("Access-Control-Expose-Headers")).toBe("Retry-After")
			expect(keys).toContain("exchange:ip:2001:db8:abcd:1234::/64")
			expect(fetch.calls).toHaveLength(0)
		} finally {
			fetch.restore()
		}
	})

	it("uses a global exchange counter independent of the client IP", async () => {
		const fetch = installFetch()
		const keys: string[] = []
		const env = makeEnv({
			RATE_LIMIT: "102:100:100:100",
			EDGE_LIMIT_EXCHANGE_GLOBAL: edge(false, keys),
		})
		try {
			const response = await worker.fetch(exchangeRequest("203.0.113.10"), env)
			expect(response.status).toBe(429)
			expect(keys).toContain("exchange:global")
			expect(fetch.calls).toHaveLength(0)
		} finally {
			fetch.restore()
		}
	})

	it("logs only the endpoint, status and limit on a denial", async () => {
		const fetch = installFetch()
		const logs: unknown[][] = []
		const originalWarn = console.warn
		console.warn = (...args: unknown[]) => {
			logs.push(args)
		}
		const env = makeEnv({
			RATE_LIMIT: "111:100:100:100",
			EDGE_LIMIT_EXCHANGE_IP: edge(false),
		})
		try {
			await worker.fetch(exchangeRequest("203.0.113.19"), env)
		} finally {
			console.warn = originalWarn
			fetch.restore()
		}

		expect(logs).toEqual([
			[
				"[bytos-api] rate limit",
				{ endpoint: "/api/v1/auth/exchange", status: 429, limit: 30 },
			],
		])
		expect(JSON.stringify(logs)).not.toContain("203.0.113.19")
	})

	it("applies the edge user limit to /users/me before any profile query", async () => {
		const fetch = installFetch()
		const keys: string[] = []
		const env = makeEnv({
			RATE_LIMIT: "103:100:100:100",
			EDGE_LIMIT_USERS_ME_USER: edge(false, keys),
		})
		try {
			const response = await worker.fetch(usersMeRequest("203.0.113.11"), env)
			expect(response.status).toBe(429)
			expect(keys.some((key) => key === `users:user:${USER_ID}`)).toBe(true)
			expect(fetch.calls.some((url) => url.includes("/rest/v1/profiles"))).toBe(false)
		} finally {
			fetch.restore()
		}
	})
})

describe("request body guards", () => {
	it("rejects a wrong Content-Type with 415 before Supabase", async () => {
		const fetch = installFetch()
		const env = makeEnv({ RATE_LIMIT: "104:100:100:100" })
		try {
			const response = await worker.fetch(
				exchangeRequest("203.0.113.12", "text/plain", validExchangeBody()),
				env,
			)
			expect(response.status).toBe(415)
			expect(fetch.calls).toHaveLength(0)
		} finally {
			fetch.restore()
		}
	})

	it("rejects a body over 16 KB with 413 before Supabase", async () => {
		const fetch = installFetch()
		const env = makeEnv({ RATE_LIMIT: "105:100:100:100" })
		try {
			const response = await worker.fetch(
				exchangeRequest("203.0.113.13", "application/json", "x".repeat(16 * 1024 + 1)),
				env,
			)
			expect(response.status).toBe(413)
			expect(fetch.calls).toHaveLength(0)
		} finally {
			fetch.restore()
		}
	})

	it("rejects a non-JWT bearer token before JWKS", async () => {
		const fetch = installFetch()
		const env = makeEnv({ RATE_LIMIT: "112:100:100:100" })
		try {
			const response = await worker.fetch(
				new Request("https://api.test/api/v1/users/me", {
					headers: { Authorization: "Bearer opaque-token", "cf-connecting-ip": "203.0.113.20" },
				}),
				env,
			)
			expect(response.status).toBe(401)
			expect(fetch.calls).toHaveLength(0)
		} finally {
			fetch.restore()
		}
	})

	it("rejects malformed exchange fields before the consume RPC", async () => {
		const fetch = installFetch()
		const env = makeEnv({ RATE_LIMIT: "106:100:100:100" })
		try {
			const response = await worker.fetch(
				exchangeRequest(
					"203.0.113.14",
					"application/json",
					JSON.stringify({
						code: "too-short",
						code_verifier: "b".repeat(43),
						redirect_uri: REDIRECT,
						client_id: "vscode",
						state: "c".repeat(32),
					}),
				),
				env,
			)
			expect(response.status).toBe(400)
			expect(fetch.calls).toHaveLength(0)
		} finally {
			fetch.restore()
		}
	})
})

describe("isolate and user limits", () => {
	it("allows a successful /users/me request inside the limit", async () => {
		const fetch = installFetch()
		const env = makeEnv({ RATE_LIMIT: "107:100:100:2" })
		try {
			const response = await worker.fetch(usersMeRequest("203.0.113.15"), env)
			expect(response.status).toBe(200)
			expect(fetch.calls.some((url) => url.includes("/rest/v1/profiles"))).toBe(true)
		} finally {
			fetch.restore()
		}
	})

	it("enforces the per-user /users/me isolate limit and skips later profile queries", async () => {
		const fetch = installFetch()
		const env = makeEnv({ RATE_LIMIT: "108:100:100:2" })
		try {
			const statuses = []
			for (let index = 0; index < 3; index++) {
				statuses.push((await worker.fetch(usersMeRequest("203.0.113.16"), env)).status)
			}
			expect(statuses).toEqual([200, 200, 429])
			expect(fetch.calls.filter((url) => url.includes("/rest/v1/profiles")).length).toBe(2)
		} finally {
			fetch.restore()
		}
	})

	it("enforces the per-IP exchange isolate limit and skips the second consume RPC", async () => {
		const fetch = installFetch({ rpcBody: [] })
		const env = makeEnv({ RATE_LIMIT: "109:1:100:100" })
		try {
			const first = await worker.fetch(
				exchangeRequest("203.0.113.17", "application/json", validExchangeBody()),
				env,
			)
			const second = await worker.fetch(
				exchangeRequest("203.0.113.17", "application/json", validExchangeBody()),
				env,
			)
			expect(first.status).toBe(400)
			expect(second.status).toBe(429)
			expect(Number(second.headers.get("Retry-After"))).toBeGreaterThan(0)
			expect(fetch.calls.filter((url) => url.includes("/rpc/consume_handoff_code")).length).toBe(1)
		} finally {
			fetch.restore()
		}
	})

	it("enforces the per-user handoff isolate limit before user lookup and insert", async () => {
		const fetch = installFetch()
		const env = makeEnv({ RATE_LIMIT: "110:100:2:100" })
		try {
			const statuses = []
			for (let index = 0; index < 3; index++) {
				statuses.push((await worker.fetch(handoffRequest("203.0.113.18"), env)).status)
			}
			expect(statuses).toEqual([200, 200, 429])
			expect(fetch.calls.filter((url) => url.includes("/auth/v1/user")).length).toBe(2)
			expect(fetch.calls.filter((url) => url.includes("/rest/v1/handoff_codes")).length).toBe(2)
		} finally {
			fetch.restore()
		}
	})
})
