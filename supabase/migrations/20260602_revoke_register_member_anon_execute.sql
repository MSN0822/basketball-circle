-- This blocks unauthenticated clients from calling register_member directly with
-- arbitrary auth_user_id values. The signup flow is expected to continue through
-- app/api/members, which verifies the bearer user before the server calls this RPC.
revoke execute on function public.register_member(text, uuid) from anon;
grant execute on function public.register_member(text, uuid) to authenticated;
