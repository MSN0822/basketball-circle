-- This blocks unauthenticated clients from calling register_member directly with
-- arbitrary auth_user_id values. The signup flow is expected to continue through
-- app/api/members, which verifies the bearer user before the server calls this
-- RPC with the service role.
revoke execute on function public.register_member(text, uuid) from anon;
revoke execute on function public.register_member(text, uuid) from authenticated;
grant execute on function public.register_member(text, uuid) to service_role;
