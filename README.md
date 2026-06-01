# バスケサークル 参加管理アプリ

LINEオープンチャットでの「コピー&ペースト方式」によるデグレを解消するWebアプリ。

## セットアップ手順

### 1. Supabaseプロジェクト作成

1. [supabase.com](https://supabase.com) でプロジェクトを作成
2. `supabase/schema.sql` の内容をSupabaseのSQL Editorで実行
3. Project Settings → API からURLとanon keyをコピー

### 2. 環境変数の設定

`.env.local` を編集：

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
ADMIN_PASSWORD=任意の管理者パスワード
ADMIN_SESSION_SECRET=任意の長いランダム文字列
CRON_SECRET=任意の長いランダム文字列
```

### 3. 開発サーバー起動

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) で確認

### 4. Vercelデプロイ

```bash
npx vercel --prod
```

Vercelダッシュボードの Environment Variables に同じ変数を設定する。
`SUPABASE_SERVICE_ROLE_KEY` はサーバー処理に必須です。未設定の場合、サーバー側 Supabase 操作は起動時に失敗します。
`CRON_SECRET` は Vercel Cron から `/api/cron/cleanup` を呼び出すために必要です。Vercel の Environment Variables に必ず設定し、Cron 側は `Authorization: Bearer <CRON_SECRET>` を送る構成にしてください。

---

## 機能

| 機能 | 説明 |
|---|---|
| イベント一覧 | 公開中のイベントを表示 |
| 参加申請 | 名前を入力して申請（定員40人まで） |
| キャンセル待ち | 定員超過・締め切り後はキャンセル待ちに登録 |
| キャンセル | 5桁の参加コードで本人確認してキャンセル |
| 自動繰り上がり | 参加者が閾値（デフォルト30人）以下になったらキャンセル待ち先頭を自動繰り上げ |
| リアルタイム更新 | Supabase Realtimeで全員の画面が即時同期 |
| 管理者機能 | イベント作成・受付の開閉・強制キャンセル |
