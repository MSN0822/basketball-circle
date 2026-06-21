begin;

select plan(9);

-- register_member は members.auth_user_id 経由で auth.users(id) を参照する外部キーを持つ。
-- ローカル Supabase テスト DB には auth.users が存在するので、テスト専用の最小限の
-- auth ユーザーを挿入して FK を満たす。トランザクション内なので rollback で消える。
insert into auth.users (id, instance_id, email, aud, role, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
   'pgtap-reuse-a1@example.test', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000',
   'pgtap-reuse-a2@example.test', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000',
   'pgtap-reuse-a3@example.test', 'authenticated', 'authenticated', now(), now()),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000',
   'pgtap-reuse-a4@example.test', 'authenticated', 'authenticated', now(), now());

-- このテストはクリーンな members テーブルを前提とする。最小空き番号ロジックは
-- 既存行に依存するため、テスト開始時点の残存行を排除して決定論的にする。
delete from public.members;

-- ---------------------------------------------------------------------------
-- シナリオ 1: 空のテーブルへの最初の登録は最小の空き番号 (001) を割り当てる
-- ---------------------------------------------------------------------------
select is(
  public.register_member('pgtap reuse alpha', '00000000-0000-0000-0000-0000000000a1')
    -> 'member' ->> 'member_number',
  '001',
  'first registration on empty table assigns smallest number 001'
);

-- 2 人目は次の最小番号 002 を取得する
select is(
  public.register_member('pgtap reuse bravo', '00000000-0000-0000-0000-0000000000a2')
    -> 'member' ->> 'member_number',
  '002',
  'second registration assigns next smallest number 002'
);

-- 3 人目は 003 を取得する（この後 002 を削除して再利用を検証する）
select is(
  public.register_member('pgtap reuse charlie', '00000000-0000-0000-0000-0000000000a3')
    -> 'member' ->> 'member_number',
  '003',
  'third registration assigns 003'
);

-- 現時点で 001/002/003 の 3 件が存在する
select is(
  (select count(*) from public.members),
  3::bigint,
  'three members exist before deletion'
);

-- ---------------------------------------------------------------------------
-- シナリオ 2: 中間メンバー (002) を削除すると、その空き番号が再利用される
-- ---------------------------------------------------------------------------
delete from public.members where member_number = '002';

select is(
  (select count(*) from public.members where member_number = '002'),
  0::bigint,
  'member 002 is removed, leaving a gap'
);

-- 新規登録は最大値+1 (004) ではなく、空いた最小番号 002 を再利用する
select is(
  public.register_member('pgtap reuse delta', '00000000-0000-0000-0000-0000000000a4')
    -> 'member' ->> 'member_number',
  '002',
  'new registration reuses the freed number 002 instead of 004'
);

-- ---------------------------------------------------------------------------
-- シナリオ 3: 複数の空きがある場合、最小の空き番号が選ばれる
-- ---------------------------------------------------------------------------
-- 現状: 001, 002, 003 が埋まっている。002 と 003 を削除して 2 つの空きを作る。
delete from public.members where member_number in ('002', '003');

select is(
  (select count(*) from public.members),
  1::bigint,
  'only member 001 remains, creating gaps at 002 and 003'
);

-- auth.users にもう 1 行追加し、空き 002 と 003 のうち最小の 002 が選ばれることを検証する
insert into auth.users (id, instance_id, email, aud, role, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000',
   'pgtap-reuse-a5@example.test', 'authenticated', 'authenticated', now(), now());

select is(
  public.register_member('pgtap reuse echo', '00000000-0000-0000-0000-0000000000a5')
    -> 'member' ->> 'member_number',
  '002',
  'with multiple gaps (002, 003) the minimum free number 002 is chosen'
);

-- 念のため最終状態: 001 と 002 が存在し、003 は空きのまま
select is(
  (select array_agg(member_number order by member_number) from public.members),
  array['001', '002']::text[],
  'final state retains 001 and re-assigned 002, leaving 003 free'
);

select * from finish();

rollback;
