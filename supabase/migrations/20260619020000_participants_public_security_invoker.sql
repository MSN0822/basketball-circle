-- Supabase Advisor: avoid SECURITY DEFINER views.
-- The app reads this sanitized participant surface from server code with
-- service_role, so browser roles do not need direct view access.
alter view public.participants_public set (security_invoker = true);

revoke all on public.participants_public from public;
revoke all on public.participants_public from anon;
revoke all on public.participants_public from authenticated;
grant select on public.participants_public to service_role;
