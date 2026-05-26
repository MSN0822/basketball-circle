-- イベントテーブル
create table events (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  event_date     timestamptz not null,
  event_end_date timestamptz,
  location       text not null,
  max_participants int not null default 40,
  threshold      int not null default 30,
  status         text not null default 'accepting' check (status in ('accepting', 'closed')),
  created_at     timestamptz not null default now()
);

-- 参加者テーブル
create table participants (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  name        text not null,
  user_code   text not null,
  status      text not null default 'active' check (status in ('active', 'cancelled', 'waitlist')),
  slot_number int,
  created_at  timestamptz not null default now()
);

-- RLS有効化
alter table events enable row level security;
alter table participants enable row level security;

-- 全員がeventsを読める
create policy "events_select" on events for select using (true);

-- 全員がparticipantsを読める
create policy "participants_select" on participants for select using (true);

-- 全員が参加申請できる（INSERT）
create policy "participants_insert" on participants for insert with check (true);

-- キャンセル（UPDATE）は全員可能（user_code照合はアプリ層で実施）
create policy "participants_update" on participants for update using (true);

-- Realtimeパブリケーション
alter publication supabase_realtime add table participants;

-- インデックス
create index on participants(event_id, status);
create index on participants(event_id, slot_number);
