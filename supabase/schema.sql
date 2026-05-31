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
create policy "events_select" on events for select using (true);
create policy "events_insert_none" on events for insert with check (false);
create policy "events_update_none" on events for update using (false) with check (false);
create policy "events_delete_none" on events for delete using (false);

create policy "members_select" on members for select using (true);
create policy "members_insert_none" on members for insert with check (false);
create policy "members_update_none" on members for update using (false) with check (false);
create policy "members_delete_none" on members for delete using (false);

create policy "participants_select" on participants for select using (true);
create policy "participants_insert_none" on participants for insert with check (false);
create policy "participants_update_none" on participants for update using (false) with check (false);
create policy "participants_delete_none" on participants for delete using (false);

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
