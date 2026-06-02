# 友達のみ追加 デプロイ後テスト: 2026-05-26

対象: https://basketball-circle.vercel.app/events/6defef7b-59e2-4ade-8943-4c51487118e6

## 実行結果

| ID | 観点 | 結果 | メモ |
| --- | --- | --- | --- |
| GO-01 | 本人未参加時の友達追加UI | OK | `参加申請する` と友達追加欄が同時に表示 |
| GO-02 | 本人未参加のまま友達追加 | OK | `Only Guest（検証の友達）` を追加できた |
| GO-03 | 参加者一覧への反映 | OK | 友達のみが `2番` として表示され、本人は参加者に入らない |
| GO-04 | 友達取消 | OK | `取消` で友達をキャンセルできた |
| GO-05 | 後片付け | OK | 参加者数は `1 / 40` に戻った |
| GO-06 | ブラウザコンソール | OK | アプリ由来の warning/error なし |

## 証跡

保存先: `docs/qa/evidence/2026-05-26-guest-only-invite/`

- `01-after-guest-only-add.png`
- `02-after-cleanup.png`
