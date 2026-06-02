# Codexデスクトップアプリ用プロンプト — 本番Supabase 適用状況チェック（read-only / 2026-06-02）

> basketball-circle で 2026-06-02 付の7マイグレーションが本番Supabaseにどこまで適用済みかを **読み取り専用** で確認するためのプロンプト。
> Claude Code が確認スクリプト `scripts/check-migration-status.mjs`（SELECT以外を拒否するガード付き・書き込みなし）を作成済み。残る作業は `pg` を入れて実行するだけ。

---

## プロンプト本文（コピペ用）

このリポジトリは Next.js 16.2.6 / React 19 / Supabase のイベント参加管理アプリ（basketball-circle）です。

**必読**: `AGENTS.md` の通り、このバージョンの Next.js は通常版と異なります。ただし今回の作業はコード実装ではなく **本番DBの状態を読み取るだけ** なので、Next.js 自体には触れません。

### やってほしいこと（read-only のDB調査のみ）

本番Supabaseに、`supabase/migrations/` の 2026-06-02 付7マイグレーションがどこまで適用されているかを確認したい。確認スクリプト `scripts/check-migration-status.mjs` は既に用意済み（SELECT専用・書き込みなし）。これを実行して、その標準出力をそのまま貼り戻してください。

### 手順

1. `scripts/check-migration-status.mjs` の中身を一読し、**SELECT 参照クエリのみで書き込み（DDL/DML/commit）が無いこと** を自分の目で確認する。
2. `pg` パッケージが未インストールなので追加する：
   ```
   npm install pg
   ```
   - ※ `package.json` / `package-lock.json` が変化するが、**この変更はコミットしない**（`apply-migration.mjs` も `pg` 依存なので追加自体は妥当だが、コミット要否はまっすんが別途判断する）。
3. 実行する：
   ```
   node scripts/check-migration-status.mjs
   ```
4. 接続には `.env.local` の `SUPABASE_DB_URL`（本番Postgres直結）が使われる。**これは本番DBへの読み取りアクセスです。**
5. 出力された「## Migration Status」表と「## Additional Output」を**そのまま全文**貼り戻す。

### 判定の見方（参考）

| 項目 | 対象マイグレーション | 適用済み判定 |
|---|---|---|
| Q1 | participants_slot_unique_index | `participants_event_slot_active_uq` インデックス存在 |
| Q2 | join_event_unique_violation_guard | join_event 定義に `unique_violation` を含む |
| Q3 | cancel_participant_lock_order_fix | cancel_participant 定義に `slot_number = -ranked` を含む |
| Q4 | update_member_name_rpc | 関数存在 かつ participants も更新する版 |
| Q5 | create_admin_login_attempts | `admin_login_attempts` テーブル存在 |
| Q6 | drop_participants_delete_open_policy | `participants_delete` ポリシーが**無い** |
| Q7 | revoke_register_member_anon_execute | anon の execute 権限が **false** |

### 厳守ルール

- **書き込み・適用・コミットは一切しない（read-only のみ）。** スクリプトの SELECT 以外を実行しない。
- `apply-migration.mjs` を実行しない（あれは本番にSQLを適用するスクリプト）。
- ファイルを削除しない。
- `SUPABASE_DB_URL` などの秘密情報を出力やコードにハードコードしない（`.env.local` から読む）。
- 終わったら出力の表を貼り戻すだけでよい。マイグレーションの適用や修正提案は不要。

---

## 実行後（まっすん／Claude Code 側）

出力の Q1〜Q7 を見れば、本番に未適用のマイグレーションが確定する。未適用分は `node scripts/apply-migration.mjs <file>` で順次適用（適用はまっすん作業）。推奨適用順は HANDOVER / 棚卸し表を参照。
