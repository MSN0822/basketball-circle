# Codex 向けプロンプト v2（2026-06-02）

> v2: Workflow 9エージェント監査の結果を反映。旧タスクA/B/C は実装済みのため削除。新規発見問題を追加。

---

## プロンプト本文（コピペ用）

このリポジトリは Next.js 16.2.6 / React 19 / Supabase を使ったバスケサークルのイベント参加管理アプリです。

**必読**: `AGENTS.md` に記載の通り、このバージョンの Next.js は通常版と大きく異なります。コードを書く前に `node_modules/next/dist/docs/` の該当ドキュメントを確認してください。

詳細な指示は `docs/CODEX_TASK_2026-06-02.md` に記載されています。必ずそちらを全部読んでから作業を開始してください。

---

### まっすん判断済み前提で着手してよいタスク（並列OK）

**タスク2 — cancel/route.ts の user_code を safeCompare に変更**
- ファイル: `app/api/cancel/route.ts`
- `user_code === participant.user_code` を `safeCompare(user_code, participant.user_code)` に変更（1行）
- `safeCompare` は `lib/api-auth.ts` に実装済みなので import して使う
- 詳細は `docs/CODEX_TASK_2026-06-02.md` の「新タスク2」参照

**タスク3 — UUID形式検証の横展開**
- 対象: `app/api/cancel/route.ts`（participant_id）、`app/api/participants/route.ts`（event_id）、`app/api/admin/events/route.ts`（PATCH の id）、`app/api/members/route.ts`（PATCH の member_id）
- `app/api/admin/events/route.ts` の DELETE にある `UUID_RE` パターンを参考に横展開する
- 詳細は `docs/CODEX_TASK_2026-06-02.md` の「新タスク3」参照

**タスク4 — members の name 最大長チェック**
- ファイル: `app/api/members/route.ts`
- POST と PATCH の両方で name の最大長（100文字）チェックを追加
- 詳細は `docs/CODEX_TASK_2026-06-02.md` の「新タスク4」参照

**タスク5 — handleDelete のエラーハンドリング**
- ファイル: `app/admin/events/[id]/page.tsx`
- 削除API失敗時にエラーを表示し、/admin への遷移をスキップする
- 詳細は `docs/CODEX_TASK_2026-06-02.md` の「新タスク5」参照

---

### まっすん判断後に着手するタスク

**タスク1 — proxy.ts リネーム（【最重要】まっすんE-1判断待ち）**
- `proxy.ts` が Next.js ミドルウェアとして機能していない（どこからもimportされていない）
- まっすんの選択（A: middleware.ts にリネーム / B: re-exportファイル作成 / C: 現状維持）に従って対応
- 詳細は `docs/CODEX_TASK_2026-06-02.md` の「新タスク1」参照

---

### 確認して報告するだけのタスク

**確認D — マイグレーション重複**
- `supabase/migrations/20260602_cancel_participant_rpc.sql`（中間版）と `20260602_cancel_participant_lock_order_fix.sql`（最終版）の diff を確認
- 実質同一であることを確認→「削除してよいですか？」とまっすんに報告するだけ
- **削除しない**

---

### ルール
- コミットしない（差分を提示するだけ）
- ファイルを削除しない
- 秘密情報をコードに書かない
- 実装後に `npx tsc --noEmit` で型エラーがないことを確認
