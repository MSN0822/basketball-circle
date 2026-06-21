# ERRORS / 既知の詰まりどころ

同じ手順で2回以上詰まった事象を記録する（失敗内容・根本原因・回避策・次回注意）。

---

## 2026-06-03 ローカル Supabase が `supabase start` / `test:db` / CLI経由 e2e で起動不能

### 失敗内容（2段階で連続再現）
1. `npx supabase start` が `ERROR: relation "events" does not exist` で失敗。
   最初の migration `20260526_add_event_end_date.sql`（`alter table events ...`）の時点で
   基底テーブルが存在しないため。
2. 回避として基底スキーマを最古 timestamp の一時 migration（`20260525_local_base_schema.sql`、
   schema.sql のコピー）として置くと、今度は
   `ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"
   Key (version)=(20260526) already exists` で失敗。

### 根本原因（構造的・CLI非互換）
- **基底テーブル（events/members/participants）を作る migration が存在しない**。
  定義は `supabase/schema.sql` のみ（`seed.sql` も無い）。CLI は `schema.sql` を適用しない。
- **migration ファイル名が Supabase CLI 規約（一意な14桁 timestamp）に違反**。
  `20260526_*` が5本、`20260527_*`・`20260602_*`・`20260603_*` も複数あり、CLI は先頭数字を
  `schema_migrations.version`(PK) として扱うため**同一 version 衝突**する。
- 要するにこの repo の migrations は **CLI（`supabase db` 系）では適用できない**。本番は CLI ではなく
  独自の `scripts/apply-migration.mjs`（適用台帳なし・1ファイルずつ手動）で適用されてきたため顕在化していなかった。
- ※ **本番デプロイ自体はブロックしない**（本番は基底テーブルを保有済みのため migrations は正常適用される）。

### 回避策
- 恒久（別 infra 課題）: 全 migration を一意な14桁 timestamp へ改名し、基底テーブルを最古 migration 化する
  （`schema.sql` 整合の「🟡中優先」課題と併せて検討）。runbook の適用順リスト等への波及に注意。
- 暫定（e2e/pgTAP をローカルで回したい場合）: CLI の migration ランナーをバイパスする。
  1. `supabase/migrations/` を一時退避 → `supabase start`（空で起動）
  2. `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` を設定し、
     `pg`（依存に存在）で `schema.sql` → 各 migration を順に適用
  3. `.env.local` をリポジトリ外へ退避し、ローカル Supabase 値へ差し替え
  4. `next build && next start`（**localhost** オリジン）→ `QA_BASE_URL=http://localhost:3000` で
     `playwright test admin-flows`
  5. すべて復元（migrations 戻し / `.env.local` 復元 / `supabase stop`）

### 次回注意
- `supabase start` / `npm run test:db` は**この repo の現状では即失敗する**。Docker の有無とは別問題。
- `npm run test:e2e` は**デフォルトで本番（vercel）を叩く**設計
  （`playwright.config.ts` の baseURL 既定が本番 / `webServer` 無し / spec が `.env.local` を直読み）。
  ローカル実行時は `.env.local` をローカルへ差し替えないと**本番DBを service_role で触る危険**がある。
- 関連メモリ: E2E は **localhost オリジン**・**本番ビルド（`next build && next start`）**に対して実行する。

### 解決（2026-06-04）

migrations を Supabase CLI 互換へ整備して恒久対応済み。

- 基底スキーマを `supabase/migrations/20260525000000_baseline_schema.sql`（最古 timestamp・冪等化）として正式 migration 化。
- 既存 19 本を一意な 14 桁 timestamp（`YYYYMMDDhhmmss`）へ改名（runbook の適用順を厳守して 1:1 写像）。`zz_` 接頭辞は廃止。無印重複 `add_is_manual_close.sql` は削除。
- `prepare_rls_hardening` に `_none` policy の `drop policy if exists` を追加（最終 baseline 上での再生衝突を回避）。
- 結果: `npx supabase start` がエラーなく完走（baseline + 19 本適用）、`npm run test:db` が pgTAP **16/16 PASS**。

検証中に判明した、**migration とは無関係なローカル e2e の別課題**（未解決・別途対応）:

1. **CSP がローカル browser-side supabase をブロック**: `next.config.ts` の `connect-src` が `https://*.supabase.co` のみ許可するため、ブラウザ実行のクライアントページ（編集ページ等）が `http://127.0.0.1:54321` へ接続できず描画されない（本番では発生しない）。`admin-flows` の GAP-05 等が落ちる。
2. **GAP-14 の IP キー前提**: テストは `ip:unknown` を期待するが、`next start` ローカルでは `x-forwarded-for: ::1` が付くため実キーは `ip:::1`。アサーションが環境依存。

これら 2 点を解消しない限り、localhost 向け `admin-flows` フルスイートは緑にならない（DB スキーマ起因ではない）。

---

## 2026-06-21 ローカル pgTAP（`npm run test:db`）が新規ブロッカー2点で失敗

### 失敗内容
1. **`supabase start` が古い Docker ボリュームを再利用**し、migration が `20260603030000` までの20本しか当たらない（0608〜0620 の8本＝`archived` 追加・`participants_public` security_invoker=true・`register_member` gap-fill版が未適用）。結果、pgTAP が「archived がCHECK制約違反」「security_invoker=false」「register_member が max+1」で誤 FAIL する（テストではなく **DB 状態が古い**のが原因）。
2. **`supabase db reset` が `20260614031000_schedule_due_draft_promotion.sql` で停止**: `create extension if not exists pg_cron` が `ERROR: permission denied for function pg_read_file (SQLSTATE 42501)`。ローカルの migration 適用ロールが pg_cron 作成権限を持たないため（本番 Supabase は pg_cron 許可済みなので発生しない）。2026-06-04 のローカル整備後（6/14）に追加された新ブロッカー。

### 回避策（pgTAP をローカルで緑にする手順）
1. Docker Desktop 起動 → daemon 待ち。
2. `20260614031000_schedule_due_draft_promotion.sql` を一時退避（`.localskip` 等にリネーム。後続 migration は pg_cron / `publish_due_draft_events` に非依存なので安全に skip 可）。
3. `npx supabase db reset`（古いボリュームを破棄し全 migration を再適用。`start` ではなく **reset** が要点）。
4. `npm run test:db` → **3 files / 34 tests PASS** を確認（2026-06-21 実績）。
5. 退避ファイルを**必ず元の名前へ復元**（任意で `npx supabase stop`）。

### 次回注意
- ローカル pgTAP は `supabase start` だけでは古い状態になりうる。**必ず `supabase db reset`** で作り直す。
- pg_cron migration はローカル `db reset` / `test:db` を止める。恒久対応するなら config.toml でローカル pg_cron を有効化するか、`create extension pg_cron` を `do $$ ... exception when insufficient_privilege then null; end $$;` でガードする案を検討（本番適用は `apply-migration.mjs` の superuser 経由で従来通り当たる）。
