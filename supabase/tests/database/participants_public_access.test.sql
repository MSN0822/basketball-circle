begin;

select plan(9);

-- ---------------------------------------------------------------------------
-- participants_public は anon/authenticated に user_code を晒さないための
-- 公開読み取りサーフェス。最終状態（20260619020000）では:
--   * security_invoker = true
--   * public / anon / authenticated は SELECT 不可（revoke all）
--   * service_role のみ SELECT 可
-- かつ view 定義（20260619010000）は events を join し
-- status in ('accepting','closed') の参加者だけを露出する（draft/archived は除外）。
-- ---------------------------------------------------------------------------

-- (1) view が存在すること
select has_view(
  'public',
  'participants_public',
  'participants_public view exists'
);

-- (2) security_invoker = true であること（pg_class.reloptions を確認）
select ok(
  (
    select reloptions @> array['security_invoker=true']
    from pg_class
    where oid = 'public.participants_public'::regclass
  ),
  'participants_public has security_invoker=true'
);

-- (3) service_role は SELECT 可
select ok(
  has_table_privilege('service_role', 'public.participants_public', 'SELECT'),
  'service_role CAN select participants_public'
);

-- (4) anon は SELECT 不可
select ok(
  not has_table_privilege('anon', 'public.participants_public', 'SELECT'),
  'anon CANNOT select participants_public'
);

-- (5) authenticated は SELECT 不可
select ok(
  not has_table_privilege('authenticated', 'public.participants_public', 'SELECT'),
  'authenticated CANNOT select participants_public'
);

-- ---------------------------------------------------------------------------
-- アーカイブ除外の検証用フィクスチャ。
-- accepting / closed / draft / archived の 4 イベントに各 1 参加者を作り、
-- view が accepting と closed だけを露出することを確認する。
-- ---------------------------------------------------------------------------

insert into public.events (id, title, event_date, location, status)
values
  ('00000000-0000-0000-0000-0000000000a1', 'pgtap accepting', now(), 'gym', 'accepting'),
  ('00000000-0000-0000-0000-0000000000c1', 'pgtap closed',    now(), 'gym', 'closed'),
  ('00000000-0000-0000-0000-0000000000d1', 'pgtap draft',     now(), 'gym', 'draft'),
  ('00000000-0000-0000-0000-0000000000e1', 'pgtap archived',  now(), 'gym', 'archived');

insert into public.participants (id, event_id, name, user_code, status)
values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'pgtap p-accepting', 'guest:a:AAA', 'active'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c1', 'pgtap p-closed',    'guest:c:CCC', 'active'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1', 'pgtap p-draft',     'guest:d:DDD', 'active'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1', 'pgtap p-archived',  'guest:e:EEE', 'active');

-- (6) accepting イベントの参加者は露出される
select ok(
  exists (
    select 1 from public.participants_public
    where id = '00000000-0000-0000-0000-0000000000a2'
  ),
  'accepting event participant IS exposed by the view'
);

-- (7) closed イベントの参加者は露出される
select ok(
  exists (
    select 1 from public.participants_public
    where id = '00000000-0000-0000-0000-0000000000c2'
  ),
  'closed event participant IS exposed by the view'
);

-- (8) draft イベントの参加者は除外される
select ok(
  not exists (
    select 1 from public.participants_public
    where id = '00000000-0000-0000-0000-0000000000d2'
  ),
  'draft event participant is EXCLUDED from the view'
);

-- (9) archived イベントの参加者は除外される
select ok(
  not exists (
    select 1 from public.participants_public
    where id = '00000000-0000-0000-0000-0000000000e2'
  ),
  'archived event participant is EXCLUDED from the view'
);

select * from finish();

rollback;
