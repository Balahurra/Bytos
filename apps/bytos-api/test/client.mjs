import { randomBytes } from "node:crypto"

const MOCK = process.env.MOCK_URL ?? "http://127.0.0.1:54321"
const WORKER = process.env.WORKER_URL ?? "http://127.0.0.1:8788"
const REDIRECT = "vscode://bytos.bytos/auth/callback"
const CLIENT_ID = "vscode"

function assert(condition, message) {
	if (!condition) throw new Error(message)
}

function verifier() {
	return randomBytes(64).toString("base64url")
}

async function challenge(value) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
	return Buffer.from(digest).toString("base64url")
}

function state() {
	return randomBytes(32).toString("base64url")
}

async function issue(token, v, st) {
	const response = await fetch(`${WORKER}/api/v1/auth/handoff/code`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
		body: JSON.stringify({
			code_challenge: await challenge(v),
			code_challenge_method: "S256",
			state: st,
			redirect_uri: REDIRECT,
			client_id: CLIENT_ID,
			refresh_token: "refresh-token-e2e",
		}),
	})
	const body = await response.json().catch(() => ({}))
	assert(response.status === 200 && typeof body.code === "string", `issue failed: ${response.status} ${JSON.stringify(body)}`)
	return body.code
}

async function exchange(code, v, st) {
	const response = await fetch(`${WORKER}/api/v1/auth/exchange`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ code, code_verifier: v, redirect_uri: REDIRECT, client_id: CLIENT_ID, state: st }),
	})
	const body = await response.json().catch(() => ({}))
	return { status: response.status, body }
}

try {
	const test = await (await fetch(`${MOCK}/test/token`)).json()
	const v = verifier()
	const st = state()
	const code = await issue(test.token, v, st)

	const first = await exchange(code, v, st)
	assert(first.status === 200, `exchange failed: ${first.status} ${JSON.stringify(first.body)}`)
	assert(first.body.access_token === test.token, "access token mismatch")
	assert(first.body.refresh_token === "refresh-token-e2e", "refresh token mismatch")
	assert(first.body.user?.id === test.userId, "user id mismatch")

	const replay = await exchange(code, v, st)
	assert(replay.status === 400, `replay should be 400, got ${replay.status}`)

	const v2 = verifier()
	const st2 = state()
	const code2 = await issue(test.token, v2, st2)
	const wrong = await exchange(code2, verifier(), st2)
	assert(wrong.status === 400, `wrong verifier should be 400, got ${wrong.status}`)

	const me = await fetch(`${WORKER}/api/v1/users/me`, { headers: { authorization: `Bearer ${test.token}` } })
	const meBody = await me.json()
	assert(me.status === 200 && meBody.data?.id === test.userId, `users/me failed: ${me.status} ${JSON.stringify(meBody)}`)

	// Two concurrent redemptions of the same code: exactly one may succeed.
	const v3 = verifier()
	const st3 = state()
	const code3 = await issue(test.token, v3, st3)
	const concurrent = await Promise.all([exchange(code3, v3, st3), exchange(code3, v3, st3)])
	const statuses = concurrent.map((result) => result.status).sort()
	assert(statuses[0] === 200 && statuses[1] === 400, `concurrent redemption must be 200/400, got ${statuses.join("/")}`)

	// State is bound to the code.
	const v4 = verifier()
	const st4 = state()
	const code4 = await issue(test.token, v4, st4)
	const wrongState = await exchange(code4, v4, state())
	assert(wrongState.status === 400, `wrong state should be 400, got ${wrongState.status}`)

	// CORS: allowed origin echoes, unknown origin does not.
	const allowed = await fetch(`${WORKER}/health`, { headers: { Origin: "https://bytos.dev" } })
	assert(allowed.headers.get("access-control-allow-origin") === "https://bytos.dev", "allowed CORS origin missing")
	const denied = await fetch(`${WORKER}/health`, { headers: { Origin: "https://evil.example" } })
	assert(denied.headers.get("access-control-allow-origin") === null, "unknown CORS origin must not be echoed")

	console.log("PASS: issue, exchange, replay rejection, wrong-verifier rejection, users/me, concurrent redemption, state binding, CORS")
} catch (error) {
	console.error("FAIL:", error instanceof Error ? error.message : error)
	process.exit(1)
}
