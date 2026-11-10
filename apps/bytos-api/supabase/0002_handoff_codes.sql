-- Bytos API production migration.
-- Target: the approved Supabase PostgreSQL project.
-- The local Worker keeps using D1 (apps/bytos-api/migrations/0001_handoff_codes.sql);
-- production uses this table + SECURITY DEFINER RPC through PostgREST.

create table if not exists public.handoff_codes (
	id uuid primary key default gen_random_uuid(),
	code_hash text not null unique,
	user_id uuid not null references auth.users (id) on delete cascade,
	user_email text not null,
	session_id text,
	code_challenge text not null,
	code_challenge_method text not null default 'S256'
		check (code_challenge_method = 'S256'),
	redirect_uri text not null,
	client_id text not null,
	state_hash text not null,
	encrypted_access_token text not null,
	encrypted_refresh_token text not null,
	expires_at timestamptz not null,
	consumed_at timestamptz,
	created_at timestamptz not null default now()
);

create index if not exists handoff_codes_expires_at_idx on public.handoff_codes (expires_at);
create index if not exists handoff_codes_consumed_at_idx on public.handoff_codes (consumed_at);

alter table public.handoff_codes enable row level security;

-- Clients must never read this table. The Worker uses the service role, which
-- bypasses RLS; the SECURITY DEFINER RPC below is the only mutation path.
revoke all on table public.handoff_codes from anon;
revoke all on table public.handoff_codes from authenticated;
grant all on table public.handoff_codes to service_role;

create or replace function public.consume_handoff_code(
	p_code_hash text,
	p_code_challenge text,
	p_redirect_uri text,
	p_client_id text,
	p_state_hash text,
	p_now timestamptz default now()
)
returns table (
	encrypted_access_token text,
	encrypted_refresh_token text,
	user_id uuid,
	user_email text,
	session_id text
)
language sql
security definer
set search_path = ''
as $$
	with target as (
		select id, encrypted_access_token, encrypted_refresh_token,
		       user_id, user_email, session_id
		from public.handoff_codes
		where code_hash = p_code_hash
		  and consumed_at is null
		  and expires_at > p_now
		  and code_challenge = p_code_challenge
		  and redirect_uri = p_redirect_uri
		  and client_id = p_client_id
		  and state_hash = p_state_hash
		for update
	), consumed as (
		update public.handoff_codes
		set consumed_at = p_now,
		    encrypted_access_token = '',
		    encrypted_refresh_token = ''
		where id = (select id from target)
		  and consumed_at is null
		returning id
	)
	select target.encrypted_access_token, target.encrypted_refresh_token,
	       target.user_id, target.user_email, target.session_id
	from target
	join consumed on consumed.id = target.id;
$$;

revoke all on function public.consume_handoff_code(text, text, text, text, text, timestamptz) from public;
revoke all on function public.consume_handoff_code(text, text, text, text, text, timestamptz) from anon;
revoke all on function public.consume_handoff_code(text, text, text, text, text, timestamptz) from authenticated;
grant execute on function public.consume_handoff_code(text, text, text, text, text, timestamptz) to service_role;

comment on table public.handoff_codes is
	'Short-lived, single-use VS Code handoff codes. Encrypted Supabase credentials are cleared on consumption.';

comment on function public.consume_handoff_code(text, text, text, text, text, timestamptz) is
	'Atomically consumes a handoff code and returns the pre-consumption encrypted credentials.';
