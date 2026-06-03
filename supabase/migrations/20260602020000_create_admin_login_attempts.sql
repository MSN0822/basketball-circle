create table if not exists public.admin_login_attempts (
  key text primary key,
  count integer not null default 0 check (count >= 0),
  reset_at timestamptz not null,
  locked_until timestamptz
);

comment on table public.admin_login_attempts is
  'Persistent admin login rate-limit state. Access is limited to server-side service_role operations.';

alter table public.admin_login_attempts enable row level security;

revoke all on table public.admin_login_attempts from anon, authenticated;
grant select, insert, update, delete on table public.admin_login_attempts to service_role;
