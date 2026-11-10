-- Local D1 schema for the local-only bytos-api Worker.
-- Production is designed to use Supabase PostgreSQL (see supabase/0002_handoff_codes.sql).

CREATE TABLE IF NOT EXISTS handoff_codes (
	id TEXT PRIMARY KEY,
	code_hash TEXT NOT NULL UNIQUE,
	user_id TEXT NOT NULL,
	user_email TEXT NOT NULL,
	session_id TEXT,
	code_challenge TEXT NOT NULL,
	code_challenge_method TEXT NOT NULL DEFAULT 'S256',
	redirect_uri TEXT NOT NULL,
	client_id TEXT NOT NULL,
	state_hash TEXT NOT NULL,
	encrypted_access_token TEXT NOT NULL,
	encrypted_refresh_token TEXT NOT NULL,
	expires_at INTEGER NOT NULL,
	consumed_at INTEGER,
	created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS handoff_codes_expires_at_idx ON handoff_codes (expires_at);
CREATE INDEX IF NOT EXISTS handoff_codes_consumed_at_idx ON handoff_codes (consumed_at);
