# Claude Code 引き継ぎ資料: イベント開始・終了日時対応

作成日時: 2026-05-26 JST  
対象プロジェクト: `C:\ClaudeCode\90_projects\03_basketball-circle`

## 現在の依頼内容

管理者画面で、イベントの予定時刻が開始のみだったため、開始日時と終了日時を設定できるように修正する。

## 実装済み内容

- 管理者イベント作成画面に「開始日時」「終了日時」を追加。
- 管理者イベント編集画面に「開始日時」「終了日時」を追加。
- 作成・編集時に、終了日時が開始日時より後であることをフロント側で検証。
- 管理者APIでも `event_end_date` を受け取り、終了日時が開始日時より後であることを検証。
- イベント一覧、イベント詳細、管理者一覧の日時表示を `開始 - 終了` の範囲表示に変更。
- `Event` 型に `event_end_date: string | null` を追加。
- Supabase用のカラム追加SQLを追加。

## 変更ファイル

- `app/admin/create/page.tsx`
- `app/admin/events/[id]/edit/page.tsx`
- `app/admin/page.tsx`
- `app/api/admin/events/route.ts`
- `app/events/[id]/page.tsx`
- `components/EventList.tsx`
- `lib/supabase.ts`
- `supabase/schema.sql`
- `supabase/migrations/20260526_add_event_end_date.sql`
- `docs/qa/2026-05-26-event-end-date/README.md`
- `docs/qa/2026-05-26-event-end-date/admin-create-start-end.png`
- `docs/qa/2026-05-26-event-end-date/admin-edit-start-end.png`

## 重要: 本番DBに必要な作業

デプロイ前に、Supabase本番DBへ以下のカラム追加が必要。

```sql
alter table events
  add column if not exists event_end_date timestamptz;
```

SQLファイルは `supabase/migrations/20260526_add_event_end_date.sql` に保存済み。

このSQLを適用しないままデプロイすると、管理者画面からイベント作成・編集保存した際に、`event_end_date` カラムが存在しないため保存失敗する可能性が高い。

## 現在の作業ツリー状況

`git status --short` では以下が出ている。

```text
 M app/admin/create/page.tsx
 M app/admin/events/[id]/edit/page.tsx
 M app/admin/page.tsx
 M app/api/admin/events/route.ts
 M app/events/[id]/page.tsx
 M app/page.tsx
 M components/EventList.tsx
 M lib/supabase.ts
 M supabase/schema.sql
?? docs/
?? supabase/migrations/
```

注意: `app/page.tsx` は今回の作業前から存在する未コミット変更。今回の実装では触っていないため、コミット・ステージ時に混ぜないこと。

## 検証済み

実行済みコマンド:

```powershell
npx.cmd tsc --noEmit
npm.cmd run build
git diff --check
```

結果:

- `npx.cmd tsc --noEmit`: 成功
- `npm.cmd run build`: 成功
  - 初回はサンドボックス内でGoogle Fonts取得に失敗。
  - ネットワーク許可後に成功。
  - `middleware` file convention deprecated warning は既存警告。
- `git diff --check`: 成功

`npm.cmd run lint` は失敗しているが、今回追加した日時ロジック起因ではなく、既存の管理画面にある `useEffect` 内の同期 `setState` などで止まっている。

代表的なlintエラー:

- `app/admin/create/page.tsx`: `react-hooks/set-state-in-effect`
- `app/admin/events/[id]/edit/page.tsx`: `react-hooks/set-state-in-effect`
- `app/admin/page.tsx`: `react-hooks/set-state-in-effect`, `react-hooks/immutability`

## ブラウザ確認済み

ローカル: `http://localhost:3000`

確認内容:

- `/admin/create`
  - 「開始日時」「終了日時」が表示される。
  - 未入力で「公開して作成」を押すと「タイトル・開始日時・終了日時・場所は必須です」が表示される。
- `/admin/events/6defef7b-59e2-4ade-8943-4c51487118e6/edit`
  - 既存の開始日時が読み込まれる。
  - 「終了日時」が追加表示される。
- `/api/admin/events`
  - `event_end_date <= event_date` のPOSTに対して `400` と `event_end_date は event_date より後にしてください` を返す。

エビデンス:

- `docs/qa/2026-05-26-event-end-date/admin-create-start-end.png`
- `docs/qa/2026-05-26-event-end-date/admin-edit-start-end.png`
- `docs/qa/2026-05-26-event-end-date/README.md`

## ローカル環境メモ

- ユーザーの in-app browser は `http://localhost:3000/admin/events/6defef7b-59e2-4ade-8943-4c51487118e6/edit` を開いている。
- `localhost:3000` には既存のNext dev serverが起動している。
  - ログ上の既存PID: `23372`
  - ディレクトリ: `C:\ClaudeCode\90_projects\03_basketball-circle`
- 管理者パスワード等の秘密情報は `.env.local` にあるが、チャットには表示しないこと。

## デプロイ・コミット時の推奨手順

1. Supabase StudioのSQL Editor等で `supabase/migrations/20260526_add_event_end_date.sql` を本番DBへ適用。
2. `git status --short` を確認。
3. 今回の対象ファイルだけをstageする。
   - `app/page.tsx` は今回対象外なのでstageしない。
4. commit例:

```powershell
git add app/admin/create/page.tsx app/admin/events/[id]/edit/page.tsx app/admin/page.tsx app/api/admin/events/route.ts app/events/[id]/page.tsx components/EventList.tsx lib/supabase.ts supabase/schema.sql supabase/migrations/20260526_add_event_end_date.sql docs/qa/2026-05-26-event-end-date/README.md docs/qa/2026-05-26-event-end-date/admin-create-start-end.png docs/qa/2026-05-26-event-end-date/admin-edit-start-end.png docs/HANDOVER_2026-05-26_event-end-date.md
git commit -m "feat: add event end date"
git push origin main
```

5. Vercelデプロイ後、管理者編集画面で終了日時を入れて保存できることを本番で確認。
6. イベント一覧・イベント詳細で `開始 - 終了` 表示になっていることを確認。

## 次にClaude Codeへお願いしたいこと

- まずSupabase本番DBへの `event_end_date` カラム追加を確認。
- その後、必要であればコミット・デプロイ。
- デプロイ後、本番で以下をテスト。
  - 既存イベント編集で終了日時を設定して保存できる。
  - 新規イベント作成で終了日時が必須になっている。
  - 終了日時が開始日時以前の場合、画面/APIで拒否される。
  - 一般ユーザーのイベント一覧・イベント詳細の表示が崩れていない。

## 直近の既存コミット

```text
c879dab feat: allow guest invites without joining
671deea fix: keep guest management after self cancel
340758c fix: label guests with inviter family name
cd1dac8 feat: add temporary guest participants
73b2375 fix: show cancel button for joined events
dad9374 feat: split member name fields on registration
63878a1 fix: renumber participants after cancellation
dd5b574 feat: add clear button to DateTimePicker
```
