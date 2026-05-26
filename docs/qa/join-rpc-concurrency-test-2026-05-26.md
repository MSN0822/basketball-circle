# 参加申請RPC 同時申請テスト

## 対象

- URL: https://basketball-circle.vercel.app
- 対象API: `/api/participants`
- 実施日: 2026-05-26

## 方法

本番環境に一時テストイベントを作成し、定員を `1` に設定したうえで、同じタイミングで5件の友達参加申請をAPIへ並列送信した。

テスト後、一時テストイベントは管理者APIで削除済み。

## 結果

```json
{
  "ok": true,
  "responses": {
    "200": 3,
    "400": 2
  },
  "participants": {
    "active": 1,
    "waitlist": 2
  },
  "activeSlots": [1],
  "waitlistSlots": [1, 2],
  "finalEventStatus": "closed",
  "capacity": 1
}
```

## 判定

- 定員1名に対して、同時申請後も `active` は1名のみ。
- `slot_number` の重複なし。
- 定員到達後、イベントステータスは `closed`。
- 同一会員の友達招待上限3名により、5件中2件は `400` で拒否。

同時申請時の定員超過・参加番号重複は再現せず、RPC化による競合対策は有効と判断。
