-- Public clients may read the application data, but all mutations should go
-- through Next.js API routes using the service role key.

drop policy if exists "events_insert" on events;
drop policy if exists "events_update" on events;
drop policy if exists "events_delete" on events;
drop policy if exists "events_insert_none" on events;
drop policy if exists "events_update_none" on events;
drop policy if exists "events_delete_none" on events;

create policy "events_insert_none" on events
  for insert with check (false);
create policy "events_update_none" on events
  for update using (false) with check (false);
create policy "events_delete_none" on events
  for delete using (false);

drop policy if exists "members_insert" on members;
drop policy if exists "members_update" on members;
drop policy if exists "members_update_none" on members;
drop policy if exists "members_delete_none" on members;
drop policy if exists "members_insert_none" on members;

create policy "members_insert_none" on members
  for insert with check (false);
create policy "members_update_none" on members
  for update using (false) with check (false);
create policy "members_delete_none" on members
  for delete using (false);

drop policy if exists "participants_insert" on participants;
drop policy if exists "participants_update" on participants;
drop policy if exists "participants_update_none" on participants;
drop policy if exists "participants_delete_none" on participants;
drop policy if exists "participants_insert_none" on participants;

create policy "participants_insert_none" on participants
  for insert with check (false);
create policy "participants_update_none" on participants
  for update using (false) with check (false);
create policy "participants_delete_none" on participants
  for delete using (false);
