import http from "node:http"
import { randomBytes, randomUUID } from "node:crypto"
import { exportJWK, generateKeyPair, SignJWT } from "jose"

const PORT = Number(process.env.MOCK_PORT ?? 54321)
const ISSUER = `http://127.0.0.1:${PORT}/auth/v1`
const USER_ID = randomUUID()
const EMAIL = "e2e@example.com"
const SESSION_ID = randomUUID()

const { publicKey, privateKey } = await generateKeyPair("ES256")
const jwk = await exportJWK(publicKey)
jwk.kid = "e2e-key"
jwk.alg = "ES256"
jwk.use = "sig"

const token = await new SignJWT({ role: "authenticated", email: EMAIL, session_id: SESSION_ID })
	.setProtectedHeader({ alg: "ES256", kid: jwk.kid, typ: "JWT" })
	.setIssuer(ISSUER)
	.setAudience("authenticated")
	.setSubject(USER_ID)
	.setIssuedAt()
	.setExpirationTime("1h")
	.sign(privateKey)

const user = {
	id: USER_ID,
	email: EMAIL,
	email_confirmed_at: new Date().toISOString(),
	confirmed_at: new Date().toISOString(),
	identities: [{ provider: "email" }],
}

const server = http.createServer((req, res) => {
	const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`)
	const send = (status, body) => {
		res.writeHead(status, { "content-type": "application/json" })
		res.end(JSON.stringify(body))
	}
	if (url.pathname === "/test/token") return send(200, { token, userId: USER_ID, email: EMAIL, sessionId: SESSION_ID })
	if (url.pathname === "/auth/v1/.well-known/jwks.json") return send(200, { keys: [jwk] })
	if (url.pathname === "/auth/v1/user") {
		if ((req.headers.authorization ?? "") !== `Bearer ${token}`) return send(401, { error: "invalid_token" })
		return send(200, user)
	}
	if (url.pathname === "/rest/v1/profiles") {
		if ((req.headers.authorization ?? "") !== `Bearer ${token}`) return send(401, { message: "permission denied" })
		return send(200, [
			{
				id: USER_ID,
				email: EMAIL,
				first_name: "E2E",
				last_name: "User",
				username: "e2euser",
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
			},
		])
	}
	return send(404, { error: "not_found" })
})

server.listen(PORT, "127.0.0.1", () => {
	console.log("MOCK_READY", PORT)
})
