# RLS強化SQL適用後QA

## 対象

- URL: https://basketball-circle.vercel.app
- 実施日: 2026-05-26

## 確認結果

```json
{
  "ok": true,
  "cleanedLeftovers": 1,
  "joinStatus": 200,
  "directAnonUpdateRows": 0,
  "directAnonUpdateErrorCode": null,
  "directAnonUpdatePreservedName": true,
  "cancelStatus": 200,
  "participantStatusAfterCleanup": "cancelled",
  "unauthorizedMemberPatchStatus": 401
}
```

## 判定

- 本番APIでテスト用の友達参加を追加できる。
- anon keyからの直接 `participants` UPDATE は0件更新でブロックされる。
- 直接UPDATE後も参加者名は変更されていない。
- API経由のキャンセルは成功する。
- キャンセル後、参加者ステータスは `cancelled`。
- 未認証の会員情報更新APIは `401` で拒否される。

RLS強化SQL適用後も、必要な操作はAPI経由で正常に動作し、直接UPDATEはブロックされている。
