-- Restore scheduled publishing for member-facing surfaces.
-- Drafts remain hidden until publishes_at is due; then member-facing reads can
-- see the event while admin APIs continue to manage the canonical draft row.

drop policy if exists "events_select" on public.events;
create policy "events_select" on public.events
  for select
  to authenticated
  using (status <> 'draft' or publishes_at <= now());

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
where e.status <> 'draft' or e.publishes_at <= now();

revoke all on public.participants_public from public;
revoke all on public.participants_public from anon;
grant select on public.participants_public to authenticated;
