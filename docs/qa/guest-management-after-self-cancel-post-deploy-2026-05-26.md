# 本人キャンセル後の友達管理 デプロイ後テスト: 2026-05-26

対象: https://basketball-circle.vercel.app/events/6defef7b-59e2-4ade-8943-4c51487118e6

## 実行結果

| ID | 観点 | 結果 | メモ |
| --- | --- | --- | --- |
| GM-01 | 本人参加後に友達を追加 | OK | `Remain Test（検証の友達）` を追加 |
| GM-02 | 友達を残したまま本人キャンセル | OK | 友達は参加者リストに残った |
| GM-03 | 本人キャンセル後の友達管理欄 | OK | `自分の参加はキャンセル済みです。追加済みの友達のみ管理できます。` が表示された |
| GM-04 | 本人キャンセル後に友達を取消 | OK | `取消` から友達を削除できた |
| GM-05 | 後片付け | OK | 参加者数は `1 / 40` に戻った |
| GM-06 | ブラウザコンソール | OK | アプリ由来の warning/error なし |

## 証跡

保存先: `docs/qa/evidence/2026-05-26-guest-manage-after-self-cancel/`

- `01-after-guest-add.png`
- `02-after-self-cancel-guest-management-remains.png`
- `03-after-wait-reload-check.png`
- `04-after-cleanup.png`

## 補足

Vercel反映直後の確認では旧UIが一度表示されたため、反映待ち後に再読み込みして最終確認した。
