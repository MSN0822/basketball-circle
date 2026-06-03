-- Public read surface for event pages.
--
-- Do not expose participants.user_code to browser clients. Guest temporary IDs
-- are exposed as display_code only; legacy non-guest user_code values remain
-- private because they may be cancellation verification codes.
-- This view is intentionally definer-powered so anon users can read the
-- curated public columns without a direct participants SELECT policy.

drop view if exists public.participants_public;

create view public.participants_public with (security_invoker = false) as
select
  id,
  event_id,
  name,
  member_id,
  status,
  slot_number,
  created_at,
  case
    when user_code like 'guest:%:%' then split_part(user_code, ':', 3)
    else null
  end as display_code
from public.participants;

revoke all on public.participants_public from public;
grant select on public.participants_public to anon, authenticated;

drop policy if exists "members_select" on members;
drop policy if exists "members_select_authenticated" on members;
drop policy if exists "members_select_own" on members;
create policy "members_select_own" on members
  for select
  to authenticated
  using (auth.uid() = auth_user_id);

drop policy if exists "participants_select" on participants;
drop policy if exists "participants_select_authenticated" on participants;
