-- Keep all draft events out of member-facing browser-readable surfaces.
-- Admins can still manage drafts through service-role-backed admin APIs.

drop policy if exists "events_select" on public.events;
create policy "events_select" on public.events
  for select
  to authenticated
  using (status <> 'draft');

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
where e.status <> 'draft';

revoke all on public.participants_public from public;
revoke all on public.participants_public from anon;
grant select on public.participants_public to authenticated;
