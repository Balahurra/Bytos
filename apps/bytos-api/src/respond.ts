const DEFAULT_ALLOWED_ORIGINS = [
	"https://bytos.dev",
	"https://staging-app.bytos.dev",
	"http://localhost:3000",
	"http://127.0.0.1:3000",
	"http://localhost:8000",
	"http://127.0.0.1:8000",
	"http://localhost:5500",
	"http://127.0.0.1:5500",
]

export function allowedOrigin(request: Request, configured?: string): string | null {
	const origin = request.headers.get("Origin")
	if (!origin) return null
	const allowed = configured
		? configured
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean)
		: DEFAULT_ALLOWED_ORIGINS
	return allowed.includes(origin) ? origin : null
}

function headers(origin: string | null, contentType = "application/json"): Headers {
	const result = new Headers({
		"Content-Type": contentType,
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
	})
	if (origin) {
		result.set("Access-Control-Allow-Origin", origin)
		result.set("Vary", "Origin")
	}
	return result
}

export function jsonResponse(
	body: unknown,
	status: number,
	origin: string | null,
	extraHeaders?: Record<string, string>,
): Response {
	const result = new Response(JSON.stringify(body), { status, headers: headers(origin) })
	for (const [key, value] of Object.entries(extraHeaders ?? {})) result.headers.set(key, value)
	return result
}

export function errorResponse(
	code: string,
	message: string,
	status: number,
	origin: string | null,
	extraHeaders?: Record<string, string>,
): Response {
	return jsonResponse({ success: false, code, error: message }, status, origin, extraHeaders)
}

export function preflightResponse(origin: string | null): Response {
	const result = new Response(null, { status: 204, headers: headers(origin) })
	result.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	result.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	result.headers.set("Access-Control-Max-Age", "86400")
	return result
}
