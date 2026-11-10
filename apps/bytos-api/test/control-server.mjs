import http from "node:http"

const PORT = Number(process.env.CONTROL_PORT ?? 8000)
const MOCK = process.env.MOCK_URL ?? "http://127.0.0.1:54321"
const WORKER = process.env.WORKER_URL ?? "http://127.0.0.1:8788"
const REDIRECT = "vscode://bytos.bytos/auth/callback"
const CLIENT_ID = "vscode"

let lastCallback = null

const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>Bytos handoff test</title></head>
<body><p>Preparing VS Code handoff… You can close this tab.</p></body></html>`

const server = http.createServer((req, res) => {
	const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`)
	if (url.pathname === "/signup" || url.pathname === "/signin") {
		const state = url.searchParams.get("state")
		const challenge = url.searchParams.get("code_challenge")
		const redirect = url.searchParams.get("redirect_uri") ?? REDIRECT
		if (!state || !challenge) {
			res.writeHead(400, { "content-type": "text/plain" })
			res.end("missing handoff parameters")
			return
		}
		void (async () => {
			try {
				const token = (await (await fetch(`${MOCK}/test/token`)).json()).token
				const response = await fetch(`${WORKER}/api/v1/auth/handoff/code`, {
					method: "POST",
					headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
					body: JSON.stringify({
						code_challenge: challenge,
						code_challenge_method: "S256",
						state,
						redirect_uri: redirect,
						client_id: CLIENT_ID,
						refresh_token: "refresh-token-e2e",
					}),
				})
				const payload = await response.json()
				if (!response.ok || !payload.code) throw new Error(payload.error || "handoff failed")
				const target = new URL(redirect)
				target.searchParams.set("code", payload.code)
				target.searchParams.set("state", state)
				lastCallback = target.toString()
				console.log("CALLBACK_READY", lastCallback)
			} catch (error) {
				console.error("HANDOFF_ERROR", error instanceof Error ? error.message : error)
			}
		})()
		res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
		res.end(page)
		return
	}
	if (url.pathname === "/last") {
		res.writeHead(200, { "content-type": "application/json" })
		res.end(JSON.stringify({ url: lastCallback }))
		return
	}
	res.writeHead(404, { "content-type": "text/plain" })
	res.end("not found")
})

server.listen(PORT, "127.0.0.1", () => {
	console.log("CONTROL_READY", PORT)
})
