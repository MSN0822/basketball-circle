-- Atomic counter for general-purpose API rate limiting.
-- Same semantics as record_admin_login_failure, but with generic parameter names
-- so member-facing routes (join / cancel / register / rename) can share it.
--
-- The existing record_admin_login_failure function is intentionally kept for
-- backwards compatibility: admin login still calls it with its own argument names.

create or replace function public.record_rate_limit_hit(
  p_key text,
  p_window_ms integer,
  p_lock_ms integer,
  p_max_attempts integer
)
returns public.admin_login_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_window interval := p_window_ms * interval '1 millisecond';
  v_lock interval := p_lock_ms * interval '1 millisecond';
  v_row public.admin_login_attempts%rowtype;
begin
  if nullif(trim(p_key), '') is null then
    raise exception 'p_key is required';
  end if;

  insert into public.admin_login_attempts as attempts (key, count, reset_at, locked_until)
  values (p_key, 1, v_now + v_window, null)
  on conflict (key) do update
    set
      count = case
        when attempts.locked_until is not null and attempts.locked_until > v_now then attempts.count
        when attempts.reset_at <= v_now then 1
        else attempts.count + 1
      end,
      reset_at = case
        when attempts.locked_until is not null and attempts.locked_until > v_now then attempts.reset_at
        when attempts.reset_at <= v_now then v_now + v_window
        else attempts.reset_at
      end,
      locked_until = case
        when attempts.locked_until is not null and attempts.locked_until > v_now then attempts.locked_until
        when (
          case
            when attempts.reset_at <= v_now then 1
            else attempts.count + 1
          end
        ) >= p_max_attempts then v_now + v_lock
        else attempts.locked_until
      end
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.record_rate_limit_hit(text, integer, integer, integer) from public;
revoke execute on function public.record_rate_limit_hit(text, integer, integer, integer) from anon, authenticated;
grant execute on function public.record_rate_limit_hit(text, integer, integer, integer) to service_role;

comment on table public.admin_login_attempts is
  'Shared rate-limit counter. Originally admin login only; also used by member-facing API limits since 2026-07-21 (see lib/rate-limit.ts).';
