-- Apply this only after SUPABASE_SERVICE_ROLE_KEY is configured in Vercel.
-- Participant/member mutations should go through API routes using the service role key.

drop policy if exists "participants_update" on participants;
create policy "participants_update_none" on participants
  for update using (false) with check (false);

drop policy if exists "members_update" on members;
create policy "members_update_none" on members
  for update using (false) with check (false);
