-- Restrict private mutations and member/participant reads to authenticated paths.
-- Browser and server UI flows should use Next.js API routes, which call these RPCs
-- with the service role key after app-level authorization checks.

revoke all on function public.join_event(uuid, text, text, uuid, boolean) from public;
revoke execute on function public.join_event(uuid, text, text, uuid, boolean) from anon, authenticated;
grant execute on function public.join_event(uuid, text, text, uuid, boolean) to service_role;

revoke all on function public.cancel_participant(uuid) from public;
revoke execute on function public.cancel_participant(uuid) from anon, authenticated;
grant execute on function public.cancel_participant(uuid) to service_role;

revoke all on function public.update_member_name(uuid, uuid, text) from public;
revoke execute on function public.update_member_name(uuid, uuid, text) from anon, authenticated;
grant execute on function public.update_member_name(uuid, uuid, text) to service_role;

revoke all on function public.register_member(text, uuid) from public;
revoke execute on function public.register_member(text, uuid) from anon, authenticated;
grant execute on function public.register_member(text, uuid) to service_role;

drop policy if exists "members_select" on members;
drop policy if exists "members_select_authenticated" on members;
create policy "members_select_authenticated" on members
  for select
  to authenticated
  using (true);

drop policy if exists "participants_select" on participants;
drop policy if exists "participants_select_authenticated" on participants;
create policy "participants_select_authenticated" on participants
  for select
  to authenticated
  using (true);
