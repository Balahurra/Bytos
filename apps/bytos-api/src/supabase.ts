import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose"

export interface SupabaseEnv {
	SUPABASE_URL: string
	SUPABASE_ANON_KEY: string
	SUPABASE_JWKS_URL?: string
	SUPABASE_USERINFO_URL?: string
}

export interface SupabaseUser {
	id: string
	email?: string
	email_confirmed_at?: string | null
	confirmed_at?: string | null
	user_metadata?: Record<string, unknown>
	identities?: Array<{ provider?: string }>
}

export interface ProfileRow {
	id: string
	email: string | null
	first_name: string | null
	last_name: string | null
	username: string | null
	created_at: string
	updated_at: string
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function baseUrl(env: SupabaseEnv): string {
	return env.SUPABASE_URL.replace(/\/+$/, "")
}

function jwks(env: SupabaseEnv) {
	const url = env.SUPABASE_JWKS_URL?.trim() || `${baseUrl(env)}/auth/v1/.well-known/jwks.json`
	let cached = jwksCache.get(url)
	if (!cached) {
		cached = createRemoteJWKSet(new URL(url))
		jwksCache.set(url, cached)
	}
	return cached
}

export async function verifySupabaseJwt(token: string, env: SupabaseEnv): Promise<JWTPayload> {
	const { payload } = await jwtVerify(token, jwks(env), {
		issuer: `${baseUrl(env)}/auth/v1`,
		audience: "authenticated",
		algorithms: ["ES256"],
		clockTolerance: 60,
	})
	if (payload.role !== "authenticated") {
		throw new Error("Supabase token role is not authenticated")
	}
	if (typeof payload.sub !== "string" || payload.sub.length === 0) {
		throw new Error("Supabase token is missing a subject")
	}
	return payload
}

export async function fetchSupabaseUser(token: string, env: SupabaseEnv): Promise<SupabaseUser> {
	const url = env.SUPABASE_USERINFO_URL?.trim() || `${baseUrl(env)}/auth/v1/user`
	const response = await fetch(url, {
		headers: {
			apikey: env.SUPABASE_ANON_KEY,
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
		},
	})
	if (!response.ok) {
		throw new Error(`Supabase user lookup failed with status ${response.status}`)
	}
	return (await response.json()) as SupabaseUser
}

export function isVerifiedUser(user: SupabaseUser): boolean {
	if (user.email_confirmed_at || user.confirmed_at) return true
	// OAuth identities are verified by the provider; a password-only identity is not.
	return (user.identities ?? []).some((identity) => identity.provider && identity.provider !== "email")
}

export async function fetchProfile(token: string, userId: string, env: SupabaseEnv): Promise<ProfileRow | null> {
	const query = new URLSearchParams({
		id: `eq.${userId}`,
		select: "id,email,first_name,last_name,username,created_at,updated_at",
		limit: "1",
	})
	const response = await fetch(`${baseUrl(env)}/rest/v1/profiles?${query.toString()}`, {
		headers: {
			apikey: env.SUPABASE_ANON_KEY,
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
		},
	})
	if (!response.ok) {
		throw new Error(`Supabase profile lookup failed with status ${response.status}`)
	}
	const rows = (await response.json()) as ProfileRow[]
	return rows[0] ?? null
}
