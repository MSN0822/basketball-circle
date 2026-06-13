-- basketball-circle データベースのテーブル / RLS / view ベースライン（人間可読の参照スナップショット）。
-- 注:
--   * Supabase CLI（supabase start / db reset / test db）が空 DB へ適用する正本は
--     migrations/20260525000000_baseline_schema.sql（本ファイルを冪等化したもの）。
--     本ファイル自体は CLI には適用されない参照用。両者を一致させて維持すること。
--   * RPC 関数（join_event, cancel_participant, register_member,
--     update_member_name, record_admin_login_failure）は supabase/migrations/ が正本のため
--     本ファイルには含めない。
--   * CLI を使わず新規 DB を手で立てる場合は、本ファイル適用後に migrations を
--     timestamp 昇順で適用すること。

-- イベントテーブル
create table events (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  event_date       timestamptz not null,
  event_end_date   timestamptz,
  location         text not null,
  location_url     text,
  closes_at        timestamptz,
  publishes_at     timestamptz,
  max_participants int not null default 35,
  threshold        int not null default 30,
  status           text not null default 'accepting' check (status in ('accepting', 'closed', 'draft')),
  is_manual_close  boolean not null default false,
  created_at       timestamptz not null default now()
);

-- 会員テーブル
create table members (
  id             uuid primary key default gen_random_uuid(),
  member_number  text not null unique,
  name           text not null,
  auth_user_id   uuid references auth.users(id),
  created_at     timestamptz not null default now()
);

-- 参加者テーブル
create table participants (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  name        text not null,
  user_code   text not null,
  member_id   uuid references members(id),
  status      text not null default 'active' check (status in ('active', 'cancelled', 'waitlist')),
  slot_number int,
  created_at  timestamptz not null default now()
);

-- RLS有効化
alter table events enable row level security;
alter table members enable row level security;
alter table participants enable row level security;

-- 現状のアプリ実装に合わせた公開ポリシー
create policy "events_select" on events for select to authenticated using (status <> 'draft');
create policy "events_insert_none" on events for insert with check (false);
create policy "events_update_none" on events for update using (false) with check (false);
create policy "events_delete_none" on events for delete using (false);

create policy "members_select_own" on members for select to authenticated using (auth.uid() = auth_user_id);
create policy "members_insert_none" on members for insert with check (false);
create policy "members_update_none" on members for update using (false) with check (false);
create policy "members_delete_none" on members for delete using (false);

-- participants には直 SELECT ポリシーを付与しない。anon/authenticated の公開読取は
-- participants_public view（security_invoker=false）経由のみ（user_code を露出させないため）。
create policy "participants_insert_none" on participants for insert with check (false);
create policy "participants_update_none" on participants for update using (false) with check (false);
create policy "participants_delete_none" on participants for delete using (false);

-- 公開読取サーフェス（参加者の user_code を露出させない definer view）
drop view if exists public.participants_public;
create view public.participants_public with (security_invoker = false) as
select
  p.id,
  p.event_id,
  p.name,
  p.status,
  p.slot_number,
  p.created_at,
  case
    when p.user_code like 'guest:%:%' then split_part(p.user_code, ':', 3)
    else null
  end as display_code
from public.participants p
join public.events e on e.id = p.event_id
where e.status <> 'draft';
revoke all on public.participants_public from public;
revoke all on public.participants_public from anon;
grant select on public.participants_public to authenticated;

-- 管理者ログインのレート制限状態（server-side service_role のみアクセス）
create table if not exists public.admin_login_attempts (
  key text primary key,
  count integer not null default 0 check (count >= 0),
  reset_at timestamptz not null,
  locked_until timestamptz
);
alter table public.admin_login_attempts enable row level security;
revoke all on table public.admin_login_attempts from anon, authenticated;
grant select, insert, update, delete on table public.admin_login_attempts to service_role;

-- Realtimeパブリケーション
alter publication supabase_realtime add table participants;
alter publication supabase_realtime add table events;

-- インデックス
create index on events(event_date);
create index on events(status);
create index on members(auth_user_id);
create index on participants(event_id, status);
create index on participants(event_id, slot_number);
create index on participants(member_id);
create index on participants(user_code);
