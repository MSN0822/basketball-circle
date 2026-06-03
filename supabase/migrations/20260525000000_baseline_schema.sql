-- basketball-circle ベーススキーマ（events / members / participants / admin_login_attempts）。
--
-- これは Supabase CLI（supabase start / db reset / test db）が空 DB へ最初に適用する
-- 正本のベーススキーマ。supabase/schema.sql の人間可読スナップショットを冪等化したもので、
-- 最終 RLS / view / index 状態を含む。
--
-- 注:
-- * RPC 関数本体（join_event, cancel_participant, register_member,
--   update_member_name, record_admin_login_failure）は後続 migrations が正本のため
--   ここには含めない。CLI は本ファイルの後に migrations を timestamp 昇順で適用する。
-- * 本番 DB は基底テーブルを既に保有しているため、本ファイルを手動適用しないこと
--   （冪等だが二重適用の混乱を避ける）。
-- * pgTAP 拡張はここで作らない（`supabase test db` が CLI 側でロードする）。

-- イベントテーブル
create table if not exists events (
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
create table if not exists members (
  id             uuid primary key default gen_random_uuid(),
  member_number  text not null unique,
  name           text not null,
  auth_user_id   uuid references auth.users(id),
  created_at     timestamptz not null default now()
);

-- 参加者テーブル
create table if not exists participants (
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
drop policy if exists "events_select" on events;
create policy "events_select" on events for select using (true);
drop policy if exists "events_insert_none" on events;
create policy "events_insert_none" on events for insert with check (false);
drop policy if exists "events_update_none" on events;
create policy "events_update_none" on events for update using (false) with check (false);
drop policy if exists "events_delete_none" on events;
create policy "events_delete_none" on events for delete using (false);

drop policy if exists "members_select_own" on members;
create policy "members_select_own" on members for select to authenticated using (auth.uid() = auth_user_id);
drop policy if exists "members_insert_none" on members;
create policy "members_insert_none" on members for insert with check (false);
drop policy if exists "members_update_none" on members;
create policy "members_update_none" on members for update using (false) with check (false);
drop policy if exists "members_delete_none" on members;
create policy "members_delete_none" on members for delete using (false);

-- participants には直 SELECT ポリシーを付与しない。anon/authenticated の公開読取は
-- participants_public view（security_invoker=false）経由のみ（user_code を露出させないため）。
drop policy if exists "participants_insert_none" on participants;
create policy "participants_insert_none" on participants for insert with check (false);
drop policy if exists "participants_update_none" on participants;
create policy "participants_update_none" on participants for update using (false) with check (false);
drop policy if exists "participants_delete_none" on participants;
create policy "participants_delete_none" on participants for delete using (false);

-- 公開読取サーフェス（参加者の user_code を露出させない definer view）
drop view if exists public.participants_public;
create view public.participants_public with (security_invoker = false) as
select
  id,
  event_id,
  name,
  member_id,
  status,
  slot_number,
  created_at,
  case
    when user_code like 'guest:%:%' then split_part(user_code, ':', 3)
    else null
  end as display_code
from public.participants;
revoke all on public.participants_public from public;
grant select on public.participants_public to anon, authenticated;

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

-- Realtimeパブリケーション（既にメンバの場合は duplicate_object を握り潰す）
do $$
begin
  alter publication supabase_realtime add table participants;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table events;
exception
  when duplicate_object then null;
end $$;

-- インデックス（明示名 + if not exists で冪等化）
create index if not exists events_event_date_idx               on events(event_date);
create index if not exists events_status_idx                   on events(status);
create index if not exists members_auth_user_id_idx            on members(auth_user_id);
create index if not exists participants_event_id_status_idx    on participants(event_id, status);
create index if not exists participants_event_id_slot_number_idx on participants(event_id, slot_number);
create index if not exists participants_member_id_idx          on participants(member_id);
create index if not exists participants_user_code_idx          on participants(user_code);
