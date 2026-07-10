# 03_basketball-circle — プロジェクトタスク

> basketball-circle 固有のタスク管理ファイル（2026-07-02 新設）。
> ワークスペース横断タスク（AI OS 全体）は `30_vault/07_QUEUE/queue.md` / `continuing-ledger.md` 側。**03 固有のタスクはここ**。

各行フォーマット: `- [status: open|approval-needed|done] [種別: …] [初出: YYYY-MM-DD] [更新: YYYY-MM-DD] 内容`

---

## Active

- [status: open] [種別: 実装課題] [初出: 2026-06-21] [更新: 2026-07-02] route handler 4本のモジュールトップ `getServerSupabase()` は env 欠落でルート落ちリスクあり、関数内遅延取得への統一が未着手。`closes_at` デッドカラム整理も保留中。cron の `auth.admin.deleteUser` 失敗はログ化済み（2026-07-02・console.error で孤児 auth ユーザー id を記録）だが、孤児の自動リカバリは未実装。（旧 continuing-ledger CO-15 から 2026-07-02 移送。※旧記録の「note route handler」ラベルは誤分類＝`getServerSupabase` は本プロジェクトのコードにのみ存在）
- [status: open] [種別: 実装課題] [初出: 2026-07-02] [更新: 2026-07-02] 確認コード（OTP）の再送導線がない: verify 画面に再送ボタンがなく、`switchMode` が pendingRegistration をリセットするため姓名・パスワードの全再入力が必要。OTP 試行回数のクライアント側制限もなし（Supabase 側レート制限頼み）。※ログイン画面の詰み文言・登録済みメール再登録の偽表示は 2026-07-02 修正済み
- [status: open] [種別: 実装課題] [初出: 2026-07-02] [更新: 2026-07-02] silent failure 残り: トップページ `app/page.tsx` とイベント詳細 `app/events/[id]/page.tsx` が Supabase error を無視して「イベントなし」/404 として描画。`lib/server-member.ts` の `touchMemberLastAccess` も update 失敗を未検知（休眠判定の last_accessed_at が更新されず誤削除リスクに連なる）。※cancel API の誤404・cron 無ログは 2026-07-02 修正済み
- [status: open] [種別: 実装課題] [初出: 2026-07-02] [更新: 2026-07-03] 休眠会員クリーンアップが1実行あたり100件頭打ち（`.limit(100)`・`.order()` なし・複数バッチなし）。滞留すると削除が追いつかない
- [status: open] [種別: 実装課題] [初出: 2026-07-02] [更新: 2026-07-03] イベント編集（admin PATCH）の定員バリデーション追加: 現 active 参加者数を下回る max_participants は拒否し、参加者数と同数への変更時は即時 closed へ遷移する（SPEC ADM-19 想定仕様・まっすん確認済み）
- [status: open] [種別: 機能要望] [初出: 2026-07-03] [更新: 2026-07-03] 管理者による参加者の代理追加機能。案①管理者がユーザ画面から「友達追加」形式で代理追加 ②管理者画面に同様の追加UI、の2案で設計未決定。着手時は plan-maker でプラン提示（SPEC ADM-16）
- [status: open] [種別: 実装課題] [初出: 2026-07-03] [更新: 2026-07-03] 参加者一覧での友達の臨時ID（display_code）表示を廃止する。会員本人のIDは元々非表示（display_code は guest: 形式のみ）。廃止前に `components/JoinForm.tsx:52`（自分の友達欄「発行済み」フォールバック表示）等の用途を調査（SPEC JOIN-15 想定仕様・まっすん確認済み）
- [status: open] [種別: 検討] [初出: 2026-07-03] [更新: 2026-07-03] 姓名の変更機能の追加を検討（結婚による改姓等を想定。現状はヘッダーのニックネーム変更のみで姓名は変更不可）。方針未決定・まっすん検討中（SPEC MEM-03 / AUTH-12）
- [status: open] [種別: docs] [初出: 2026-07-03] [更新: 2026-07-03] docs/operations-spec.md の「ログインやページアクセスのたびに last_accessed_at が更新される」記述を実装（24時間に1回の間引き更新）に合わせて修正（SPEC MEM-08 / CRON-16・現状維持で確定）
- [status: open] [種別: セキュリティ低] [初出: 2026-07-02] [更新: 2026-07-02] HSTS ヘッダ未設定（next.config.ts securityHeaders）。CSP script-src の 'unsafe-inline'/'unsafe-eval'（Google Maps 要件・リスク受容の明文化を検討）。rate limit が admin/verify のみで participants/cancel/members POST・PATCH は未制限（非対称）
- [status: open] [種別: DB整合] [初出: 2026-07-02] [更新: 2026-07-02] events テーブルに CHECK 制約なし（threshold <= max_participants、正数保証）。event_end_date が nullable のため NULL 行は cleanup のアーカイブ対象から静かに漏れる（app 層は必須化済み・DB 層のみ穴）
- [status: open] [種別: 運用] [初出: 2026-07-02] [更新: 2026-07-10] DB バックアップの取得状況・復旧手順が RUNBOOK 未記載（Supabase 無料枠は自動物理バックアップなし・pg_dump 定期取得の運用検討）。Supabase 無料枠の自動休止（7日間アクセスなしで pause）の再開手順も未文書。Vercel cron の Hobby プラン制約（1日1回・実行遅延許容）に加え、Vercel cron・pg_cron ともにネイティブの失敗通知機能はなく（2026-07-10 事実確認済み・Vercel側は console.error ログのみで能動検知には Log Drains 等の外部監視が必要／pg_cron 側も同様に自動検知なし）、その運用整備も未着手
- [status: open] [種別: 整理] [初出: 2026-07-02] [更新: 2026-07-02] `components/CancelModal.tsx` が未使用デッドコード（旧5桁コード方式の名残・import 元なし）。`participants_public` ビューの `display_code`（`guest:` 形式 user_code）も旧方式のデータモデル残骸
- [status: open] [種別: テスト] [初出: 2026-07-02] [更新: 2026-07-02] OTP 入力・auth/callback・「Email not confirmed」分岐に自動テストが皆無（E2E は事前プロビジョン済み確認済みユーザーの signInWithPassword のみ）。メール確認まわりの回帰はテストで検知できない

---

## Closed（直近）

- [status: done] [種別: 実装課題] [初出: 2026-07-02] [更新: 2026-07-02] 監査 high 5件を修正: ログイン詰み文言（復帰手順の案内へ）・登録済みメール再登録の偽「コード送信済み」・ログイン時 ensureMember 失敗無視・cancel API の DB エラー誤404・cron cleanup の無ログ。unit 122緑・lint/build クリーン
- [status: done] [種別: 仕様確定] [初出: 2026-07-02] [更新: 2026-07-02] 自動再開時の `max_participants = threshold` 更新は意図的仕様と確認（まっすん回答・operations-spec.md:170-172 にも既記載）。監査の「定員恒久縮小バグ」判定は誤検出。メモリ `event-reopen-threshold-by-design` に保存済み
- [status: done] [種別: 運用整備] [初出: 2026-07-02] [更新: 2026-07-02] メール方式即時切替キットを整備: `docs/EMAIL_SWITCHOVER_RUNBOOK.md`（Resend 移行/確認OFF の両論併記・設定マトリクス・本番 Redirect URL 手順）・`scripts/list-unconfirmed-auth-users.mjs`（dry-run 既定・二重ガード）・config.toml 罠コメント・operations-spec / DEPLOY_RUNBOOK 相互参照

---

## 由来メモ

- 2026-07-02: 本ファイル新設。continuing-ledger の project 固有混在是正（まっすん承認）に伴い CO-15 を移送。
