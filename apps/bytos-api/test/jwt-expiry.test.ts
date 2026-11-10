import { describe, expect, it } from "bun:test"
import { jwtRemainingSeconds } from "../src/crypto"

function b64url(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url")
}

function makeJwt(payload: Record<string, unknown>): string {
	return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.signature`
}

describe("jwtRemainingSeconds", () => {
	it("returns the remaining lifetime from the exp claim", () => {
		const nowMs = 1_700_000_000_000
		const exp = Math.floor(nowMs / 1000) + 900
		expect(jwtRemainingSeconds(makeJwt({ exp }), nowMs)).toBe(900)
	})

	it("never reports the fabricated one-hour constant", () => {
		const nowMs = 1_700_000_000_000
		const exp = Math.floor(nowMs / 1000) + 42
		expect(jwtRemainingSeconds(makeJwt({ exp }), nowMs)).toBe(42)
	})

	it("returns null for an already-expired token", () => {
		const nowMs = 1_700_000_000_000
		const exp = Math.floor(nowMs / 1000) - 1
		expect(jwtRemainingSeconds(makeJwt({ exp }), nowMs)).toBeNull()
	})

	it("returns null when the token has no exp claim", () => {
		expect(jwtRemainingSeconds(makeJwt({ sub: "user-1" }))).toBeNull()
	})

	it("returns null when exp is not a number", () => {
		expect(jwtRemainingSeconds(makeJwt({ exp: "soon" }))).toBeNull()
	})

	it("returns null for something that is not a JWT", () => {
		expect(jwtRemainingSeconds("opaque-token")).toBeNull()
		expect(jwtRemainingSeconds("a.b")).toBeNull()
		expect(jwtRemainingSeconds("a.%%%.c")).toBeNull()
	})
})
