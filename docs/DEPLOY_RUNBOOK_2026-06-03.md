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

未適用ファイルを辞書順で適用します。依存順もこの順序で満たされます。

```text
supabase/migrations/20260526_add_event_end_date.sql
supabase/migrations/20260526_add_is_manual_close.sql
supabase/migrations/20260526_join_event_rpc.sql
supabase/migrations/20260526_prepare_rls_hardening.sql
supabase/migrations/20260526_register_member_rpc.sql
supabase/migrations/20260527_allow_guest_invites_until_capacity.sql
supabase/migrations/20260527_close_full_events_without_waitlist.sql
supabase/migrations/20260527_enable_events_realtime.sql
supabase/migrations/20260527_harden_public_mutation_policies.sql
supabase/migrations/20260602_cancel_participant_lock_order_fix.sql
supabase/migrations/20260602_create_admin_login_attempts.sql
supabase/migrations/20260602_drop_participants_delete_open_policy.sql
supabase/migrations/20260602_join_event_unique_violation_guard.sql
supabase/migrations/20260602_participants_slot_unique_index.sql
supabase/migrations/20260602_revoke_register_member_anon_execute.sql
supabase/migrations/20260602_update_member_name_rpc.sql
supabase/migrations/20260603_restrict_private_rpc_and_select.sql
supabase/migrations/20260603_zz_admin_login_attempts_rpc.sql
supabase/migrations/20260603_zz_public_participants_view.sql
```

重要な依存:

- `20260602_create_admin_login_attempts.sql` の後に `20260603_zz_admin_login_attempts_rpc.sql`
- `20260603_restrict_private_rpc_and_select.sql` の後に `20260603_zz_public_participants_view.sql`

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

## 7. 削除候補

`supabase/migrations/add_is_manual_close.sql` は接頭辞付きの `20260526_add_is_manual_close.sql` に複製済みです。AI は削除しないため、不要確認後に人間が削除候補として扱ってください。`schema.sql` には `is_manual_close` が既に含まれるため、新規 DB ではこの migration は no-op です。
