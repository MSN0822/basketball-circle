-- Apply this only after SUPABASE_SERVICE_ROLE_KEY is configured in Vercel.
-- Participant/member mutations should go through API routes using the service role key.

-- baseline_schema.sql が既に *_update_none を作成済みのため、旧名に加えて
-- _none 名も drop してから再作成する（CLI 再生時の "policy already exists" を回避）。
drop policy if exists "participants_update" on participants;
drop policy if exists "participants_update_none" on participants;
create policy "participants_update_none" on participants
  for update using (false) with check (false);

drop policy if exists "members_update" on members;
drop policy if exists "members_update_none" on members;
create policy "members_update_none" on members
  for update using (false) with check (false);
