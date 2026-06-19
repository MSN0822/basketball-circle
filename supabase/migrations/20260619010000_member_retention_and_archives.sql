-- Member lifecycle and event archives.
-- - Require pages to track member access via members.last_accessed_at.
-- - Allow ended events to move to an admin-only archived state.
-- - Reuse the smallest available member number when dormant members are removed.

alter table public.events
  drop constraint if exists events_status_check;

alter table public.events
  add constraint events_status_check
  check (status in ('accepting', 'closed', 'draft', 'archived'));

alter table public.members
  add column if not exists last_accessed_at timestamptz not null default now();

create unique index if not exists members_auth_user_id_uq
  on public.members(auth_user_id)
  where auth_user_id is not null;

drop policy if exists "events_select" on public.events;
create policy "events_select" on public.events
  for select
  to authenticated
  using (status in ('accepting', 'closed'));

drop view if exists public.participants_public;
create view public.participants_public with (security_invoker = false) as
select
  p.id,
  p.event_id,
  p.name,
  p.status,
  p.slot_number,
  p.created_at,
  case
    when p.user_code like 'guest:%:%' then split_part(p.user_code, ':', 3)
    else null
  end as display_code
from public.participants p
join public.events e on e.id = p.event_id
where e.status in ('accepting', 'closed');

revoke all on public.participants_public from public;
revoke all on public.participants_public from anon;
grant select on public.participants_public to authenticated;

create or replace function public.register_member(
  p_name text,
  p_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_number text;
  v_member members%rowtype;
begin
  if nullif(trim(p_name), '') is null or p_auth_user_id is null then
    return jsonb_build_object('error', 'name and auth_user_id are required', 'status', 400);
  end if;

  select *
    into v_member
    from members
   where auth_user_id = p_auth_user_id;

  if found then
    update members
       set last_accessed_at = now()
     where id = v_member.id
     returning * into v_member;

    return jsonb_build_object('member', row_to_json(v_member));
  end if;

  perform pg_advisory_xact_lock(hashtext('register_member_number'));

  with used_numbers as (
    select member_number::int as n
      from members
     where member_number ~ '^[0-9]+$'
       and member_number::int > 0
  ),
  candidate_numbers as (
    select generate_series(
      1,
      greatest(coalesce((select max(n) from used_numbers), 0) + 1, 1)
    ) as n
  )
  select lpad(min(c.n)::text, 3, '0')
    into v_member_number
    from candidate_numbers c
   where not exists (
     select 1 from used_numbers u where u.n = c.n
   );

  insert into members (name, member_number, auth_user_id, last_accessed_at)
  values (trim(p_name), v_member_number, p_auth_user_id, now())
  returning * into v_member;

  return jsonb_build_object('member', row_to_json(v_member));
exception
  when unique_violation then
    return jsonb_build_object('error', 'member registration conflicted', 'status', 409);
end;
$$;

revoke all on function public.register_member(text, uuid) from public;
revoke execute on function public.register_member(text, uuid) from anon, authenticated;
grant execute on function public.register_member(text, uuid) to service_role;
