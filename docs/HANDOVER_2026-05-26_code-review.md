# Claude Code レビュー引き継ぎ資料

作成日時: 2026-05-26 JST  
対象プロジェクト: `C:\ClaudeCode\90_projects\03_basketball-circle`

---

## レビュー概要

Claude Code によるコード全体の第3者レビューを実施。  
実運用開始前に対処すべき問題点と優先度をまとめる。

---

## 🔴 最優先：参加申請の競合（TOCTOU）

### 問題

`app/api/participants/route.ts` の参加申請処理が非アトミック。

```ts
// ① activeCount を読む
const { count: activeCount } = await supabase
  .from('participants').select('*', { count: 'exact', head: true })
  .eq('event_id', event_id).eq('status', 'active')

// ② slot_number を決める
const slot_number = current + 1

// ③ INSERT する（①〜③の間はロックなし）
await supabase.from('participants').insert({ ..., status: 'active', slot_number })
```

2リクエストが同時に「39人目」を読むと、両方が `slot_number = 40` で active 登録される。  
40人を超えた active 参加者が生まれ、slot_number の整合も崩れる。  
これは **このアプリが解決するために作られた問題（LINE同時コピペ）と本質的に同じ**。

`app/api/members/route.ts` の `member_number` 採番も同様のパターン。

### 推奨修正：Supabase RPC（PostgreSQL function）化

参加申請ロジック全体を PostgreSQL function に移し、トランザクション内で完結させる。

```sql
create or replace function join_event(
  p_event_id   uuid,
  p_name       text,
  p_user_code  text,
  p_member_id  uuid default null,
  p_guest      boolean default false
)
returns jsonb
language plpgsql
as $$
declare
  v_event       events%rowtype;
  v_active_count int;
  v_slot        int;
  v_status      text;
  v_participant participants%rowtype;
begin
  -- イベントを FOR UPDATE でロック（同時実行を直列化）
  select * into v_event from events where id = p_event_id for update;

  if not found then
    return jsonb_build_object('error', 'イベントが見つかりません');
  end if;

  -- active 数カウント（ロック後に取得するので正確）
  select count(*) into v_active_count
  from participants
  where event_id = p_event_id and status = 'active';

  if v_event.status = 'accepting' and v_active_count < v_event.max_participants then
    v_slot   := v_active_count + 1;
    v_status := 'active';

    -- 定員到達なら同時にイベントをclose
    if v_slot >= v_event.max_participants then
      update events set status = 'closed' where id = p_event_id;
    end if;
  else
    select count(*) + 1 into v_slot
    from participants
    where event_id = p_event_id and status = 'waitlist';
    v_status := 'waitlist';
  end if;

  insert into participants (event_id, name, user_code, member_id, status, slot_number)
  values (p_event_id, p_name, p_user_code, p_member_id, v_status, v_slot)
  returning * into v_participant;

  return jsonb_build_object(
    'participant', row_to_json(v_participant),
    'waitlist',    v_status = 'waitlist'
  );
end;
$$;
```

API 側は `supabase.rpc('join_event', { ... })` に置き換えるだけで済む。

member_number の採番も同様に RPC 化を検討すること（`register_member` function）。

---

## 🟡 中優先：schema.sql の整合

### 問題

`supabase/schema.sql` が実際の本番DBと乖離している。

| 不整合 | 内容 |
|---|---|
| `events` テーブル | `location_url`, `closes_at`, `publishes_at` カラムが schema.sql に未記載 |
| `participants` テーブル | `member_id` カラムが schema.sql に未記載 |
| `members` テーブル | schema.sql に存在しない |
| `events.status` CHECK 制約 | `'draft'` が許容値に含まれていない |

### 推奨修正

schema.sql を実態に合わせて更新する。現在の正しい定義は以下：

```sql
create table events (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  event_date       timestamptz not null,
  event_end_date   timestamptz,
  location         text not null,
  location_url     text,
  closes_at        timestamptz,
  publishes_at     timestamptz,
  max_participants int not null default 40,
  threshold        int not null default 30,
  status           text not null default 'accepting'
                   check (status in ('accepting', 'closed', 'draft')),
  created_at       timestamptz not null default now()
);

create table participants (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  name        text not null,
  user_code   text not null,
  member_id   uuid references members(id),
  status      text not null default 'active'
              check (status in ('active', 'cancelled', 'waitlist')),
  slot_number int,
  created_at  timestamptz not null default now()
);

create table members (
  id             uuid primary key default gen_random_uuid(),
  member_number  text not null unique,
  name           text not null,
  auth_user_id   uuid references auth.users(id),
  created_at     timestamptz not null default now()
);
```

---

## 🟡 中優先：RLS の強化

### 問題

```sql
-- 現状：誰でも参加者を更新できる
create policy "participants_update" on participants for update using (true);
```

Supabase REST API に直接 PATCH すれば、user_code を知らなくても誰のステータスでも変更できる。

### 推奨修正

`participants_update` を廃止し、キャンセル操作は **全て API ルート経由** に統一する。  
APIルートは `SUPABASE_SERVICE_ROLE_KEY`（サーバー専用キー）で接続し、RLS をバイパスして操作する。

```ts
// API ルートでの接続（service role key 使用）
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // ← サーバー側のみ使用
)
```

```sql
-- RLS: participants の UPDATE を全面禁止（API が service_role で操作）
-- policy "participants_update" を DROP する
```

**注意**: `SUPABASE_SERVICE_ROLE_KEY` はサーバーサイド（API Route）のみで使用。  
クライアントコンポーネントや `NEXT_PUBLIC_` 変数に入れてはいけない。

---

## 現在の実装状況（完了済み）

| 機能 | ファイル | 状態 |
|---|---|---|
| イベント一覧 | `app/page.tsx` | ✅ 完了（未コミットあり※） |
| イベント詳細 | `app/events/[id]/page.tsx` | ✅ 完了 |
| 参加申請 | `app/api/participants/route.ts` | ✅ 完了（競合問題あり） |
| キャンセル | `app/api/cancel/route.ts` | ✅ 完了 |
| 会員登録 | `app/api/members/route.ts` | ✅ 完了（競合問題あり） |
| 管理者API | `app/api/admin/events/route.ts` | ✅ 完了 |
| 管理者画面 | `app/admin/page.tsx` | ✅ 完了 |
| 管理者作成画面 | `app/admin/create/page.tsx` | ✅ 完了 |
| 管理者編集画面 | `app/admin/events/[id]/edit/page.tsx` | ✅ 完了 |
| 会員ヘッダー | `components/MemberHeader.tsx` | ✅ 完了 |
| 参加フォーム | `components/JoinForm.tsx` | ✅ 完了 |
| 参加者リスト | `components/ParticipantList.tsx` | ✅ 完了（Realtime） |
| イベントリスト | `components/EventList.tsx` | ✅ 完了 |
| 場所入力 | `components/PlacesInput.tsx` | ✅ 完了 |
| 認証middleware | `middleware.ts` | ✅ 完了 |
| 定員自動締め切り | `app/api/participants/route.ts` | ✅ 完了 |
| 閾値自動再開 | `app/api/cancel/route.ts` | ✅ 完了 |

※ `app/page.tsx` は auto-publish バグ修正済みだが未コミット。コミット時は個別指定すること。

---

## 技術スタック

| 項目 | 内容 |
|---|---|
| フレームワーク | Next.js 16 (App Router) + TypeScript |
| DB / Auth / Realtime | Supabase |
| スタイリング | Tailwind CSS + shadcn/ui |
| ホスティング | Vercel |
| リポジトリ | github.com/MSN0822/basketball-circle |
| 本番URL | https://basketball-circle.vercel.app |
| ローカル | http://localhost:3000 |
| プロジェクトパス | `C:\ClaudeCode\90_projects\03_basketball-circle\` |

---

## 作業優先度

1. **🔴 `join_event` RPC 作成 + participants API の RPC 化**（実運用前に必須）
2. **🟡 `schema.sql` を実態に合わせて更新**（Codex/Claude が混乱しないよう早めに）
3. **🟡 RLS 強化 + service_role_key 対応**（セキュリティ改善）

---

## 直近のコミット

```text
ab99895 feat: auto-close event at capacity and reopen below threshold
774057d feat: add event end date
c879dab feat: allow guest invites without joining
671deea fix: keep guest management after self cancel
340758c fix: label guests with inviter family name
```
