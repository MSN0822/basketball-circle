# RLS・会員番号対策 デプロイ後QA

## 対象

- URL: https://basketball-circle.vercel.app
- Commit: `9fe9d23 fix: prepare member and rls hardening`

## 確認結果

```json
{
  "ok": true,
  "joinStatus": 200,
  "cancelStatus": 200,
  "participantStatusAfterCleanup": "cancelled",
  "unauthorizedMemberPatchStatus": 401
}
```

## 判定

- 本番トップページは `200`。
- 本番APIでテスト用の友達参加を追加できる。
- 追加したテスト参加者をキャンセルできる。
- キャンセル後、参加者ステータスは `cancelled`。
- 未認証の会員情報更新APIは `401` で拒否される。

## 注意

- `register_member` RPCのSQLは追加済みだが、本番DBへは未適用。
- `prepare_rls_hardening` SQLは、Vercelに `SUPABASE_SERVICE_ROLE_KEY` を設定してから適用すること。
