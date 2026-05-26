# 参加申請RPC化 デプロイ後QA

## 対象

- URL: https://basketball-circle.vercel.app
- Commit: `7f20661 fix: make event joins concurrency-safe`
- Event: `6defef7b-59e2-4ade-8943-4c51487118e6`

## 確認結果

- 本番トップページが `200` を返すことを確認。
- 本番APIでテスト用の友達参加を1件追加できることを確認。
- 追加したテスト参加者をキャンセルできることを確認。
- キャンセル後、Supabase上の参加者ステータスが `cancelled` になっていることを確認。
- 本番イベント詳細画面がブラウザで表示できることを確認。

## 注意

- 本番DBへ `supabase/migrations/20260526_join_event_rpc.sql` は未適用。
- 現在の本番APIは、RPC未適用時に既存処理へフォールバックするため機能停止はしていない。
- 参加申請の同時実行競合を実際に解消するには、本番DBへ `join_event` 関数を適用する必要がある。

## エビデンス

- `docs/qa/evidence/2026-05-26-join-rpc-post-deploy/01-production-event-page.png`
