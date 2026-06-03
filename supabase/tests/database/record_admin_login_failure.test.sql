begin;

select plan(16);

delete from public.admin_login_attempts
where key like 'pgtap:record-admin-login-failure:%';

select is(
  (public.record_admin_login_failure('pgtap:record-admin-login-failure:first', 900000, 900000, 5)).count,
  1,
  'first failure inserts count=1'
);

select ok(
  (
    select reset_at = now() + interval '900000 milliseconds'
    from public.admin_login_attempts
    where key = 'pgtap:record-admin-login-failure:first'
  ),
  'first failure sets reset_at to now + attempt window'
);

select ok(
  (
    select locked_until is null
    from public.admin_login_attempts
    where key = 'pgtap:record-admin-login-failure:first'
  ),
  'first failure does not lock'
);

select is(
  (public.record_admin_login_failure('pgtap:record-admin-login-failure:first', 900000, 900000, 5)).count,
  2,
  'second failure increments count'
);

select is(
  (
    select count
    from public.admin_login_attempts
    where key = 'pgtap:record-admin-login-failure:first'
  ),
  2,
  'incremented count is persisted'
);

insert into public.admin_login_attempts (key, count, reset_at, locked_until)
values (
  'pgtap:record-admin-login-failure:expired-window',
  4,
  now() - interval '1 millisecond',
  null
);

select is(
  (public.record_admin_login_failure('pgtap:record-admin-login-failure:expired-window', 900000, 900000, 5)).count,
  1,
  'expired attempt window resets count to 1'
);

select ok(
  (
    select reset_at = now() + interval '900000 milliseconds'
    from public.admin_login_attempts
    where key = 'pgtap:record-admin-login-failure:expired-window'
  ),
  'expired attempt window refreshes reset_at'
);

select ok(
  (
    select locked_until is null
    from public.admin_login_attempts
    where key = 'pgtap:record-admin-login-failure:expired-window'
  ),
  'expired attempt window does not keep an old lock'
);

insert into public.admin_login_attempts (key, count, reset_at, locked_until)
values (
  'pgtap:record-admin-login-failure:max-attempts',
  4,
  now() + interval '900000 milliseconds',
  null
);

select is(
  (public.record_admin_login_failure('pgtap:record-admin-login-failure:max-attempts', 900000, 900000, 5)).count,
  5,
  'max-attempt failure increments to max count'
);

select ok(
  (
    select locked_until = now() + interval '900000 milliseconds'
    from public.admin_login_attempts
    where key = 'pgtap:record-admin-login-failure:max-attempts'
  ),
  'max-attempt failure sets locked_until to now + lock window'
);

select ok(
  (
    select reset_at = now() + interval '900000 milliseconds'
    from public.admin_login_attempts
    where key = 'pgtap:record-admin-login-failure:max-attempts'
  ),
  'max-attempt failure preserves reset_at while locking'
);

insert into public.admin_login_attempts (key, count, reset_at, locked_until)
values (
  'pgtap:record-admin-login-failure:locked',
  5,
  now() + interval '300000 milliseconds',
  now() + interval '600000 milliseconds'
);

select is(
  (public.record_admin_login_failure('pgtap:record-admin-login-failure:locked', 900000, 900000, 5)).count,
  5,
  'locked key keeps count unchanged'
);

select ok(
  (
    select reset_at = now() + interval '300000 milliseconds'
    from public.admin_login_attempts
    where key = 'pgtap:record-admin-login-failure:locked'
  ),
  'locked key keeps reset_at unchanged'
);

select ok(
  (
    select locked_until = now() + interval '600000 milliseconds'
    from public.admin_login_attempts
    where key = 'pgtap:record-admin-login-failure:locked'
  ),
  'locked key keeps locked_until unchanged'
);

select throws_ok(
  $$ select public.record_admin_login_failure('', 900000, 900000, 5) $$,
  'P0001',
  'p_key is required',
  'blank keys are rejected'
);

select like(
  pg_get_functiondef('public.record_admin_login_failure(text, integer, integer, integer)'::regprocedure),
  '%on conflict (key) do update%',
  'RPC uses ON CONFLICT for database-side atomic increments'
);

select * from finish();

rollback;
