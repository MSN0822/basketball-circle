# 03_basketball-circle — プロジェクトタスク

> basketball-circle 固有のタスク管理ファイル（2026-07-02 新設）。
> ワークスペース横断タスク（AI OS 全体）は `30_vault/07_QUEUE/queue.md` / `continuing-ledger.md` 側。**03 固有のタスクはここ**。
> **HANDOFF不使用宣言（2026-07-11）**: セッション間の引き継ぎは本ファイル＋`SPEC.md`で代替し、`HANDOFF.md`は作成しない。D3プロジェクト健全性走査（`project-inventory-check.ps1`）の標準ファイル欠落検出（A3）の対象から除外する。

各行フォーマット: `- [status: open|approval-needed|done] [種別: …] [初出: YYYY-MM-DD] [更新: YYYY-MM-DD] 内容`

---

## Active

- [status: open] [種別: 実装課題] [初出: 2026-06-21] [更新: 2026-07-11] route handler 5本（cancel/admin-events/members/participants/events-ics）のモジュールトップ `getServerSupabase()` は env 欠落でルート落ちリスクあり、関数内遅延取得への統一が未着手。`closes_at` デッドカラム整理も保留中。cron の `auth.admin.deleteUser` 失敗はログ化済み（2026-07-02・console.error で孤児 auth ユーザー id を記録）だが、孤児の自動リカバリは未実装。（旧 continuing-ledger CO-15 から 2026-07-02 移送。※旧記録の「note route handler」ラベルは誤分類＝`getServerSupabase` は本プロジェクトのコードにのみ存在）2026-07-11 QA監査M-14で再指摘：修正時は `route-lazy-supabase.test.ts` 等で「getServerSupabaseがthrowしてもimport時クラッシュせず制御された500 JSONを返す」ことを5ルート分パラメトライズでテストすること
- [status: open] [種別: 実装課題] [初出: 2026-07-02] [更新: 2026-07-02] 確認コード（OTP）の再送導線がない: verify 画面に再送ボタンがなく、`switchMode` が pendingRegistration をリセットするため姓名・パスワードの全再入力が必要。OTP 試行回数のクライアント側制限もなし（Supabase 側レート制限頼み）。※ログイン画面の詰み文言・登録済みメール再登録の偽表示は 2026-07-02 修正済み
- [status: open] [種別: 実装課題] [初出: 2026-07-02] [更新: 2026-07-11] silent failure 残り: トップページ `app/page.tsx` とイベント詳細 `app/events/[id]/page.tsx` が Supabase error を無視して「イベントなし」/404 として描画。※`lib/server-member.ts` の `touchMemberLastAccess` はテストカバレッジを追加済み（2026-07-11、`tests/unit/server-member.test.ts`）だが、update失敗時の検知・ログ化自体は未実装のまま。cancel API の誤404・cron 無ログは 2026-07-02 修正済み。2026-07-11 QA監査M-13で再指摘：修正時はデータ取得を `fetchVisibleEvents(supabase)` 等へ抽出しunitで「error時にthrow・空配列に潰さない」を検証すること
- [status: open] [種別: 実装課題] [初出: 2026-07-02] [更新: 2026-07-11] イベント編集（admin PATCH）の定員バリデーション追加: 現 active 参加者数を下回る max_participants は拒否し、参加者数と同数への変更時は即時 closed へ遷移する（SPEC ADM-19 想定仕様・まっすん確認済み）。2026-07-11 QA監査M-15で再指摘：テスト先行推奨——修正と同時にunit3本（<activeCount→400 / ===→closed付きupdate / カウント取得失敗→500）＋編集UIで不正値→エラー文言表示のE2E2本を追加すること
- [status: open] [種別: テスト] [初出: 2026-07-11] [更新: 2026-07-11] 定員ライフサイクル（join_event/cancel_participant RPC。満員自動締切・キャンセル自動再開・is_manual_close時の再開抑止・重複参加409・slot_number繰り上げ）のpgTAPテストが未整備（`supabase/tests/database/` 3ファイルに対象なし）。E2E側は2026-07-11に4本追加済み（`tests/e2e/user-flows.spec.ts` 定員E2E-1〜3・繰上E2E-1）だが、DBレベルの直接検証は無い。ローカルSupabase環境構築（Docker Desktop起動→pg_cron migration一時退避→`db reset`、ERRORS.md 2026-06-21参照）が前提のため今回は見送り。着手時は `supabase/tests/database/join_event_capacity.test.sql` を新設し、既存pgTAPのbegin/rollbackパターンを踏襲すること（QA監査H-1）
- [status: open] [種別: テスト] [初出: 2026-07-11] [更新: 2026-07-11] OTP・auth/callback・「Email not confirmed」等の実フロー検証がE2Eに無い（unit部分は2026-07-11に対応済み——`app/login/page.tsx`のメール送信エラー分岐を`lib/signup-email-error.ts`へ抽出しテスト化）。ローカルSupabase+メールテスト基盤（Mailpit等、現状未導入）の構築が前提のため見送り。着手時は5シナリオ（コード成功登録・token_hashリンク経由callback・不正token_hash・未確認ユーザーログイン・既存メール再登録）を想定（QA監査H-8）
- [status: open] [種別: テスト] [初出: 2026-07-11] [更新: 2026-07-11] update_member_name/register_member RPCのDB挙動（再登録の冪等パス・改名時のactive/waitlist同期とcancelled据え置き・他人ID指定時の挙動）のpgTAPテストが未整備。E2E側は名前変更の名簿波及1本を2026-07-11に追加済み（`tests/e2e/user-flows.spec.ts` 名前E2E-1）。ローカルSupabase環境構築が前提のため見送り（QA監査M-9）
- [status: open] [種別: 機能要望] [初出: 2026-07-03] [更新: 2026-07-03] 管理者による参加者の代理追加機能。案①管理者がユーザ画面から「友達追加」形式で代理追加 ②管理者画面に同様の追加UI、の2案で設計未決定。着手時は plan-maker でプラン提示（SPEC ADM-16）
- [status: open] [種別: 実装課題] [初出: 2026-07-03] [更新: 2026-07-03] 参加者一覧での友達の臨時ID（display_code）表示を廃止する。会員本人のIDは元々非表示（display_code は guest: 形式のみ）。廃止前に `components/JoinForm.tsx:52`（自分の友達欄「発行済み」フォールバック表示）等の用途を調査（SPEC JOIN-15 想定仕様・まっすん確認済み）
- [status: open] [種別: 検討] [初出: 2026-07-03] [更新: 2026-07-03] 姓名の変更機能の追加を検討（結婚による改姓等を想定。現状はヘッダーのニックネーム変更のみで姓名は変更不可）。方針未決定・まっすん検討中（SPEC MEM-03 / AUTH-12）
- [status: open] [種別: docs] [初出: 2026-07-03] [更新: 2026-07-03] docs/operations-spec.md の「ログインやページアクセスのたびに last_accessed_at が更新される」記述を実装（24時間に1回の間引き更新）に合わせて修正（SPEC MEM-08 / CRON-16・現状維持で確定）
- [status: open] [種別: セキュリティ低] [初出: 2026-07-02] [更新: 2026-07-02] HSTS ヘッダ未設定（next.config.ts securityHeaders）。CSP script-src の 'unsafe-inline'/'unsafe-eval'（Google Maps 要件・リスク受容の明文化を検討）。rate limit が admin/verify のみで participants/cancel/members POST・PATCH は未制限（非対称）
- [status: open] [種別: DB整合] [初出: 2026-07-02] [更新: 2026-07-11] events テーブルに CHECK 制約なし（threshold <= max_participants、正数保証）。event_end_date が nullable のため NULL 行は cleanup のアーカイブ対象から静かに漏れる（app 層は必須化済み・DB 層のみ穴）。2026-07-11: カレンダー追加リンク機能（JOIN-22）で同じ穴が顕在化——event_end_dateがnullの場合は開始+2時間を終了時刻とする暫定フォールバック（`lib/calendar-event.ts`）で回避しているが、実運用では管理画面が終了日時を必須化しているため発動頻度は実質ゼロ。まっすん確認: event_end_date のDB層NOT NULL化を検討するか、現状（app層必須・DB層nullable）を維持するか未決定
- [status: open] [種別: 運用] [初出: 2026-07-02] [更新: 2026-07-10] DB バックアップの取得状況・復旧手順が RUNBOOK 未記載（Supabase 無料枠は自動物理バックアップなし・pg_dump 定期取得の運用検討）。Supabase 無料枠の自動休止（7日間アクセスなしで pause）の再開手順も未文書。Vercel cron の Hobby プラン制約（1日1回・実行遅延許容）に加え、Vercel cron・pg_cron ともにネイティブの失敗通知機能はなく（2026-07-10 事実確認済み・Vercel側は console.error ログのみで能動検知には Log Drains 等の外部監視が必要／pg_cron 側も同様に自動検知なし）、その運用整備も未着手
- [status: open] [種別: 整理] [初出: 2026-07-02] [更新: 2026-07-02] `components/CancelModal.tsx` が未使用デッドコード（旧5桁コード方式の名残・import 元なし）。`participants_public` ビューの `display_code`（`guest:` 形式 user_code）も旧方式のデータモデル残骸

---

## Closed（直近）

- [status: done] [種別: テスト] [初出: 2026-07-11] [更新: 2026-07-11] Fable(claude-fable-5) 4体並列によるQA監査（lib関数/APIルート/E2Eフロー/SPEC整合性の4観点、計49件指摘）に対応。unit test 155件→249件（新規5ファイル・既存11ファイル追記）、E2E 27件→43件（16本追加）。実装修正3点: JOIN-22不正日付の明示的拒否（`lib/calendar-event.ts`）、休眠会員クリーンアップの複数バッチ化（`app/api/cron/cleanup/route.ts`、上記「1実行あたり100件頭打ち」課題を解消）、`tests/unit/admin-events-route.test.ts`のヘルパーバグ修正（`??`→`===undefined`）。SPEC.md EVT-11・CRON-06を✅確認済みへ更新。pgTAP新設3件（H-1定員ライフサイクル・H-8 OTP E2E・M-9名前変更RPC）とM-13/14/15（実装課題前提）は環境制約・実装未着手のため見送り、上記Active欄に個別記録
- [status: done] [種別: 実装課題] [初出: 2026-07-02] [更新: 2026-07-02] 監査 high 5件を修正: ログイン詰み文言（復帰手順の案内へ）・登録済みメール再登録の偽「コード送信済み」・ログイン時 ensureMember 失敗無視・cancel API の DB エラー誤404・cron cleanup の無ログ。unit 122緑・lint/build クリーン
- [status: done] [種別: 仕様確定] [初出: 2026-07-02] [更新: 2026-07-02] 自動再開時の `max_participants = threshold` 更新は意図的仕様と確認（まっすん回答・operations-spec.md:170-172 にも既記載）。監査の「定員恒久縮小バグ」判定は誤検出。メモリ `event-reopen-threshold-by-design` に保存済み
- [status: done] [種別: 運用整備] [初出: 2026-07-02] [更新: 2026-07-02] メール方式即時切替キットを整備: `docs/EMAIL_SWITCHOVER_RUNBOOK.md`（Resend 移行/確認OFF の両論併記・設定マトリクス・本番 Redirect URL 手順）・`scripts/list-unconfirmed-auth-users.mjs`（dry-run 既定・二重ガード）・config.toml 罠コメント・operations-spec / DEPLOY_RUNBOOK 相互参照

---

## 由来メモ

- 2026-07-02: 本ファイル新設。continuing-ledger の project 固有混在是正（まっすん承認）に伴い CO-15 を移送。
