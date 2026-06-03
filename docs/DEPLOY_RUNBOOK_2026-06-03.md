# Deploy Runbook 2026-06-03

この手順は basketball-circle の 2026-06-03 予約システム改修を本番へ反映するためのものです。Codex は SQL/コード作成までで、DB マイグレーション適用、push、Vercel デプロイ、本番スモークはまっすんが実行します。

## 0. 鉄則

必ず次の順序で実行します。

1. 全マイグレーション適用
2. 確認 SQL がすべて OK
3. `git push` して Vercel 自動デプロイ
4. 本番スモーク

逆順は禁止です。今回のアプリコードは `participants_public` view と `record_admin_login_failure(text, integer, integer, integer)` RPC を前提に動くため、DB 未適用のままデプロイすると公開イベント詳細の参加者表示や管理者ログイン rate limit が崩れます。

## 1. 未適用マイグレーションの特定

`.env.local` に `SUPABASE_DB_URL` が設定されていることを確認してから実行します。

```bash
node scripts/check-migration-status.mjs
```

出力の `未適用` / `要目視` を確認します。特に以下が `適用済み` になることを確認します。

- `admin_login_attempts`
- `record_admin_login_failure RPC`
- `private RPC execute restricted to service_role`
- `public read model: members own select + participants_public view`

## 2. 適用順

未適用ファイルをファイル名（14 桁 timestamp）昇順で適用します。依存順もこの順序で満たされます。

> 注: 2026-06-04 に migration を Supabase CLI 互換へ整備し、ファイル名を一意な 14 桁
> timestamp へ改名した（`supabase start` / `npm run test:db` がローカルで通るようになった）。
> `20260525000000_baseline_schema.sql` は**新規 / ローカル DB 専用**の基底スキーマで、
> 本番 DB は基底テーブルを既に保有しているため**本番へは手動適用しない**こと
> （冪等だが二重適用の混乱を避ける）。本番に流す未適用ファイルは下記のうち未適用分のみ。

```text
supabase/migrations/20260525000000_baseline_schema.sql  ← 新規/ローカルのみ。本番は適用しない
supabase/migrations/20260526010000_add_event_end_date.sql
supabase/migrations/20260526020000_add_is_manual_close.sql
supabase/migrations/20260526030000_join_event_rpc.sql
supabase/migrations/20260526040000_prepare_rls_hardening.sql
supabase/migrations/20260526050000_register_member_rpc.sql
supabase/migrations/20260527010000_allow_guest_invites_until_capacity.sql
supabase/migrations/20260527020000_close_full_events_without_waitlist.sql
supabase/migrations/20260527030000_enable_events_realtime.sql
supabase/migrations/20260527040000_harden_public_mutation_policies.sql
supabase/migrations/20260602010000_cancel_participant_lock_order_fix.sql
supabase/migrations/20260602020000_create_admin_login_attempts.sql
supabase/migrations/20260602030000_drop_participants_delete_open_policy.sql
supabase/migrations/20260602040000_join_event_unique_violation_guard.sql
supabase/migrations/20260602050000_participants_slot_unique_index.sql
supabase/migrations/20260602060000_revoke_register_member_anon_execute.sql
supabase/migrations/20260602070000_update_member_name_rpc.sql
supabase/migrations/20260603010000_restrict_private_rpc_and_select.sql
supabase/migrations/20260603020000_admin_login_attempts_rpc.sql
supabase/migrations/20260603030000_public_participants_view.sql
```

重要な依存:

- `20260602020000_create_admin_login_attempts.sql` の後に `20260603020000_admin_login_attempts_rpc.sql`
- `20260603010000_restrict_private_rpc_and_select.sql` の後に `20260603030000_public_participants_view.sql`

適用コマンド:

```bash
node scripts/apply-migration.mjs supabase/migrations/<file>.sql
```

## 3. 適用前後の確認 SQL

### admin_login_attempts と RPC

```sql
select to_regclass('public.admin_login_attempts') as admin_login_attempts_table;

select to_regprocedure(
  'public.record_admin_login_failure(text, integer, integer, integer)'
) as record_admin_login_failure_rpc;
```

期待:

- `admin_login_attempts_table = admin_login_attempts`
- `record_admin_login_failure_rpc` が null ではない

### participants_public view と security_invoker

```sql
select
  c.relname,
  c.relkind,
  c.reloptions,
  coalesce(c.reloptions, array[]::text[]) @> array['security_invoker=false'] as security_invoker_false
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'participants_public';
```

期待:

- `relkind = v`
- `security_invoker_false = true`

### participants RLS と SELECT ポリシー

```sql
select relrowsecurity
from pg_class
where oid = 'public.participants'::regclass;

select policyname, cmd, roles::text, qual
from pg_policies
where schemaname = 'public'
  and tablename = 'participants'
order by policyname;
```

期待:

- `relrowsecurity = true`
- `cmd = SELECT` の policy が存在しない

### private RPC execute 権限

```sql
select
  has_function_privilege('anon', 'public.join_event(uuid,text,text,uuid,boolean)', 'execute') as anon_join,
  has_function_privilege('authenticated', 'public.join_event(uuid,text,text,uuid,boolean)', 'execute') as auth_join,
  has_function_privilege('service_role', 'public.join_event(uuid,text,text,uuid,boolean)', 'execute') as service_join,
  has_function_privilege('anon', 'public.cancel_participant(uuid)', 'execute') as anon_cancel,
  has_function_privilege('authenticated', 'public.cancel_participant(uuid)', 'execute') as auth_cancel,
  has_function_privilege('service_role', 'public.cancel_participant(uuid)', 'execute') as service_cancel,
  has_function_privilege('anon', 'public.update_member_name(uuid, uuid, text)', 'execute') as anon_update_member,
  has_function_privilege('authenticated', 'public.update_member_name(uuid, uuid, text)', 'execute') as auth_update_member,
  has_function_privilege('service_role', 'public.update_member_name(uuid, uuid, text)', 'execute') as service_update_member,
  has_function_privilege('anon', 'public.register_member(text, uuid)', 'execute') as anon_register,
  has_function_privilege('authenticated', 'public.register_member(text, uuid)', 'execute') as auth_register,
  has_function_privilege('service_role', 'public.register_member(text, uuid)', 'execute') as service_register;
```

期待:

- `anon_* = false`
- `auth_* = false`
- `service_* = true`

## 4. Cron 影響確認

`vercel.json` の cron は変更なしです。

```json
{
  "path": "/api/cron/cleanup",
  "schedule": "0 15 * * *"
}
```

`0 15 * * *` は UTC 15:00、JST 00:00 です。今回の DB 公開 view / admin rate-limit RPC 変更は cleanup cron の認証・スケジュールに影響しません。

## 5. Push / Deploy

確認 SQL が OK になってから push します。

```bash
git push
```

Vercel 自動デプロイ完了後、本番スモークを実行します。

```bash
QA_BASE_URL=https://basketball-circle.vercel.app node scripts/qa-post-deploy-smoke-2026-06-03.mjs
```

## 6. 緊急ロールバック SQL

本番 DB の状態を戻す必要がある場合のみ実行します。実行前に対象 DB が本番であること、影響範囲を確認してください。

### participants_public / rate-limit RPC を落とす

```sql
drop view if exists public.participants_public;
drop function if exists public.record_admin_login_failure(text, integer, integer, integer);
```

### participants の旧 SELECT ポリシーを復元

これは緊急時にブラウザ直 SELECT 経路へ戻すための復旧 SQL です。`user_code` がログイン済みユーザーへ再露出するため、長時間この状態で運用しないでください。

```sql
drop policy if exists "participants_select" on public.participants;
drop policy if exists "participants_select_authenticated" on public.participants;

create policy "participants_select_authenticated" on public.participants
  for select
  to authenticated
  using (true);
```

### register_member / private RPC 権限を旧状態へ戻す場合

原則不要です。どうしても旧ブラウザ直 RPC 運用へ戻す場合のみ、アプリコードも同時に戻してください。

```sql
grant execute on function public.join_event(uuid, text, text, uuid, boolean) to anon, authenticated;
grant execute on function public.cancel_participant(uuid) to anon, authenticated;
grant execute on function public.update_member_name(uuid, uuid, text) to authenticated;
grant execute on function public.register_member(text, uuid) to authenticated;
```

## 7. 削除済み: 重複 migration

`supabase/migrations/add_is_manual_close.sql`（無印）は `20260526020000_add_is_manual_close.sql`
と同一の no-op 重複だったため、2026-06-04 の CLI 互換化で削除済み（`git rm`）。
`is_manual_close` カラムは baseline / `20260526020000_add_is_manual_close.sql` の両方が
`add column if not exists` で冪等に作る。

## 8. セキュリティ設計の既知トレードオフ / 運用注意

監査（2026-06-03）で確認した、意図的に許容している設計と運用上の注意点。デプロイ後に「不具合」と誤診しないこと。

### 8.1 admin ログインの global ロックは全管理者に効く（意図的）

`/api/admin/verify` のレート制限は `ip:<client>` と `global:admin-login` の2系統で記録する（`app/api/admin/verify/route.ts`）。`global:admin-login` は共有キーのため、匿名の攻撃者が15分窓内に5回失敗させると **全管理者の新規ログインが最大15分間 429 で封鎖**される。

- これは IP ローテーション／分散ブルートフォースを止めるための**意図的なトレードオフ**。
- **ログイン済みセッション（cookie 保持）は無影響**（`GET` はレート制限を経由しない）。攻撃者は管理画面に入れない。
- 自己回復する（最大 `LOCK_MS` = 15分）。封鎖が継続して困る場合は、`admin_login_attempts` の `global:admin-login` 行を service_role で削除すれば即時解除できる。
- 不正 JSON / パスワード無しの 400 も失敗としてカウントする（防御寄りの仕様）。

### 8.2 participants の anon realtime は配信されない（15秒ポーリングにフォールバック）

最終 RLS 状態では `participants` に SELECT ポリシーが無いため、anon ブラウザの Realtime 購読には変更イベントが配信されない。`components/ParticipantList.tsx` は **15秒ポーリング**でフォールバックするため UI は最終的に収束する（最大15秒の遅延）。これは RLS ハードニングに伴う**仕様**であり、データ露出やデプロイブロッカーではない。

### 8.3 migration 適用ゲート（再実行禁止）

`scripts/apply-migration.mjs` は適用台帳を持たず、渡されたファイルを無条件に適用する。適用後は必ず `node scripts/check-migration-status.mjs` を実行し、特に **Q6 / Q8 / Q9** が「適用済み」であることをゲートとして確認すること。

- `20260603010000_restrict_private_rpc_and_select.sql` を `20260603030000_public_participants_view.sql` の**後に単独再実行すると** `participants_select_authenticated (using true)` が復活し、**user_code が authenticated に再露出する**。途中ファイルの再実行は禁止。
- `schema.sql` は本バンドルのセキュリティ部分（`members_select_own` / participants 直 SELECT なし / `participants_public` view / `admin_login_attempts`）を反映済み。ただし RPC 関数本体と一部の旧カラムは未反映のため、新規 DB は `schema.sql` 適用後に migrations を辞書順で適用すること。
