const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function base64UrlEncode(bytes: Uint8Array): string {
	let binary = ""
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function base64UrlDecode(value: string): Uint8Array {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
	const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
	const binary = atob(padded)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes
}

export function base64Decode(value: string): Uint8Array {
	if (value.includes("-") || value.includes("_")) return base64UrlDecode(value)
	const binary = atob(value)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return bytes
}
/**
 * Remaining lifetime, in seconds, of a JWT access token, read from its `exp`
 * claim. Returns `null` when the token is not a JWT, has no numeric `exp`, or is
 * already expired — callers must then refuse the exchange rather than invent a
 * lifetime.
 */
export function jwtRemainingSeconds(token: string, nowMs: number = Date.now()): number | null {
	const parts = token.split(".")
	if (parts.length !== 3) return null
	let payload: unknown
	try {
		payload = JSON.parse(decoder.decode(base64UrlDecode(parts[1] as string)))
	} catch {
		return null
	}
	if (!payload || typeof payload !== "object") return null
	const exp = (payload as Record<string, unknown>).exp
	if (typeof exp !== "number" || !Number.isFinite(exp)) return null
	const remaining = Math.floor(exp - nowMs / 1000)
	return remaining > 0 ? remaining : null
}



export function randomToken(byteLength = 32): string {
	const bytes = new Uint8Array(byteLength)
	crypto.getRandomValues(bytes)
	return base64UrlEncode(bytes)
}

export async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value))
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")
}

export async function sha256Base64Url(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value))
	return base64UrlEncode(new Uint8Array(digest))
}

async function importEncryptionKey(encodedKey: string): Promise<CryptoKey> {
	const raw = base64Decode(encodedKey)
	if (raw.byteLength !== 32) {
		throw new Error("HANDOFF_ENCRYPTION_KEY must be a base64 32-byte key")
	}
	return crypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
}

function associatedData(aad: string): Uint8Array {
	return encoder.encode(aad)
}

/** Returns `iv.ciphertext` (both base64url). */
export async function encryptHandoffValue(value: string, keyMaterial: string, aad: string): Promise<string> {
	const key = await importEncryptionKey(keyMaterial)
	const iv = new Uint8Array(12)
	crypto.getRandomValues(iv)
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv: iv as BufferSource, additionalData: associatedData(aad) as BufferSource },
		key,
		encoder.encode(value),
	)
	return `${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ciphertext))}`
}

export async function decryptHandoffValue(payload: string, keyMaterial: string, aad: string): Promise<string> {
	const [ivPart, ciphertextPart] = payload.split(".")
	if (!ivPart || !ciphertextPart) throw new Error("Invalid encrypted value")
	const key = await importEncryptionKey(keyMaterial)
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: base64UrlDecode(ivPart) as BufferSource, additionalData: associatedData(aad) as BufferSource },
		key,
		base64UrlDecode(ciphertextPart) as BufferSource,
	)
	return decoder.decode(plaintext)
}


