# 友達名ラベル デプロイ後テスト: 2026-05-26

対象: https://basketball-circle.vercel.app/events/6defef7b-59e2-4ade-8943-4c51487118e6

## 実行結果

| ID | 観点 | 結果 | メモ |
| --- | --- | --- | --- |
| GFL-01 | 友達追加時の表示名 | OK | `Family Test（検証の友達）` として登録・表示された |
| GFL-02 | 参加者一覧への反映 | OK | 参加者リストにも `Family Test（検証の友達）` と臨時IDが表示された |
| GFL-03 | 後片付け | OK | 友達参加と本人参加をキャンセルし、参加者数は `1 / 40` に戻った |
| GFL-04 | ブラウザコンソール | OK | アプリ由来の warning/error なし |

## 証跡

保存先: `docs/qa/evidence/2026-05-26-guest-family-label/`

- `01-family-label-after-add.png`
- `02-after-cleanup.png`
