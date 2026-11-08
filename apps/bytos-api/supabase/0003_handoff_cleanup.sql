-- Bytos API production retention cleanup.
-- Target: the approved Supabase PostgreSQL project.
--
-- Prepared only. Do not apply automatically; the production Worker cron calls
-- the RPC below through its service-role connection.
--
-- Deletes at most p_batch_size rows per invocation:
--   * rows whose expiry passed before p_expired_before, or
--   * consumed rows whose tombstone retention passed before p_consumed_before.
-- Active rows (future expiry, not consumed) never match.

create or replace function public.cleanup_handoff_codes(
	p_expired_before timestamptz,
	p_consumed_before timestamptz,
	p_batch_size integer default 500
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
	deleted_count integer;
begin
	if p_batch_size is null or p_batch_size < 1 or p_batch_size > 5000 then
		raise exception 'p_batch_size must be between 1 and 5000'
			using errcode = '22023';
	end if;

	with victims as (
		select id
		from public.handoff_codes
		where expires_at <= p_expired_before
		   or (consumed_at is not null and consumed_at <= p_consumed_before)
		order by expires_at
		limit p_batch_size
		for update skip locked
	)
	delete from public.handoff_codes as h
	using victims
	where h.id = victims.id;

	get diagnostics deleted_count = row_count;
	return deleted_count;
end;
$$;

revoke all on function public.cleanup_handoff_codes(timestamptz, timestamptz, integer) from public;
revoke all on function public.cleanup_handoff_codes(timestamptz, timestamptz, integer) from anon;
revoke all on function public.cleanup_handoff_codes(timestamptz, timestamptz, integer) from authenticated;
grant execute on function public.cleanup_handoff_codes(timestamptz, timestamptz, integer) to service_role;

comment on function public.cleanup_handoff_codes(timestamptz, timestamptz, integer) is
	'Deletes a bounded batch of expired or consumed handoff codes. service_role only.';
