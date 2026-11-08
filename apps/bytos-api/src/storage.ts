export interface HandoffRecord {
	id: string
	codeHash: string
	userId: string
	userEmail: string
	sessionId: string | null
	codeChallenge: string
	codeChallengeMethod: string
	redirectUri: string
	clientId: string
	stateHash: string
	encryptedAccessToken: string
	encryptedRefreshToken: string
	expiresAt: number
	createdAt: number
}

export interface ConsumeHandoffInput {
	codeHash: string
	codeChallenge: string
	redirectUri: string
	clientId: string
	stateHash: string
	now: number
}

export interface ConsumedHandoff {
	encrypted_access_token: string
	encrypted_refresh_token: string
	user_id: string
	user_email: string
	session_id: string | null
}

export interface StorageEnv {
	DB?: D1Database
	STORAGE_DRIVER?: string
	SUPABASE_URL: string
	SUPABASE_SERVICE_ROLE_KEY?: string
}

export interface HandoffStore {
	insert(record: HandoffRecord): Promise<void>
	consume(input: ConsumeHandoffInput): Promise<ConsumedHandoff | null>
	clearTokens(codeHash: string): Promise<void>
}

function baseUrl(env: StorageEnv): string {
	return env.SUPABASE_URL.replace(/\/+$/, "")
}

class D1HandoffStore implements HandoffStore {
	constructor(private readonly db: D1Database) {}

	async insert(record: HandoffRecord): Promise<void> {
		await this.db
			.prepare(
				`INSERT INTO handoff_codes
					(id, code_hash, user_id, user_email, session_id, code_challenge, code_challenge_method,
					 redirect_uri, client_id, state_hash, encrypted_access_token, encrypted_refresh_token,
					 expires_at, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				record.id,
				record.codeHash,
				record.userId,
				record.userEmail,
				record.sessionId,
				record.codeChallenge,
				record.codeChallengeMethod,
				record.redirectUri,
				record.clientId,
				record.stateHash,
				record.encryptedAccessToken,
				record.encryptedRefreshToken,
				record.expiresAt,
				record.createdAt,
			)
			.run()
	}

	async consume(input: ConsumeHandoffInput): Promise<ConsumedHandoff | null> {
		const row = await this.db
			.prepare(
				`UPDATE handoff_codes
				 SET consumed_at = ?
				 WHERE code_hash = ?
				   AND consumed_at IS NULL
				   AND expires_at > ?
				   AND code_challenge = ?
				   AND redirect_uri = ?
				   AND client_id = ?
				   AND state_hash = ?
				 RETURNING encrypted_access_token, encrypted_refresh_token, user_id, user_email, session_id`,
			)
			.bind(
				input.now,
				input.codeHash,
				input.now,
				input.codeChallenge,
				input.redirectUri,
				input.clientId,
				input.stateHash,
			)
			.first<ConsumedHandoff>()
		return row ?? null
	}

	async clearTokens(codeHash: string): Promise<void> {
		await this.db
			.prepare(
				"UPDATE handoff_codes SET encrypted_access_token = '', encrypted_refresh_token = '' WHERE code_hash = ?",
			)
			.bind(codeHash)
			.run()
	}
}

class SupabaseHandoffStore implements HandoffStore {
	constructor(private readonly env: StorageEnv) {
		if (!env.SUPABASE_SERVICE_ROLE_KEY) {
			throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for the Supabase storage driver")
		}
	}

	private headers(): HeadersInit {
		const key = this.env.SUPABASE_SERVICE_ROLE_KEY as string
		return {
			apikey: key,
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
			Accept: "application/json",
		}
	}

	async insert(record: HandoffRecord): Promise<void> {
		const response = await fetch(`${baseUrl(this.env)}/rest/v1/handoff_codes`, {
			method: "POST",
			headers: { ...this.headers(), Prefer: "return=minimal" },
			body: JSON.stringify({
				id: record.id,
				code_hash: record.codeHash,
				user_id: record.userId,
				user_email: record.userEmail,
				session_id: record.sessionId,
				code_challenge: record.codeChallenge,
				code_challenge_method: record.codeChallengeMethod,
				redirect_uri: record.redirectUri,
				client_id: record.clientId,
				state_hash: record.stateHash,
				encrypted_access_token: record.encryptedAccessToken,
				encrypted_refresh_token: record.encryptedRefreshToken,
				expires_at: new Date(record.expiresAt).toISOString(),
				created_at: new Date(record.createdAt).toISOString(),
			}),
		})
		if (!response.ok) {
			throw new Error(`Supabase handoff insert failed with status ${response.status}`)
		}
	}

	async consume(input: ConsumeHandoffInput): Promise<ConsumedHandoff | null> {
		const response = await fetch(`${baseUrl(this.env)}/rest/v1/rpc/consume_handoff_code`, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify({
				p_code_hash: input.codeHash,
				p_code_challenge: input.codeChallenge,
				p_redirect_uri: input.redirectUri,
				p_client_id: input.clientId,
				p_state_hash: input.stateHash,
				p_now: new Date(input.now).toISOString(),
			}),
		})
		if (!response.ok) {
			throw new Error(`Supabase handoff consume failed with status ${response.status}`)
		}
		const rows = (await response.json()) as ConsumedHandoff[] | ConsumedHandoff | null
		if (!rows) return null
		return Array.isArray(rows) ? (rows[0] ?? null) : rows
	}

	async clearTokens(codeHash: string): Promise<void> {
		const query = new URLSearchParams({ code_hash: `eq.${codeHash}` })
		const response = await fetch(`${baseUrl(this.env)}/rest/v1/handoff_codes?${query.toString()}`, {
			method: "PATCH",
			headers: { ...this.headers(), Prefer: "return=minimal" },
			body: JSON.stringify({ encrypted_access_token: "", encrypted_refresh_token: "" }),
		})
		if (!response.ok) {
			throw new Error(`Supabase handoff cleanup failed with status ${response.status}`)
		}
	}
}

export function createHandoffStore(env: StorageEnv): HandoffStore {
	const driver = env.STORAGE_DRIVER?.trim().toLowerCase()
	if (driver === "supabase" || (!driver && env.SUPABASE_SERVICE_ROLE_KEY)) {
		return new SupabaseHandoffStore(env)
	}
	if (env.DB) return new D1HandoffStore(env.DB)
	throw new Error("No handoff storage driver configured (set STORAGE_DRIVER and DB or Supabase keys)")
}
